import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { safeErrorMessage } from "@/lib/auth";
import { sendFromMailbox } from "@/lib/email/send-service";
import { isTemporaryEmailFailure } from "@/lib/email/failure";
import { renderTemplate } from "@/lib/email/template";
import { queueConfig } from "@/lib/schedule";
import { withWorkerLease } from "@/lib/queue/lease";

async function updateCampaignProgress(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
  if (!campaign || campaign.status === "CANCELLED") return;
  const jobs = await prisma.scheduledJob.count({ where: { campaignId, status: { in: ["PENDING", "PROCESSING"] } } });
  const recipients = await prisma.campaignRecipient.count({ where: { campaignId, status: { in: ["PENDING", "SENDING"] } } });
  if (!jobs && !recipients) await prisma.campaign.update({ where: { id: campaignId }, data: { status: "COMPLETED" } });
}

export async function recoverExpiredJobs() {
  const now = new Date();
  const expired = await prisma.scheduledJob.findMany({ where: { status: "PROCESSING", leaseExpiresAt: { lt: now } }, select: { id: true, campaignId: true, campaignRecipientId: true, deliveryState: true } });
  let requeued = 0; let ambiguous = 0;
  for (const job of expired) {
    if (job.deliveryState === "NOT_STARTED") {
      const result = await prisma.scheduledJob.updateMany({ where: { id: job.id, status: "PROCESSING", leaseExpiresAt: { lt: now }, deliveryState: "NOT_STARTED" }, data: { status: "PENDING", leaseToken: null, leaseExpiresAt: null, lastError: "Recovered after worker lease expired before SMTP submission." } });
      requeued += result.count;
    } else {
      const result = await prisma.scheduledJob.updateMany({ where: { id: job.id, status: "PROCESSING", leaseExpiresAt: { lt: now }, deliveryState: { in: ["IN_FLIGHT", "UNKNOWN"] } }, data: { status: "FAILED", deliveryState: "UNKNOWN", processedAt: now, leaseToken: null, leaseExpiresAt: null, lastError: "Delivery outcome unknown after worker lease expired; not retried automatically." } });
      ambiguous += result.count;
      if (result.count && job.campaignRecipientId) await prisma.campaignRecipient.updateMany({ where: { id: job.campaignRecipientId, status: { in: ["PENDING", "SENDING"] } }, data: { status: "FAILED" } });
    }
  }
  return { inspected: expired.length, requeued, ambiguous };
}

export async function claimDueJob(id: string, leaseMs = queueConfig().leaseMs) {
  const now = new Date(); const leaseToken = crypto.randomBytes(24).toString("base64url");
  const result = await prisma.scheduledJob.updateMany({ where: { id, status: "PENDING", OR: [{ runAt: { lte: now }, nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, data: { status: "PROCESSING", deliveryState: "NOT_STARTED", attempts: { increment: 1 }, lastAttemptAt: now, leaseToken, leaseExpiresAt: new Date(now.getTime() + leaseMs) } });
  return result.count === 1 ? leaseToken : null;
}

async function renewJobLease(id: string, leaseToken: string, leaseMs: number) {
  const result = await prisma.scheduledJob.updateMany({ where: { id, status: "PROCESSING", leaseToken }, data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } });
  return result.count === 1;
}

function delayMilliseconds(amount: number, unit: string) { return amount * (unit === "MINUTES" ? 60_000 : unit === "HOURS" ? 3_600_000 : 86_400_000); }

async function scheduleNextFollowUp(campaignId: string, recipientId: string, currentStep: number) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { userId: true, followUpsEnabled: true, stopFollowUpsOnReply: true } });
  const recipient = await prisma.campaignRecipient.findUnique({ where: { id: recipientId }, select: { status: true } });
  if (!campaign?.followUpsEnabled || (campaign.stopFollowUpsOnReply && recipient?.status === "REPLIED") || recipient?.status === "CANCELLED") return;
  const rule = await prisma.followUpRule.findFirst({ where: { campaignId, enabled: true, stepNumber: { gt: currentStep }, status: "ACTIVE" }, orderBy: { stepNumber: "asc" } });
  if (!rule) return;
  const existing = await prisma.scheduledJob.findUnique({ where: { campaignRecipientId_jobType_followUpStep: { campaignRecipientId: recipientId, jobType: "FOLLOW_UP", followUpStep: rule.stepNumber } } });
  if (existing) return;
  await prisma.scheduledJob.create({ data: { userId: campaign.userId, campaignId, campaignRecipientId: recipientId, followUpRuleId: rule.id, jobType: "FOLLOW_UP", followUpStep: rule.stepNumber, runAt: new Date(Date.now() + delayMilliseconds(rule.delayAmount, rule.delayUnit)), timezone: rule.timezone ?? "UTC", status: "PENDING" } });
}

