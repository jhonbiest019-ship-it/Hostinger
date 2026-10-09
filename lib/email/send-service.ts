import { passwordFromMailbox } from "@/lib/email/mailbox-service";
import { sendSmtp } from "@/lib/email/smtp";

export async function sendFromMailbox(mailbox: { emailAddress: string; username: string | null; encryptedCredentials: string | null; smtpHost: string; smtpPort: number; smtpSecurity: string }, data: { to: string; subject: string; body: string }) {
  if (!mailbox.encryptedCredentials || !mailbox.username) throw new Error("Mailbox credentials are not configured.");
  return sendSmtp({ host: mailbox.smtpHost, port: mailbox.smtpPort, security: mailbox.smtpSecurity, username: mailbox.username, password: passwordFromMailbox(mailbox.encryptedCredentials) }, { from: mailbox.emailAddress, to: data.to, subject: data.subject, text: data.body });
}
