import crypto from "crypto";
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

export function sanitizeOutreachBody(body: string): string {
  if (!body) return "";
  return body
    // Remove HubSpot, SignatureHound or generator image/icon placeholders
    .replace(/(mobilePhone|emailAddress|address|phone|email)\s*\[https?:\/\/[^\]]+\]/gi, "")
    .replace(/\[https?:\/\/[^\]]+(?:hubspot|signaturehound|signature-generator|icons)[^\]]*\]/gi, "")
    // Remove redundant markdown tel links: "321-359-6688 [tel:3213596688]" -> "321-359-6688"
    .replace(/([0-9+() -]{7,})\s*\[tel:[^\]]+\]/gi, "$1")
    // Remove redundant markdown email links: "sales@domain.com [mailto:sales@domain.com]" or "sales@domain.com [info@domain.com]" -> "sales@domain.com"
    .replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*\[(?:mailto:)?[^\]]+\]/gi, "$1")
    // Remove question mark artifacts
    .replace(/\?\?\s*([0-9+() -]{7,})/g, "$1")
    .replace(/\?\?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, "$1")
    .replace(/\?\?\s*([0-9]{1,5}\s+[A-Za-z0-9\s,.-]+)/g, "$1")
    // Collapse excess newlines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendFromMailbox(
  mailbox: MailboxSenderInfo,
  data: { to: string; subject: string; body: string; html?: string }
) {
  if (!mailbox.encryptedCredentials || !mailbox.username) {
    throw new Error("Mailbox credentials are not configured.");
  }

  const normalizedEmail = mailbox.emailAddress.trim().toLowerCase();

  // 1. Company / Display Name resolution
  // Company name is taken directly from the mailbox Display Name.
  // When received by Gmail/Outlook, the display name appears in BOLD in the recipient inbox.
  const cleanDisplayName = mailbox.displayName?.trim();
  let companyName = cleanDisplayName;

  // Fallback: If display name is not set, derive clean company name from email domain
  if (!companyName && normalizedEmail.includes("@")) {
    const domainPart = normalizedEmail.split("@")[1]?.split(".")[0] || "";
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
    ? `"${companyName.replace(/"/g, '')}" <${normalizedEmail}>`
    : normalizedEmail;

  // 3. Clean and sanitize body to prevent spam filtering from corrupted characters
  const cleanTextBody = sanitizeOutreachBody(data.body);

  // Dual Plaintext + HTML format for crisp professional rendering
  const textBody = cleanTextBody;
  const htmlBody = data.html || formatEmailBodyToHtml(textBody);

  // 4. Domain-aligned RFC 5322 Message-ID
  const domain = normalizedEmail.includes("@")
    ? normalizedEmail.split("@")[1].trim()
    : "swiftorbits.com";
  const customMessageId = `<${Date.now()}.${crypto.randomBytes(8).toString("hex")}@${domain}>`;

  const recipientMatch = data.to.match(/<([^>]+)>/);
  const cleanRecipient = (recipientMatch ? recipientMatch[1] : data.to).trim().toLowerCase();

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
      replyTo: normalizedEmail,
      messageId: customMessageId,
      envelope: {
        from: normalizedEmail,
        to: [cleanRecipient],
      },
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
    messageId: sendResult?.messageId || customMessageId,
  }).catch((err) => {
    console.warn("Background Hostinger Sent sync notice:", err);
  });

  return sendResult;
}