async function failJob(job: { id: string; attempts: number; campaignId: string | null; campaignRecipientId: string | null; messageId: string | null; leaseToken: string | null }, message: string, temporary: boolean, maxAttempts: number) {
  const retry = temporary && job.attempts < maxAttempts; const nextAttemptAt = retry ? new Date(Date.now() + Math.min(60 * 60_000, 2 ** job.attempts * 30_000)) : null;
  const claimed = await prisma.scheduledJob.updateMany({ where: { id: job.id, status: "PROCESSING", leaseToken: job.leaseToken ?? undefined }, data: retry ? { status: "PENDING", deliveryState: "NOT_STARTED", nextAttemptAt, leaseToken: null, leaseExpiresAt: null, lastError: message } : { status: "FAILED", deliveryState: "UNKNOWN", processedAt: new Date(), nextAttemptAt: null, leaseToken: null, leaseExpiresAt: null, lastError: message } });
  if (!claimed.count) return "lost";
  const updates = [];
  if (job.campaignRecipientId) updates.push(prisma.campaignRecipient.update({ where: { id: job.campaignRecipientId }, data: { status: retry ? "PENDING" : "FAILED" } }));
  if (job.messageId) updates.push(prisma.emailMessage.update({ where: { id: job.messageId }, data: { status: "FAILED", errorMessage: message } }));
  if (updates.length) await prisma.$transaction(updates); if (!retry && job.campaignId) await updateCampaignProgress(job.campaignId); return retry ? "retry" : "failed";
}

