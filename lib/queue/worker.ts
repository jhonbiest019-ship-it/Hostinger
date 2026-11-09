import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { safeErrorMessage } from "@/lib/auth";
import { sendFromMailbox } from "@/lib/email/send-service";
import { isTemporaryEmailFailure, isAmbiguousEmailFailure } from "@/lib/email/failure";
import { renderTemplate } from "@/lib/email/template";
import { queueConfig } from "@/lib/schedule";
import { withWorkerLease } from "@/lib/queue/lease";
import { RUNNING_STATUSES, updateCampaignProgress } from "@/lib/campaign-controls";
import { DEFAULT_TIMEZONE } from "@/lib/preferences";
import { syncRecipientToGoogleSheet } from "@/lib/google-sheets-sync";

export async function recoverExpiredJobs() {
  const now = new Date();
  const expired = await prisma.scheduledJob.findMany({ where: { status: "PROCESSING", leaseExpiresAt: { lt: now } } });
  let requeued = 0; let ambiguous = 0;
  for (const job of expired) {
    const safe = job.deliveryState === "NOT_STARTED";
    const result = await prisma.scheduledJob.updateMany({
      where: { id: job.id, status: "PROCESSING", leaseExpiresAt: { lt: now }, deliveryState: job.deliveryState },
      data: { status: safe ? "PENDING" : "FAILED", deliveryState: safe ? "NOT_STARTED" : "UNKNOWN", processedAt: safe ? null : now, leaseToken: null, leaseExpiresAt: null, lastError: safe ? "Recovered before SMTP submission." : "Delivery outcome unknown; check the mailbox before sending again." },
    });
    if (safe) requeued += result.count; else ambiguous += result.count;
    if (result.count && !safe) {
      if (job.campaignRecipientId) await prisma.campaignRecipient.updateMany({ where: { id: job.campaignRecipientId, status: { in: ["PENDING", "SENDING"] } }, data: { status: "FAILED" } });
      if (job.messageId) {
        await prisma.emailMessage.updateMany({ where: { id: job.messageId, status: "SENDING" }, data: { status: "FAILED", errorMessage: "Delivery outcome unknown after worker interruption." } });
        await prisma.emailLog.updateMany({ where: { messageId: job.messageId, status: "SENDING" }, data: { status: "FAILED", message: "Delivery outcome unknown after worker interruption." } });
      }
      if (job.campaignId) await updateCampaignProgress(job.campaignId);
    }
  }
  return { inspected: expired.length, requeued, ambiguous };
}

