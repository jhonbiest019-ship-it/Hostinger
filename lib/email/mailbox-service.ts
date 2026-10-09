import { decryptSecret, encryptSecret } from "@/lib/credentials";
import { verifyImap } from "@/lib/email/imap";
import { verifySmtp } from "@/lib/email/smtp";

export type MailboxInput = { emailAddress: string; displayName?: string; username: string; password?: string; smtpHost: string; smtpPort: number; smtpSecurity: string; imapHost: string; imapPort: number; imapSecurity: string };

export function encryptedPassword(password: string) { return encryptSecret(password); }
export function passwordFromMailbox(encryptedCredentials: string) { return decryptSecret(encryptedCredentials); }

export async function testMailboxConnections(input: MailboxInput) {
  if (!input.password) throw new Error("Mailbox password is required for testing.");
  const smtp = { host: input.smtpHost, port: input.smtpPort, security: input.smtpSecurity, username: input.username, password: input.password };
  const imap = { host: input.imapHost, port: input.imapPort, security: input.imapSecurity, username: input.username, password: input.password };
  const [smtpResult, imapResult] = await Promise.allSettled([verifySmtp(smtp), verifyImap(imap)]);
  return { smtp: smtpResult.status === "fulfilled", imap: imapResult.status === "fulfilled", smtpError: smtpResult.status === "rejected" ? smtpResult.reason : undefined, imapError: imapResult.status === "rejected" ? imapResult.reason : undefined };
}