async function processJob(id: string, leaseToken: string, maxAttempts: number, leaseMs: number) {
  const job = await prisma.scheduledJob.findUnique({ where: { id }, include: { campaign: true, followUpRule: true, campaignRecipient: { include: { contact: true } } } });
  if (!job || !job.campaignRecipient || !job.campaign || job.leaseToken !== leaseToken) return "lost";
  const recipient = job.campaignRecipient; const contact = recipient.contact;
  if (job.campaign.status === "CANCELLED") { await prisma.scheduledJob.updateMany({ where: { id, status: "PROCESSING", leaseToken }, data: { status: "CANCELLED", processedAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastError: "Campaign cancelled." } }); await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: { in: ["PENDING", "SENDING"] } }, data: { status: "CANCELLED" } }); return "cancelled"; }
  if (job.jobType === "INITIAL_EMAIL" && ["SENT", "REPLIED", "CANCELLED"].includes(recipient.status)) { await prisma.scheduledJob.updateMany({ where: { id, status: "PROCESSING", leaseToken }, data: { status: "COMPLETED", processedAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastError: "Recipient already processed; skipped duplicate job." } }); return "duplicate"; }
  if (job.jobType === "FOLLOW_UP" && (recipient.status === "REPLIED" || recipient.status === "CANCELLED" || job.campaign.stopFollowUpsOnReply && recipient.repliedAt)) { await prisma.scheduledJob.updateMany({ where: { id, status: "PROCESSING", leaseToken }, data: { status: "CANCELLED", processedAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastError: "Follow-up stopped because recipient replied or was cancelled." } }); return "cancelled"; }
  if (contact.status === "DO_NOT_CONTACT" || contact.status === "INVALID" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) return failJob(job, "Recipient skipped by contact policy or invalid email.", false, maxAttempts);
  if (job.jobType === "FOLLOW_UP" && job.followUpStep && !job.followUpRule) return failJob(job, "Follow-up rule is unavailable.", false, maxAttempts);
  if (job.jobType === "FOLLOW_UP" && job.followUpStep) { const previous = await prisma.emailMessage.count({ where: { recipientId: recipient.id, status: "SENT", followUpStep: { lt: job.followUpStep } } }); if (!previous) return failJob(job, "Previous required email was not sent.", false, maxAttempts); }
  const mailbox = job.campaign.mailboxId ? await prisma.mailbox.findFirst({ where: { id: job.campaign.mailboxId, userId: job.userId } }) : null;
  const templateId = job.jobType === "FOLLOW_UP" ? job.followUpRule?.templateId : job.campaign.templateId;
  const template = templateId ? await prisma.template.findFirst({ where: { id: templateId, userId: job.userId, status: "ACTIVE" } }) : null;
  if (!mailbox || mailbox.status !== "ACTIVE" || mailbox.smtpStatus !== "CONNECTED" || !template) return failJob(job, "Mailbox or template is unavailable.", false, maxAttempts);
  if (!(await renewJobLease(id, leaseToken, leaseMs))) return "lost";
  const variables = { firstName: contact.firstName, lastName: contact.lastName, fullName: contact.fullName ?? contact.name, brandName: contact.brandName, companyName: contact.companyName ?? contact.company, email: contact.email, phone: contact.phone, website: contact.website, formUrl: contact.formUrl };
  const subject = renderTemplate(template.subject, variables); const body = renderTemplate(template.body, variables);
  const message = await prisma.emailMessage.create({ data: { userId: job.userId, campaignId: job.campaignId, mailboxId: mailbox.id, contactId: contact.id, templateId: template.id, recipientId: recipient.id, followUpStep: job.followUpStep ?? 0, toAddress: contact.email, fromAddress: mailbox.emailAddress, subject, body, status: "SENDING", scheduledAt: job.runAt }, select: { id: true } });
  const log = await prisma.emailLog.create({ data: { userId: job.userId, messageId: message.id, campaignId: job.campaignId, mailboxId: mailbox.id, contactId: contact.id, followUpStep: job.followUpStep ?? 0, sender: mailbox.emailAddress, recipient: contact.email, subject, status: "SENDING" }, select: { id: true } });
  const markedInFlight = await prisma.scheduledJob.updateMany({ where: { id, status: "PROCESSING", leaseToken }, data: { deliveryState: "IN_FLIGHT", leaseExpiresAt: new Date(Date.now() + leaseMs), messageId: message.id } });
  if (!markedInFlight.count) { await prisma.$transaction([prisma.emailMessage.update({ where: { id: message.id }, data: { status: "FAILED", errorMessage: "Worker claim expired before SMTP submission." } }), prisma.emailLog.update({ where: { id: log.id }, data: { status: "FAILED", message: "Worker claim expired before SMTP submission." } })]); return "lost"; }
  await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: { in: ["PENDING", "SENT"] } }, data: { status: "SENDING" } });
  try { const result = await sendFromMailbox(mailbox, { to: contact.email, subject, body }); const providerMessageId = result.messageId || null; await prisma.$transaction([prisma.emailMessage.update({ where: { id: message.id }, data: { status: "SENT", sentAt: new Date(), providerMessageId, internetMessageId: providerMessageId } }), prisma.emailLog.update({ where: { id: log.id }, data: { status: "SENT", providerMessageId, message: "Sent successfully." } }), prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "SENDING" }, data: { status: "SENT" } })]); const completed = await prisma.scheduledJob.updateMany({ where: { id, status: "PROCESSING", leaseToken }, data: { status: "COMPLETED", deliveryState: "CONFIRMED", processedAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastError: null } }); if (completed.count && job.campaignId) { await scheduleNextFollowUp(job.campaignId, recipient.id, job.followUpStep ?? 0); await updateCampaignProgress(job.campaignId); } return completed.count ? "sent" : "lost"; } catch (error) { return failJob({ ...job, messageId: message.id }, safeErrorMessage(error), isTemporaryEmailFailure(error), maxAttempts); }
}

export async function processDueJobs() { const config = queueConfig(); return (await withWorkerLease("queue", config.leaseMs, async () => { const recovery = await recoverExpiredJobs(); const now = new Date(); const due = await prisma.scheduledJob.findMany({ where: { status: "PENDING", OR: [{ runAt: { lte: now }, nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, orderBy: { runAt: "asc" }, take: config.maxJobs, select: { id: true } }); console.info("queue_worker_start", { discovered: due.length, recovered: recovery }); let processed = 0; let sent = 0; let failed = 0; for (const job of due) { const token = await claimDueJob(job.id, config.leaseMs); if (!token) continue; console.info("queue_job_claimed", { jobId: job.id }); const result = await processJob(job.id, token, config.maxAttempts, config.leaseMs); processed += 1; if (result === "sent") sent += 1; if (result === "failed") failed += 1; if (config.delayMs) await new Promise((resolve) => setTimeout(resolve, config.delayMs)); } console.info("queue_worker_complete", { processed, sent, failed }); return { discovered: due.length, processed, sent, failed, recovered: recovery }; })).value ?? { discovered: 0, processed: 0, sent: 0, failed: 0, skipped: "lease-held" }; }