export async function claimDueJob(id: string, leaseMs = queueConfig().leaseMs) {
  const now = new Date(); const leaseToken = crypto.randomBytes(24).toString("base64url");
  const result = await prisma.scheduledJob.updateMany({ where: { id, status: "PENDING", OR: [{ runAt: { lte: now }, nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, data: { status: "PROCESSING", deliveryState: "NOT_STARTED", attempts: { increment: 1 }, lastAttemptAt: now, leaseToken, leaseExpiresAt: new Date(now.getTime() + leaseMs) } });
  return result.count === 1 ? leaseToken : null;
}

async function scheduleNextFollowUp(campaignId: string, recipientId: string, currentStep: number, sentAt: Date) {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.campaign.updateMany({ where: { id: campaignId, status: { in: [...RUNNING_STATUSES, "PAUSED"] }, followUpsEnabled: true }, data: { updatedAt: new Date() } });
    if (!locked.count) return;
    const recipient = await tx.campaignRecipient.findUnique({ where: { id: recipientId } });
    if (!recipient || recipient.repliedAt || ["REPLIED", "CANCELLED"].includes(recipient.status)) return;
    const rule = await tx.followUpRule.findFirst({ where: { campaignId, enabled: true, stepNumber: { gt: currentStep }, status: "ACTIVE" }, orderBy: { stepNumber: "asc" } });
    if (!rule) return;
    const delayMs = rule.delayAmount * (rule.delayUnit === "MINUTES" ? 60000 : rule.delayUnit === "HOURS" ? 3600000 : 86400000);
    await tx.scheduledJob.upsert({
      where: { campaignRecipientId_jobType_followUpStep: { campaignRecipientId: recipientId, jobType: "FOLLOW_UP", followUpStep: rule.stepNumber } },
      update: {},
      create: { userId: rule.userId, campaignId, campaignRecipientId: recipientId, followUpRuleId: rule.id, jobType: "FOLLOW_UP", followUpStep: rule.stepNumber, runAt: new Date(sentAt.getTime() + delayMs), timezone: rule.timezone ?? DEFAULT_TIMEZONE },
    });
  });
}

// Reconcile a successful send after a crash between saving delivery and creating the next step.
async function reconcileFollowUps() {
  const recipients = await prisma.campaignRecipient.findMany({
    where: { status: "SENT", repliedAt: null, campaign: { followUpsEnabled: true, status: { in: [...RUNNING_STATUSES, "PAUSED"] } }, scheduledJobs: { none: { status: { in: ["PENDING", "PROCESSING"] } } } },
    select: { id: true, campaignId: true, messages: { where: { status: "SENT", direction: "OUTBOUND" }, orderBy: { followUpStep: "desc" }, take: 1, select: { followUpStep: true, sentAt: true } } },
  });
  for (const recipient of recipients) {
    const last = recipient.messages[0];
    if (last?.sentAt) await scheduleNextFollowUp(recipient.campaignId, recipient.id, last.followUpStep ?? 0, last.sentAt);
    await updateCampaignProgress(recipient.campaignId);
  }
}

async function processJob(id: string, leaseToken: string, maxAttempts: number, leaseMs: number) {
  const job = await prisma.scheduledJob.findUnique({ where: { id }, include: { campaign: true, followUpRule: { include: { template: true } }, campaignRecipient: { include: { contact: true } } } });
  if (!job || job.status !== "PROCESSING" || job.leaseToken !== leaseToken) return "lost";
  const owned = { id, status: "PROCESSING" as const, leaseToken };
  const finish = async (status: "CANCELLED" | "FAILED", reason: string) => {
    await prisma.scheduledJob.updateMany({ where: owned, data: { status, processedAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastError: reason } });
    if (job.campaignRecipientId) await prisma.campaignRecipient.updateMany({ where: { id: job.campaignRecipientId, status: { in: ["PENDING", "SENDING"] } }, data: { status: status === "CANCELLED" ? "CANCELLED" : "FAILED" } });
    if (job.campaignId) await updateCampaignProgress(job.campaignId);
    return status === "FAILED" ? "failed" : "cancelled";
  };
  if (!job.campaign || !job.campaignRecipient) return finish("CANCELLED", "Campaign or recipient is unavailable.");
  const campaign = job.campaign; const recipient = job.campaignRecipient; const contact = recipient.contact;
  if (campaign.userId !== job.userId || contact.userId !== job.userId || recipient.campaignId !== campaign.id) return finish("FAILED", "Ownership validation failed.");
  if (campaign.status === "CANCELLED") return finish("CANCELLED", "Campaign cancelled.");
  if (!(RUNNING_STATUSES as readonly string[]).includes(campaign.status)) {
    await prisma.scheduledJob.updateMany({ where: owned, data: { status: "PENDING", attempts: { decrement: 1 }, leaseToken: null, leaseExpiresAt: null } }); return "paused";
  }
  if (recipient.repliedAt || recipient.status === "REPLIED") return finish("CANCELLED", "Recipient replied.");
  if (recipient.status === "CANCELLED") {
    // If the campaign is actively scheduled, sending or active, reactivate the recipient
    if ((RUNNING_STATUSES as readonly string[]).includes(campaign.status)) {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "PENDING", errorMessage: null },
      });
      recipient.status = "PENDING";
    } else {
      return finish("CANCELLED", "Recipient was cancelled.");
    }
  }
  if (job.jobType === "INITIAL_EMAIL" && recipient.status === "SENT") return finish("CANCELLED", "Initial email already sent.");
  if (["DO_NOT_CONTACT", "INVALID", "ARCHIVED"].includes(contact.status) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) return finish("FAILED", "Recipient is blocked, archived or has an invalid email.");
  if (job.jobType === "FOLLOW_UP") {
    if (!campaign.followUpsEnabled || !job.followUpRule?.enabled || job.followUpRule.status !== "ACTIVE" || job.followUpRule.userId !== job.userId || job.followUpRule.campaignId !== campaign.id) return finish("CANCELLED", "Follow-up is disabled or unavailable.");
    const previous = await prisma.emailMessage.count({ where: { recipientId: recipient.id, status: "SENT", followUpStep: { lt: job.followUpStep ?? 1 } } });
    if (!previous) return finish("FAILED", "Previous email was not sent.");
  }
  let mailbox = campaign.mailboxId ? await prisma.mailbox.findFirst({ where: { id: campaign.mailboxId, userId: job.userId } }) : null;
  if (!mailbox || mailbox.status !== "ACTIVE" || mailbox.smtpStatus !== "CONNECTED") {
    mailbox = await prisma.mailbox.findFirst({
      where: { userId: job.userId, status: "ACTIVE", smtpStatus: "CONNECTED" },
      orderBy: { createdAt: "desc" },
    });
  }
  const followUpTemplate = job.followUpRule?.template ?? (job.followUpRule?.templateId ? await prisma.template.findFirst({ where: { id: job.followUpRule.templateId, userId: job.userId } }) : null);
  const defaultTemplate = await prisma.template.findFirst({ where: { userId: job.userId, status: "ACTIVE", isDefault: true } });
  const campaignTemplate = (campaign.templateId ? await prisma.template.findFirst({ where: { id: campaign.templateId, userId: job.userId } }) : null) || defaultTemplate;
  const template = job.jobType === "FOLLOW_UP" ? (followUpTemplate || campaignTemplate || defaultTemplate) : (campaignTemplate || defaultTemplate);

  const rawSubject = (job.jobType === "FOLLOW_UP" && job.followUpRule?.subject)
    ? job.followUpRule.subject
    : (template?.subject ?? "");
  const rawBody = (job.jobType === "FOLLOW_UP" && job.followUpRule?.body)
    ? job.followUpRule.body
    : (template?.body ?? "");

  if (!mailbox || mailbox.status !== "ACTIVE" || mailbox.smtpStatus !== "CONNECTED" || (!template && (!rawSubject || !rawBody))) return finish("FAILED", "Mailbox or template is unavailable. Verify the connection and selected template.");
  const variables = {
    firstName: contact.firstName,
    lastName: contact.lastName,
    fullName: contact.fullName ?? contact.name,
    brandName: recipient.snapshotBrand ?? contact.brandName ?? contact.companyName ?? contact.company ?? contact.name ?? "",
    companyName: contact.companyName ?? contact.company ?? recipient.snapshotBrand ?? contact.brandName ?? contact.name,
    email: contact.email,
    phone: contact.phone,
    website: contact.website,
    formUrl: contact.formUrl,
    asin: contact.formUrl ?? "",
    amazonLink: contact.website ?? "",
    productCategory: recipient.productCategory ?? contact.notes ?? "",
    category: recipient.productCategory ?? contact.notes ?? "",
    notes: contact.notes,
  };
  const subject = renderTemplate(rawSubject, variables); const body = renderTemplate(rawBody, variables);
  // Serialize with pause/cancel and reply handling immediately before handing a message to SMTP.
  const submission = await prisma.$transaction(async (tx) => {
    const active = await tx.campaign.updateMany({ where: { id: campaign.id, userId: job.userId, status: { in: [...RUNNING_STATUSES] } }, data: { updatedAt: new Date() } });
    if (!active.count) return null;
    const current = await tx.campaignRecipient.findUnique({ where: { id: recipient.id } });
    if (!current || current.repliedAt || ["REPLIED", "CANCELLED"].includes(current.status)) return null;
    const claimed = await tx.scheduledJob.updateMany({ where: { ...owned, deliveryState: "NOT_STARTED" }, data: { deliveryState: "IN_FLIGHT", leaseExpiresAt: new Date(Date.now() + leaseMs) } });
    if (!claimed.count) return null;
    await tx.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "SENDING" } });
    const message = await tx.emailMessage.create({ data: { userId: job.userId, campaignId: campaign.id, mailboxId: mailbox.id, contactId: contact.id, templateId: template?.id || null, recipientId: recipient.id, followUpStep: job.followUpStep ?? 0, toAddress: contact.email, fromAddress: mailbox.emailAddress, subject, body, status: "SENDING", scheduledAt: job.runAt } });
    const log = await tx.emailLog.create({ data: { userId: job.userId, messageId: message.id, campaignId: campaign.id, mailboxId: mailbox.id, contactId: contact.id, followUpStep: job.followUpStep ?? 0, sender: mailbox.emailAddress, recipient: contact.email, subject, status: "SENDING" } });
    await tx.scheduledJob.update({ where: { id }, data: { messageId: message.id } });
    return { message, log };
  });
  if (!submission) {
    await prisma.scheduledJob.updateMany({ where: { ...owned, deliveryState: "NOT_STARTED" }, data: { status: "PENDING", attempts: { decrement: 1 }, leaseToken: null, leaseExpiresAt: null } });
    return "deferred";
  }
  let result: Awaited<ReturnType<typeof sendFromMailbox>>;
  const heartbeat = setInterval(() => {
    void prisma.scheduledJob.updateMany({ where: owned, data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } }).catch(() => undefined);
  }, Math.max(1000, Math.floor(leaseMs / 3)));
  try {
    result = await sendFromMailbox(mailbox, { to: contact.email, subject, body });
  } catch (error) {
    const ambiguous = isAmbiguousEmailFailure(error);
    const retry = !ambiguous && isTemporaryEmailFailure(error) && job.attempts < maxAttempts;
    const reason = ambiguous ? "Delivery outcome unknown. Check the mailbox before sending again." : safeErrorMessage(error);
    let retryAllowed = false;
    await prisma.$transaction(async (tx) => {
      await tx.campaign.updateMany({ where: { id: campaign.id }, data: { updatedAt: new Date() } });
      const current = await tx.campaign.findUnique({ where: { id: campaign.id } });
      const state = await tx.campaignRecipient.findUnique({ where: { id: recipient.id } });
      const stopped = current?.status === "CANCELLED" || Boolean(state?.repliedAt) || state?.status === "CANCELLED";
      retryAllowed = retry && !stopped;
      await tx.scheduledJob.updateMany({ where: owned, data: { status: stopped ? "CANCELLED" : retryAllowed ? "PENDING" : "FAILED", deliveryState: ambiguous ? "UNKNOWN" : "NOT_STARTED", nextAttemptAt: retryAllowed ? new Date(Date.now() + Math.min(3600000, 2 ** job.attempts * 30000)) : null, processedAt: retryAllowed ? null : new Date(), leaseToken: null, leaseExpiresAt: null, lastError: reason } });
      await tx.emailMessage.update({ where: { id: submission.message.id }, data: { status: "FAILED", errorMessage: reason } });
      await tx.emailLog.update({ where: { id: submission.log.id }, data: { status: "FAILED", message: retryAllowed ? reason + " Retry scheduled." : reason } });
      await tx.campaignRecipient.updateMany({ where: { id: recipient.id, status: "SENDING", repliedAt: null }, data: { status: stopped ? "CANCELLED" : retryAllowed ? "PENDING" : "FAILED", errorMessage: reason } });
    });
    if (!retryAllowed) {
      void syncRecipientToGoogleSheet(recipient.id).catch(() => undefined);
    }
    await updateCampaignProgress(campaign.id); return retry ? "retry" : "failed";
  } finally { clearInterval(heartbeat); }
  // A database error after SMTP success must never be classified as a retryable send error.
  const sentAt = new Date(); const providerMessageId = result.messageId || null;
  await prisma.$transaction([
    prisma.emailMessage.update({ where: { id: submission.message.id }, data: { status: "SENT", sentAt, providerMessageId, internetMessageId: providerMessageId } }),
    prisma.emailLog.update({ where: { id: submission.log.id }, data: { status: "SENT", providerMessageId, message: process.env.EMAIL_TEST_MODE === "true" ? "Simulated send (test mode); no email delivered." : "Accepted by SMTP server." } }),
    prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "SENDING", repliedAt: null }, data: { status: "SENT", sentAt } }),
    prisma.scheduledJob.updateMany({ where: owned, data: { status: "COMPLETED", deliveryState: "CONFIRMED", processedAt: sentAt, nextAttemptAt: null, leaseToken: null, leaseExpiresAt: null, lastError: null } }),
  ]);
  void syncRecipientToGoogleSheet(recipient.id).catch(() => undefined);
  await scheduleNextFollowUp(campaign.id, recipient.id, job.followUpStep ?? 0, sentAt);
  await updateCampaignProgress(campaign.id);
  return "sent";
}

