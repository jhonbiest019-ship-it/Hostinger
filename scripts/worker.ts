import { validateServerConfig } from "../lib/config";
import { syncAllMailboxes } from "../lib/email/inbox-sync";
import { processDueJobs } from "../lib/queue/worker";

const intervalMs = Math.min(Math.max(Number(process.env.WORKER_INTERVAL_MS ?? 60_000) || 60_000, 5_000), 900_000);
const runOnce = process.env.WORKER_RUN_ONCE === "true";
let shuttingDown = false;
let running = false;
let wakeTimer: NodeJS.Timeout | undefined;

function requestShutdown() {
  shuttingDown = true;
  if (!running && wakeTimer) clearTimeout(wakeTimer);
}

async function runCycle() {
  if (running) return;
  running = true;
  try {
    const queue = await processDueJobs();
    const inbox = process.env.EMAIL_TEST_MODE === "true" && process.env.WORKER_SKIP_INBOX_SYNC === "true"
      ? { skipped: "EMAIL_TEST_MODE" }
      : await syncAllMailboxes();
    console.info("standalone_worker_cycle_complete", { queue, inbox });
  } catch (error) {
    console.error("standalone_worker_cycle_failed", { errorType: error instanceof Error ? error.name : "unknown" });
  } finally {
    running = false;
  }
}

async function main() {
  validateServerConfig();
  process.on("SIGINT", requestShutdown);
  process.on("SIGTERM", requestShutdown);
  do {
    await runCycle();
    if (!runOnce && !shuttingDown) await new Promise<void>((resolve) => { wakeTimer = setTimeout(resolve, intervalMs); });
  } while (!runOnce && !shuttingDown);
}

main().catch((error) => {
  console.error("standalone_worker_start_failed", { errorType: error instanceof Error ? error.name : "unknown" });
  process.exitCode = 1;
});
