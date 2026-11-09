import { simpleParser } from "mailparser";
import { prisma } from "@/lib/prisma";
import { passwordFromMailbox } from "@/lib/email/mailbox-service";
import { createImapClient } from "@/lib/email/imap";
import { withWorkerLease } from "@/lib/queue/lease";
import { updateCampaignProgress } from "@/lib/campaign-controls";
import { safeErrorMessage } from "@/lib/auth";
import { getMailboxSyncState, updateMailboxSyncState } from "@/lib/email/sync-checkpoint";

function normalizeEmail(value: string | undefined) { return (value ?? "").trim().toLowerCase().replace(/^<|>$/g, ""); }
function normalizeSubject(value: string) { return value.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").trim().toLowerCase(); }
function headerValues(value: string | string[] | undefined) { return (Array.isArray(value) ? value : value ? [value] : []).flatMap((item) => item.split(/\s+/).filter(Boolean)); }
function extractAddress(field: any): string {
  if (!field) return "";
  if (Array.isArray(field)) {
    return field[0]?.value?.[0]?.address || field[0]?.text || "";
  }
  return field.value?.[0]?.address || field.text || "";
}

async function matchReply(userId: string, mailboxId: string, sender: string, subject: string, inReplyTo: string | undefined, references: string[]) {
  const headers = [normalizeEmail(inReplyTo), ...references.map(normalizeEmail)].filter(Boolean);
  const candidates = [...new Set([...headers, ...headers.map((header) => `<${header}>`)])];
  if (candidates.length) {
    const matched = await prisma.emailMessage.findFirst({ where: { userId, mailboxId, direction: "OUTBOUND", status: "SENT", OR: [{ providerMessageId: { in: candidates } }, { internetMessageId: { in: candidates } }, { threadId: { in: candidates } }] }, orderBy: { sentAt: "desc" } });
    if (matched?.recipientId) return matched;
  }
  const outbound = await prisma.emailMessage.findMany({ where: { userId, mailboxId, toAddress: sender, direction: "OUTBOUND", status: "SENT", recipientId: { not: null } }, orderBy: { sentAt: "desc" }, take: 100 });
  const matches = outbound.filter((message) => normalizeSubject(message.subject) === normalizeSubject(subject));
  // A repeated subject across different campaigns is ambiguous without reply headers.
  if (matches.length > 0) {
    return new Set(matches.map((message) => message.recipientId)).size === 1 ? matches[0] : null;
  }
  // Smart fallback: if the sender only has 1 outbound campaign recipient, or has an active follow-up pending, match it
  if (outbound.length > 0) {
    const recipients = [...new Set(outbound.map((m) => m.recipientId).filter(Boolean))];
    if (recipients.length === 1) return outbound[0];
    const activeFollowUp = await prisma.scheduledJob.findFirst({
      where: { campaignRecipientId: { in: recipients as string[] }, jobType: "FOLLOW_UP", status: "PENDING" },
      select: { campaignRecipientId: true },
    });
    if (activeFollowUp?.campaignRecipientId) {
      return outbound.find((m) => m.recipientId === activeFollowUp.campaignRecipientId) ?? outbound[0];
    }
  }
  return null;
}

type Inbound = { userId: string; mailboxId: string; sender: string; recipient: string; subject: string; body: string; messageId: string; inReplyTo?: string; references?: string[]; receivedAt?: Date };
export async function processSimulatedInbound(input: Inbound) {
  const messageId = normalizeEmail(input.messageId);
  const mailbox = await prisma.mailbox.findFirst({ where: { id: input.mailboxId, userId: input.userId }, select: { id: true } });
  if (!mailbox) throw new Error("Mailbox is unavailable.");
  const existing = await prisma.emailMessage.findFirst({ where: { userId: input.userId, mailboxId: input.mailboxId, direction: "INBOUND", internetMessageId: messageId } });
  if (existing) return { duplicate: true, matched: false, messageId };
  const sender = normalizeEmail(input.sender); const references = (input.references ?? []).map(normalizeEmail);
  const inReplyTo = normalizeEmail(input.inReplyTo);
  const match = await matchReply(input.userId, input.mailboxId, sender, input.subject, inReplyTo, references);
  const receivedAt = input.receivedAt ?? new Date();
  const threadId = match?.threadId ?? match?.providerMessageId ?? messageId;
  const inbound = await prisma.$transaction(async (tx) => {
    // Match the lock order used by the queue submission gate.
    if (match?.campaignId) await tx.campaign.updateMany({ where: { id: match.campaignId, userId: input.userId }, data: { updatedAt: new Date() } });
    const safeSubject = String(input.subject || "(no subject)").slice(0, 190);
    const safeSender = sender.slice(0, 190);
    const safeRecipient = input.recipient.slice(0, 190);
    const safeMsgId = messageId.slice(0, 190);
    const safeThreadId = threadId.slice(0, 190);
    const record = await tx.emailMessage.create({
      data: {
        userId: input.userId,
        mailboxId: input.mailboxId,
        campaignId: match?.campaignId,
        contactId: match?.contactId,
        recipientId: match?.recipientId,
        toAddress: safeRecipient,
        fromAddress: safeSender,
        subject: safeSubject,
        body: (input.body || "").slice(0, 65000),
        status: match ? "REPLIED" : "PENDING",
        direction: "INBOUND",
        providerMessageId: safeMsgId,
        internetMessageId: safeMsgId,
        inReplyTo: inReplyTo ? inReplyTo.slice(0, 190) : null,
        references: references.join(" ") || null,
        threadId: safeThreadId,
        receivedAt,
      },
    });
    await tx.emailLog.create({
      data: {
        userId: input.userId,
        messageId: record.id,
        campaignId: match?.campaignId,
        mailboxId: input.mailboxId,
        contactId: match?.contactId,
        sender: safeSender,
        recipient: safeRecipient,
        subject: safeSubject,
        status: match ? "REPLIED" : "QUEUED",
        message: match ? "Campaign reply received. Pending follow-ups stopped." : "Inbound message received.",
        providerMessageId: safeMsgId,
      },
    });
    if (match?.recipientId) {
      await tx.campaignRecipient.update({ where: { id: match.recipientId }, data: { status: "REPLIED", repliedAt: receivedAt, lastInboundAt: receivedAt, lastInboundMessageId: messageId, threadId } });
      if (match.contactId) {
        await tx.contact.updateMany({ where: { id: match.contactId, userId: input.userId }, data: { status: "REPLIED" } });
      }
      await tx.scheduledJob.updateMany({ where: { userId: input.userId, campaignRecipientId: match.recipientId, jobType: "FOLLOW_UP", OR: [{ status: "PENDING" }, { status: "PROCESSING", deliveryState: "NOT_STARTED" }] }, data: { status: "CANCELLED", processedAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastError: "Cancelled because recipient replied." } });
    }
    return record;
  });
  if (match?.campaignId) await updateCampaignProgress(match.campaignId);
  return { duplicate: false, matched: Boolean(match), messageId, inboundId: inbound.id, recipientId: match?.recipientId };
}

type SyncMailbox = { id: string; userId: string; emailAddress: string; username: string | null; encryptedCredentials: string | null; imapHost: string; imapPort: number; imapSecurity: string };
async function syncMailboxUnsafe(mailbox: SyncMailbox) {
  if (process.env.EMAIL_TEST_MODE === "true") return { mailboxId: mailbox.id, processed: 0, matched: 0, skipped: "EMAIL_TEST_MODE" };
  if (!mailbox.username || !mailbox.encryptedCredentials) throw new Error("Mailbox credentials unavailable.");
  const client = createImapClient({ host: mailbox.imapHost, port: mailbox.imapPort, security: mailbox.imapSecurity, username: mailbox.username, password: passwordFromMailbox(mailbox.encryptedCredentials) });
  let processed = 0;
  let matched = 0;

  try {
    await client.connect();

    // Dynamically discover available Hostinger folders
    let folderList: Array<{ path: string; specialUse?: string }> = [];
    try {
      folderList = await client.list();
    } catch {
      folderList = [
        { path: "INBOX", specialUse: "\\Inbox" },
        { path: "Sent", specialUse: "\\Sent" },
        { path: "Drafts", specialUse: "\\Drafts" },
      ];
    }

    const inboxFolder =
      folderList.find((f) => f.specialUse === "\\Inbox") ||
      folderList.find((f) => /^inbox$/i.test(f.path)) || { path: "INBOX" };

    const sentFolder =
      folderList.find((f) => f.specialUse === "\\Sent") ||
      folderList.find((f) => /sent/i.test(f.path));

    const draftsFolder =
      folderList.find((f) => f.specialUse === "\\Drafts") ||
      folderList.find((f) => /draft/i.test(f.path));

    // 1. Sync INBOX (Real incoming messages from Hostinger) - STRICT READ-ONLY
    if (inboxFolder) {
      try {
        const lock = await client.getMailboxLock(inboxFolder.path, { readOnly: true });
        try {
          const syncState = getMailboxSyncState(mailbox.id);
          let targetUids: number[] = [];

          if (syncState.inboxUid !== undefined && syncState.inboxUid > 0) {
            // Incremental sync: Only search for UIDs >= last known UID
            const found = await client.search({ uid: `${syncState.inboxUid}:*` }, { uid: true });
            const rawUids = found === false ? [] : found;
            targetUids = rawUids.filter((u) => u > syncState.inboxUid!);
          } else {
            // First time initialization: find current max UID and set baseline so historical mails aren't dumped
            const found = await client.search({ all: true }, { uid: true });
            const rawUids = found === false ? [] : found;
            const maxUid = rawUids.length > 0 ? Math.max(...rawUids) : 0;
            updateMailboxSyncState(mailbox.id, { inboxUid: maxUid });
            targetUids = [];
          }

          if (targetUids.length > 0) {
            for (let offset = 0; offset < targetUids.length; offset += 50) {
              const batch = targetUids.slice(offset, offset + 50);
              for await (const item of client.fetch(batch, { uid: true, source: true, internalDate: true }, { uid: true })) {
                if (!item.source) continue;
                const parsed = await simpleParser(item.source);
                const sender = normalizeEmail(parsed.from?.value?.[0]?.address);
                if (!sender) continue;
                const messageId =
                  parsed.messageId || `imap-${client.mailbox && client.mailbox.uidValidity}-${item.uid}@${mailbox.id}`;
                const result = await processSimulatedInbound({
                  userId: mailbox.userId,
                  mailboxId: mailbox.id,
                  sender,
                  recipient: mailbox.emailAddress,
                  subject: parsed.subject ?? "(no subject)",
                  body: parsed.text ?? "",
                  messageId,
                  inReplyTo: parsed.inReplyTo,
                  references: headerValues(parsed.references),
                  receivedAt: item.internalDate instanceof Date ? item.internalDate : new Date(),
                });
                if (!result.duplicate) processed++;
                if (result.matched) matched++;
              }
            }
            const newMax = Math.max(...targetUids);
            updateMailboxSyncState(mailbox.id, { inboxUid: newMax });
          }
        } finally {
          lock.release();
        }
      } catch (err) {
        console.warn(`INBOX sync error for ${mailbox.emailAddress}:`, err);
      }
    }

    // 2. Sync Sent Folder (Real sent emails from Hostinger webmail) - STRICT READ-ONLY
    if (sentFolder) {
      try {
        const lock = await client.getMailboxLock(sentFolder.path, { readOnly: true });
        try {
          const syncState = getMailboxSyncState(mailbox.id);
          let targetUids: number[] = [];

          if (syncState.sentUid !== undefined && syncState.sentUid > 0) {
            const found = await client.search({ uid: `${syncState.sentUid}:*` }, { uid: true });
            const rawUids = found === false ? [] : found;
            targetUids = rawUids.filter((u) => u > syncState.sentUid!);
          } else {
            const found = await client.search({ all: true }, { uid: true });
            const rawUids = found === false ? [] : found;
            const maxUid = rawUids.length > 0 ? Math.max(...rawUids) : 0;
            updateMailboxSyncState(mailbox.id, { sentUid: maxUid });
            targetUids = [];
          }

          if (targetUids.length > 0) {
            for (let offset = 0; offset < targetUids.length; offset += 50) {
              const batch = targetUids.slice(offset, offset + 50);
              for await (const item of client.fetch(batch, { uid: true, source: true, internalDate: true }, { uid: true })) {
                if (!item.source) continue;
                const parsed = await simpleParser(item.source);
                const to = normalizeEmail(extractAddress(parsed.to)) || "";
                const messageId =
                  parsed.messageId || `sent-${client.mailbox && client.mailbox.uidValidity}-${item.uid}@${mailbox.id}`;
                const existing = await prisma.emailMessage.findFirst({
                  where: {
                    userId: mailbox.userId,
                    mailboxId: mailbox.id,
                    direction: "OUTBOUND",
                    status: "SENT",
                    OR: [{ internetMessageId: messageId }, { providerMessageId: messageId }],
                  },
                });
                if (!existing) {
                  const sentDate = item.internalDate instanceof Date ? item.internalDate : new Date();
                  await prisma.emailMessage.create({
                    data: {
                      userId: mailbox.userId,
                      mailboxId: mailbox.id,
                      toAddress: to.slice(0, 190),
                      fromAddress: mailbox.emailAddress,
                      subject: String(parsed.subject ?? "(no subject)").slice(0, 190),
                      body: (parsed.text ?? "").slice(0, 65000),
                      status: "SENT",
                      direction: "OUTBOUND",
                      providerMessageId: messageId,
                      internetMessageId: messageId,
                      sentAt: sentDate,
                      createdAt: sentDate,
                    },
                  });
                  processed++;
                }
              }
            }
            const newMax = Math.max(...targetUids);
            updateMailboxSyncState(mailbox.id, { sentUid: newMax });
          }
        } finally {
          lock.release();
        }
      } catch (err) {
        console.warn(`Sent sync error for ${mailbox.emailAddress}:`, err);
      }
    }

    // 3. Sync Drafts Folder (Real draft emails from Hostinger webmail)
    if (draftsFolder) {
      try {
        const lock = await client.getMailboxLock(draftsFolder.path);
        try {
          const found = await client.search({ all: true }, { uid: true });
          const uids = found === false ? [] : found;
          // Limit drafts sync to latest 50 messages
          const targetUids = uids.length > 50 ? uids.slice(-50) : uids;
          for (let offset = 0; offset < targetUids.length; offset += 50) {
            for await (const item of client.fetch(targetUids.slice(offset, offset + 50), { uid: true, source: true, internalDate: true }, { uid: true })) {
              if (!item.source) continue;
              const parsed = await simpleParser(item.source);
              const to = normalizeEmail(extractAddress(parsed.to)) || "";
              const messageId =
                parsed.messageId || `draft-${client.mailbox && client.mailbox.uidValidity}-${item.uid}@${mailbox.id}`;
              const existing = await prisma.emailMessage.findFirst({
                where: {
                  userId: mailbox.userId,
                  mailboxId: mailbox.id,
                  direction: "OUTBOUND",
                  status: "PENDING",
                  OR: [{ internetMessageId: messageId }, { providerMessageId: messageId }],
                },
              });
              if (!existing) {
                const draftDate = item.internalDate instanceof Date ? item.internalDate : new Date();
                await prisma.emailMessage.create({
                  data: {
                    userId: mailbox.userId,
                    mailboxId: mailbox.id,
                    toAddress: to.slice(0, 190),
                    fromAddress: mailbox.emailAddress,
                    subject: String(parsed.subject ?? "(no subject)").slice(0, 190),
                    body: (parsed.text ?? "").slice(0, 65000),
                    status: "PENDING",
                    direction: "OUTBOUND",
                    providerMessageId: messageId,
                    internetMessageId: messageId,
                    createdAt: draftDate,
                  },
                });
                processed++;
              }
            }
          }
        } finally {
          lock.release();
        }
      } catch (err) {
        console.warn(`Drafts sync error for ${mailbox.emailAddress}:`, err);
      }
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  await prisma.mailbox.update({
    where: { id: mailbox.id },
    data: { lastCheckedAt: new Date(), lastSuccessfulAt: new Date(), lastError: null },
  }).catch(() => undefined);
  return { mailboxId: mailbox.id, processed, matched };
}
export type InboxSyncResult = { mailboxId: string; processed: number; matched: number; skipped?: string; error?: string };
async function syncMailbox(mailbox: SyncMailbox): Promise<InboxSyncResult> {
  try {
    const result = await withWorkerLease(`inbox-sync:${mailbox.id}`, 120000, () => syncMailboxUnsafe(mailbox));
    return result.acquired ? result.value : { mailboxId: mailbox.id, processed: 0, matched: 0, skipped: "lease-held" };
  } catch (error) {
    return { mailboxId: mailbox.id, processed: 0, matched: 0, error: safeErrorMessage(error) };
  }
}
export async function syncUserMailboxes(userId: string, mailboxId?: string) {
  const mailboxes = await prisma.mailbox.findMany({ where: { userId, ...(mailboxId ? { id: mailboxId } : {}), status: "ACTIVE", imapStatus: "CONNECTED" } });
  const results = []; for (const mailbox of mailboxes) results.push(await syncMailbox(mailbox)); return results;
}
export async function syncAllMailboxes() {
  const mailboxes = await prisma.mailbox.findMany({ where: { status: "ACTIVE", imapStatus: "CONNECTED" } });
  const results = []; for (const mailbox of mailboxes) results.push(await syncMailbox(mailbox)); return results;
}
