import { existsSync } from "node:fs";
import { loadEnvConfig } from "@next/env";

// Load local configuration before importing Prisma or modules that read environment variables.
loadEnvConfig(process.cwd());
const stopFileIndex = process.argv.indexOf("--stop-file");
const stopFile = stopFileIndex >= 0 ? process.argv[stopFileIndex + 1] : undefined;
const stopRequested = () => Boolean(stopFile && existsSync(stopFile));
let shuttingDown = false;
let wake: (() => void) | undefined;
function requestShutdown() { shuttingDown = true; wake?.(); }
async function main() {
  const { validateServerConfig } = await import("../lib/config");
  const { syncAllMailboxes } = await import("../lib/email/inbox-sync");
  const { processDueJobs } = await import("../lib/queue/worker");
  const { browserAgent } = await import("../lib/browser/agent");
  const { prisma } = await import("../lib/prisma");
  validateServerConfig();
  const loopDelay = Math.min(Math.max(Number(process.env.WORKER_INTERVAL_MS ?? 5000) || 5000, 2000), 10000);
  const runOnce = process.env.WORKER_RUN_ONCE === "true" || process.argv.includes("--once");
  process.on("SIGINT", requestShutdown); process.on("SIGTERM", requestShutdown);
  console.info("standalone_worker_started", { loopDelay, runOnce, testMode: process.env.EMAIL_TEST_MODE === "true" });
  let lastInboxSync = 0;
  // Sync IMAP inboxes periodically (every 2 minutes) to keep Hostinger server completely fast and free of lock contention
  const INBOX_SYNC_INTERVAL_MS = 120000;
  let cachedBlockedMailboxIds: string[] = [];

  try {
    do {
      try {
        const now = Date.now();
        // Sync IMAP inboxes periodically (every 60s) so outbound queue processing remains fast and real-time
        if (now - lastInboxSync >= INBOX_SYNC_INTERVAL_MS) {
          try {
            const inbox = await syncAllMailboxes();
            cachedBlockedMailboxIds = inbox
              .filter((result) => result.error || result.skipped === "lease-held")
              .map((result) => result.mailboxId);
            lastInboxSync = now;
          } catch (syncError) {
            console.warn("standalone_worker_inbox_sync_warning", syncError);
          }
        }

        const queue = await processDueJobs({ blockedMailboxIds: cachedBlockedMailboxIds });
        if (queue.discovered > 0 || queue.processed > 0 || queue.sent > 0 || queue.failed > 0) {
          console.info("standalone_worker_queue_active", queue);
        }

        // Process due website form automation jobs in user's browser only if explicitly enabled
        if (process.env.ENABLE_BROWSER_AUTOMATION === "true") {
          const formJobsCount = await browserAgent.processDueFormJobs().catch((err) => {
            console.warn("standalone_worker_forms_warning", err?.message || err);
            return 0;
          });
          if (formJobsCount > 0) {
            console.info("standalone_worker_forms_active", { formJobsCount });
          }
        }
      } catch (error) {
        console.error("standalone_worker_cycle_failed", { errorType: error instanceof Error ? error.name : "unknown", message: "Check database availability and mailbox connection status." });
        if (runOnce) process.exitCode = 1;
      }
      if (!runOnce && !shuttingDown && !stopRequested()) await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); clearInterval(poll); wake = undefined; resolve(); };
        const timer = setTimeout(done, loopDelay);
        const poll = setInterval(() => { if (stopRequested()) done(); }, 500);
        wake = done;
      });
    } while (!runOnce && !shuttingDown && !stopRequested());
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => {
  console.error("standalone_worker_start_failed", { errorType: error instanceof Error ? error.name : "unknown", message: "Check .env.local and database migrations." }); process.exitCode = 1;
});
