import { passwordFromMailbox } from "@/lib/email/mailbox-service";
import { sendSmtp } from "@/lib/email/smtp";
import { ImapFlow } from "imapflow";
import { updateMailboxSyncState } from "@/lib/email/sync-checkpoint";
import { formatEmailBodyToHtml } from "./template";

export { formatEmailBodyToHtml };

export type MailboxSenderInfo = {
  id?: string;
  emailAddress: string;
  displayName?: string | null;
  username: string | null;
  encryptedCredentials: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  imapHost?: string | null;
  imapPort?: number | null;
  imapSecurity?: string | null;
};



async function appendToSentFolder(
  mailbox: MailboxSenderInfo,
  emailData: { from: string; to: string; subject: string; text: string; html?: string }
) {
  if (!mailbox.imapHost || !mailbox.username || !mailbox.encryptedCredentials) return;
  try {
    const password = passwordFromMailbox(mailbox.encryptedCredentials);
    const client = new ImapFlow({
      host: mailbox.imapHost,
      port: mailbox.imapPort || 993,
      secure: (mailbox.imapSecurity || "TLS") === "TLS",
      auth: { user: mailbox.username, pass: password },
      tls: { rejectUnauthorized: false },
      logger: false,
    });
    await client.connect();
    try {
      const folders = await client.list();
      const sentFolder =
        folders.find((f) => f.specialUse === "\\Sent")?.path ||
        folders.find((f) => /sent/i.test(f.path))?.path ||
        "INBOX.Sent";

      const boundary = "----=_Part_" + Date.now();
      const rawMime = [
        `From: ${emailData.from}`,
        `To: ${emailData.to}`,
        `Subject: ${emailData.subject}`,
        `Date: ${new Date().toUTCString()}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        emailData.text,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        emailData.html || emailData.text,
        ``,
        `--${boundary}--`,
      ].join("\r\n");

      const appendResult = await client.append(sentFolder, Buffer.from(rawMime), ["\\Seen"]);
      if (mailbox.id && appendResult && typeof appendResult.uid === "number") {
        updateMailboxSyncState(mailbox.id, { sentUid: appendResult.uid });
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  } catch (err) {
    console.warn("Could not append sent message to IMAP Sent folder:", err);
  }
}

export async function sendFromMailbox(
  mailbox: MailboxSenderInfo,
  data: { to: string; subject: string; body: string; html?: string }
) {
  if (!mailbox.encryptedCredentials || !mailbox.username) {
    throw new Error("Mailbox credentials are not configured.");
  }

  // 1. Company / Display Name resolution
  // Company name is taken directly from the mailbox Display Name.
  // When received by Gmail/Outlook, the display name appears in BOLD in the recipient inbox.
  const cleanDisplayName = mailbox.displayName?.trim();
  let companyName = cleanDisplayName;

  // Fallback: If display name is not set, derive clean company name from email domain
  if (!companyName && mailbox.emailAddress.includes("@")) {
    const domainPart = mailbox.emailAddress.split("@")[1]?.split(".")[0] || "";
    if (domainPart) {
      if (domainPart.toLowerCase() === "swiftorbits") {
        companyName = "Swift Orbits";
      } else {
        companyName = domainPart.charAt(0).toUpperCase() + domainPart.slice(1);
      }
    }
  }

  // 2. RFC 5322 formatted sender: "Company Name" <user@domain.com>
  // Email clients render the company name in BOLD in the recipient inbox and header.
  const formattedFrom = companyName
    ? `"${companyName.replace(/"/g, '')}" <${mailbox.emailAddress}>`
    : mailbox.emailAddress;

  // 3. Dual Plaintext + HTML format for crisp professional rendering
  const textBody = data.body;
  const htmlBody = data.html || formatEmailBodyToHtml(textBody);

  const sendResult = await sendSmtp(
    {
      host: mailbox.smtpHost,
      port: mailbox.smtpPort,
      security: mailbox.smtpSecurity,
      username: mailbox.username,
      password: passwordFromMailbox(mailbox.encryptedCredentials),
    },
    {
      from: formattedFrom,
      to: data.to,
      subject: data.subject,
      text: textBody,
      html: htmlBody,
    }
  );

  // Real-time synchronization: Append sent message to Hostinger IMAP Sent folder
  try {
    await Promise.race([
      appendToSentFolder(mailbox, {
        from: formattedFrom,
        to: data.to,
        subject: data.subject,
        text: textBody,
        html: htmlBody,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("IMAP Sent sync timed out")), 8000)),
    ]);
  } catch (err) {
    console.warn("Could not append sent message to IMAP Sent folder:", err);
  }

  return sendResult;
}
