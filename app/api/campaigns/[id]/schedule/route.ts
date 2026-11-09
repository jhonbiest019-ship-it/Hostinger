import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { scheduleSchema, localDateTimeToUtc } from "@/lib/schedule";
import { DEFAULT_TIMEZONE } from "@/lib/preferences";
import { processDueJobs } from "@/lib/queue/worker";
import { clearWorkerStopFile } from "@/lib/campaign-controls";

class SchedulingError extends Error {}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;
    const parsed = scheduleSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose Send now or provide a date, time and timezone." }, { status: 400 });
    }

    const preference = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
    clearWorkerStopFile();
    let runAt = new Date(Date.now() + 1000);
    let timezone = preference?.timezone ?? DEFAULT_TIMEZONE;

    if (parsed.data.mode === "schedule") {
      timezone = parsed.data.timezone;
      try {
        runAt = localDateTimeToUtc(parsed.data.date, parsed.data.time, timezone);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Invalid scheduled time." },
          { status: 400 }
        );
      }
      if (runAt.getTime() <= Date.now()) {
        return NextResponse.json({ error: "Scheduled time must be in the future." }, { status: 400 });
      }
    }

    const queued = await prisma.$transaction(async (tx) => {
      const locked = await tx.campaign.updateMany({
        where: { id, userId, status: { in: ["READY", "DRAFT"] } },
        data: { status: parsed.data.mode === "sendNow" ? "SENDING" : "SCHEDULED" },
      });
      if (!locked.count) {
        throw new SchedulingError(
          "Campaign is not ready or already running. Already queued campaigns cannot be queued again."
        );
      }

      const campaign = await tx.campaign.findUniqueOrThrow({
        where: { id },
        include: {
          mailbox: true,
          template: true,
          recipients: { include: { contact: true } },
          followUpRules: { include: { template: true } },
        },
      });

      if (await tx.scheduledJob.count({ where: { campaignId: id } })) {
        throw new SchedulingError("This campaign already has active jobs. Duplicate it for a new send.");
      }

      // Link mailbox if provided or fallback to active mailbox
      let mailbox = campaign.mailbox;
      const targetMailboxId = parsed.data.mailboxId || campaign.mailboxId;
      if (targetMailboxId && (!mailbox || mailbox.id !== targetMailboxId)) {
        mailbox = await tx.mailbox.findFirst({ where: { id: targetMailboxId, userId } });
        if (mailbox) {
          await tx.campaign.update({ where: { id }, data: { mailboxId: mailbox.id } });
        }
      }
      if (!mailbox) {
        mailbox = await tx.mailbox.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
        if (mailbox) {
          await tx.campaign.update({ where: { id }, data: { mailboxId: mailbox.id } });
        }
      }
      if (
        !mailbox ||
        mailbox.userId !== userId ||
        mailbox.status !== "ACTIVE" ||
        mailbox.smtpStatus !== "CONNECTED"
      ) {
        throw new SchedulingError("Verify the selected Hostinger sender mailbox before scheduling.");
      }

      // Link template if provided or fallback to active template
      let template = campaign.template;
      const targetTemplateId = parsed.data.templateId || campaign.templateId;
      if (targetTemplateId && (!template || template.id !== targetTemplateId)) {
        template = await tx.template.findFirst({ where: { id: targetTemplateId, userId } });
        if (template) {
          await tx.campaign.update({ where: { id }, data: { templateId: template.id } });
        }
      }
      if (!template) {
        template = await tx.template.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
        if (template) {
          await tx.campaign.update({ where: { id }, data: { templateId: template.id } });
        }
      }
      if (!template || template.userId !== userId || template.status !== "ACTIVE") {
        throw new SchedulingError("Select an active template.");
      }

      if (campaign.followUpsEnabled) {
        const rules = campaign.followUpRules.filter((rule) => rule.enabled);
        if (!rules.length) throw new SchedulingError("Add an enabled follow-up step or disable follow-ups.");
        if (mailbox.imapStatus !== "CONNECTED") {
          throw new SchedulingError("Verify IMAP so replies can stop follow-ups.");
        }
        if (rules.some((rule) => !rule.template || rule.template.userId !== userId || rule.template.status !== "ACTIVE")) {
          throw new SchedulingError("Select an active template for every follow-up.");
        }
      }

      const recipients = campaign.recipients.filter(
        (item) =>
          item.contact.userId === userId &&
          !["DO_NOT_CONTACT", "INVALID", "ARCHIVED"].includes(item.contact.status) &&
          item.status === "PENDING" &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.contact.email)
      );

      if (!recipients.length) {
        throw new SchedulingError("No valid pending recipients are available in this campaign.");
      }

      const delaySec = Math.max(0, parseInt(String(parsed.data.delaySeconds ?? (parsed.data.mode === "sendNow" ? 2 : 60)), 10));

      await tx.scheduledJob.createMany({
        data: recipients.map((item, idx) => ({
          userId,
          campaignId: id,
          campaignRecipientId: item.id,
          jobType: "INITIAL_EMAIL" as const,
          followUpStep: 0,
          runAt: new Date(runAt.getTime() + idx * delaySec * 1000),
          timezone,
        })),
      });

      await tx.campaignRecipient.updateMany({
        where: { campaignId: id, id: { notIn: recipients.map((item) => item.id) }, status: "PENDING" },
        data: { status: "SKIPPED" },
      });

      return { count: recipients.length, delaySec, mailboxEmail: mailbox.emailAddress };
    });

    if (parsed.data.mode === "sendNow") {
      void processDueJobs().catch((err) => console.error("Worker trigger failed:", err));
    }

    return NextResponse.json({
      success: true,
      queued: queued.count,
      delaySeconds: queued.delaySec,
      mailbox: queued.mailboxEmail,
      mode: parsed.data.mode,
      runAt: runAt.toISOString(),
      timezone,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof SchedulingError ? error.message : "Unable to queue campaign. Refresh and try again.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