export async function processDueJobs(options: { blockedMailboxIds?: string[] } = {}) {
  const config = queueConfig();
  return (await withWorkerLease("queue", config.leaseMs, async () => {
    const recovery = await recoverExpiredJobs();
    await reconcileFollowUps();
    const now = new Date();
    if (options.blockedMailboxIds?.length) await prisma.scheduledJob.updateMany({ where: { status: "PENDING", jobType: "FOLLOW_UP", campaign: { mailboxId: { in: options.blockedMailboxIds } } }, data: { lastError: "Waiting for a successful inbox sync before sending follow-ups. Check the mailbox connection." } });
    const due = await prisma.scheduledJob.findMany({ where: { status: "PENDING", NOT: { jobType: "FOLLOW_UP", campaign: { mailboxId: { in: options.blockedMailboxIds ?? [] } } }, campaign: { status: { in: [...RUNNING_STATUSES] } }, OR: [{ runAt: { lte: now }, nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, orderBy: { runAt: "asc" }, take: config.maxJobs, select: { id: true } });
    let processed = 0; let sent = 0; let failed = 0;
    for (const job of due) {
      const token = await claimDueJob(job.id, config.leaseMs); if (!token) continue;
      try {
        const result = await processJob(job.id, token, config.maxAttempts, config.leaseMs);
        if (result === "sent") sent++; if (result === "failed") failed++;
      } catch {
        // Leave the lease for conservative recovery; one broken job must not stop the batch.
        console.error("queue_job_failed", { jobId: job.id, message: "Processing interrupted; the lease recovery will inspect delivery state." }); failed++;
      }
      processed++;
      if (config.delayMs) await new Promise((resolve) => setTimeout(resolve, config.delayMs));
    }
    return { discovered: due.length, processed, sent, failed, recovered: recovery };
  })).value ?? { discovered: 0, processed: 0, sent: 0, failed: 0, skipped: "lease-held" };
}
