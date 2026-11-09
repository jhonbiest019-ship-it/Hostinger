import { prisma } from "../lib/prisma";
import { verifyImap } from "../lib/email/imap";
import { verifySmtp } from "../lib/email/smtp";
import { testMailboxConnections } from "../lib/email/mailbox-service";
import { syncUserMailboxes } from "../lib/email/inbox-sync";
import { assertSafeTestDatabase } from "./test-safety";

async function main() {
  assertSafeTestDatabase();
  if (process.env.EMAIL_TEST_MODE !== "true") throw new Error("EMAIL_TEST_MODE must be true.");
  const config = { host: "test.invalid", port: 993, security: "TLS", username: "sender@example.test", password: "test-only" };
  const imap = await verifyImap(config);
  const smtp = await verifySmtp({ ...config, port: 587, security: "STARTTLS" });
  const connections = await testMailboxConnections({ emailAddress: "sender@example.test", username: config.username, password: config.password, smtpHost: "test.invalid", smtpPort: 587, smtpSecurity: "STARTTLS", imapHost: "test.invalid", imapPort: 993, imapSecurity: "TLS" });
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "test-user@example.test" } });
  const sync = await syncUserMailboxes(user.id);
  const skipped = sync.every((result) => result.skipped === "EMAIL_TEST_MODE");
  if (!imap?.testMode || !smtp?.testMode || !connections.testMode || !skipped) throw new Error("IMAP/SMTP test isolation failed.");
  console.log(JSON.stringify({ status: "PASS", checks: ["verifyImap-no-network", "verifySmtp-no-network", "mailbox-test-no-network", "inbox-sync-no-network"] }));
}

main().catch((error) => { console.error(JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : "IMAP safety test failed" })); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
