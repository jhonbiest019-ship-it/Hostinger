import { loadEnvConfig } from "@next/env";
import { prisma } from "../lib/prisma";
import { decryptSecret } from "../lib/credentials";
import { safeErrorMessage } from "../lib/auth";
import { verifyImap } from "../lib/email/imap";
import { verifySmtp } from "../lib/email/smtp";

loadEnvConfig(process.cwd());

const CONFIRMATION = "I_UNDERSTAND_NO_SEND";

function fail(message: string): never {
  throw new Error(message);
}

function safeCategory(error: unknown) {
  const message = safeErrorMessage(error);
  if (message.includes("Authentication")) return "AUTHENTICATION_FAILED";
  if (message.includes("timed out")) return "TIMEOUT";
  if (message.includes("Secure connection")) return "TLS_FAILED";
  if (message.includes("security configuration")) return "CONFIGURATION_ERROR";
  return "CONNECTION_FAILED";
}

async function main() {
  if (process.env.NODE_ENV === "production") fail("Refused in production.");
  if (process.env.EMAIL_TEST_MODE !== "false") fail("Refused unless EMAIL_TEST_MODE=false is set for this one-time process.");
  if (process.env.MAILBOX_AUTH_TEST_ALLOW_NETWORK !== "true") fail("Refused unless MAILBOX_AUTH_TEST_ALLOW_NETWORK=true is set.");
  if (process.env.MAILBOX_AUTH_TEST_CONFIRM !== CONFIRMATION) fail("Refused without the required one-time confirmation.");

  const mailboxId = process.env.MAILBOX_AUTH_TEST_ID?.trim();
  if (!mailboxId) fail("Refused without MAILBOX_AUTH_TEST_ID.");
  const ownerId = process.env.MAILBOX_AUTH_TEST_USER_ID?.trim();
  if (!ownerId) fail("Refused without MAILBOX_AUTH_TEST_USER_ID.");

  const mailbox = await prisma.mailbox.findFirst({
    where: { id: mailboxId, userId: ownerId },
    select: { emailAddress: true, username: true, encryptedCredentials: true, smtpHost: true, smtpPort: true, smtpSecurity: true, imapHost: true, imapPort: true, imapSecurity: true },
  });
  if (!mailbox?.username || !mailbox.encryptedCredentials) fail("Mailbox credentials are not configured.");

  const password = decryptSecret(mailbox.encryptedCredentials);
  const smtp = { host: mailbox.smtpHost, port: mailbox.smtpPort, security: mailbox.smtpSecurity, username: mailbox.username, password };
  const imap = { host: mailbox.imapHost, port: mailbox.imapPort, security: mailbox.imapSecurity, username: mailbox.username, password };
  const [smtpResult, imapResult] = await Promise.allSettled([verifySmtp(smtp), verifyImap(imap)]);

  console.log(JSON.stringify({
    smtp: smtpResult.status === "fulfilled" ? "PASS" : "FAIL",
    ...(smtpResult.status === "rejected" ? { smtpError: safeCategory(smtpResult.reason) } : {}),
    imap: imapResult.status === "fulfilled" ? "PASS" : "FAIL",
    ...(imapResult.status === "rejected" ? { imapError: safeCategory(imapResult.reason) } : {}),
  }));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Controlled test refused or failed.";
  console.error(JSON.stringify({ status: "REFUSED_OR_FAILED", reason: message.startsWith("Refused") ? message : safeCategory(error) }));
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
