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
  emailData: { from: string; to: string; subject: string; text: string; html?: string; messageId?: string }
) {
  if (!mailbox.username || !mailbox.encryptedCredentials) return;
  try {
    const password = passwordFromMailbox(mailbox.encryptedCredentials);
    // Resolve IMAP host for Hostinger or custom domain
    const imapHost =
      mailbox.imapHost ||
      (mailbox.smtpHost?.includes("hostinger.com") ? "imap.hostinger.com" : null) ||
      (mailbox.emailAddress.includes("@") ? `imap.${mailbox.emailAddress.split("@")[1]}` : null) ||
      "imap.hostinger.com";
    const imapPort = mailbox.imapPort || 993;
    const imapSecurity = mailbox.imapSecurity || "TLS";
    const imapUser = mailbox.username || mailbox.emailAddress;

    const client = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: imapSecurity === "TLS" || imapPort === 993,
      auth: { user: imapUser, pass: password },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
      logger: false,
    });

    await client.connect();
    try {
      let folders: Array<{ path: string; name?: string; specialUse?: string }> = [];
      try {
        folders = await client.list();
      } catch {
        folders = [];
      }

      // Hostinger / Dovecot Sent folder detection
      const sentCandidate =
        folders.find((f) => f.specialUse === "\\Sent")?.path ||
        folders.find((f) => /^(sent|inbox\.sent|sent messages|sent items)$/i.test(f.path))?.path ||
        folders.find((f) => /sent/i.test(f.name || f.path))?.path ||
        "Sent";

      const domain = mailbox.emailAddress.includes("@") ? mailbox.emailAddress.split("@")[1] : "hostinger.com";
      const cleanMsgId = emailData.messageId
        ? (emailData.messageId.startsWith("<") ? emailData.messageId : `<${emailData.messageId}>`)
        : `<${Date.now()}.${Math.random().toString(36).substring(2, 9)}@${domain}>`;

      const boundary = "----=_Part_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
      const rawMime = [
        `From: ${emailData.from}`,
        `To: ${emailData.to}`,
        `Subject: ${emailData.subject}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: ${cleanMsgId}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 8bit`,
        ``,
        emailData.text,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=utf-8`,
        `Content-Transfer-Encoding: 8bit`,
        ``,
        emailData.html || emailData.text,
        ``,
        `--${boundary}--`,
        ``,
      ].join("\r\n");

      // Candidate folders for Hostinger webmail
      const targets = [sentCandidate, "INBOX.Sent", "Sent", "Sent Messages", "Sent Items"].filter(
        (v, i, a) => v && a.indexOf(v) === i
      );

      for (const targetFolder of targets) {
        try {
          const appendResult = await client.append(targetFolder, Buffer.from(rawMime), ["\\Seen"]);
          if (appendResult) {
            if (mailbox.id && typeof appendResult.uid === "number") {
              updateMailboxSyncState(mailbox.id, { sentUid: appendResult.uid });
            }
            break;
          }
        } catch {
          // try next candidate target
        }
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
  // Backgrounded and non-blocking so SMTP delivery is instant and resilient
  void appendToSentFolder(mailbox, {
    from: formattedFrom,
    to: data.to,
    subject: data.subject,
    text: textBody,
    html: htmlBody,
    messageId: sendResult?.messageId,
  }).catch((err) => {
    console.warn("Background Hostinger Sent sync notice:", err);
  });

  return sendResult;
}
