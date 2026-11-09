import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { processDueJobs } from "@/lib/queue/worker";
import { parseScheduledTimeToUtc } from "@/lib/schedule";
import { clearWorkerStopFile } from "@/lib/campaign-controls";

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const data = await request.json();

    const {
      recipientEmail,
      scheduleTime,
      delaySeconds = 60,
      timezone = "Asia/Karachi",
      subject,
      body,
      mailboxId: requestedMailboxId,
      campaignName,
      templateId,
      followUpEnabled = false,
      followUpDays = 3,
      followUpSubject,
      followUpBody,
      followUpTemplateId,
    } = data;

    const rawInput = String(recipientEmail || "").trim();
    if (!rawInput) {
      return NextResponse.json({ error: "Please enter at least one recipient email address." }, { status: 400 });
    }

    // Split multiple emails by comma, semicolon, space, or newline
    const emailList = rawInput
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    if (emailList.length === 0) {
      return NextResponse.json({ error: "No valid recipient email address found." }, { status: 400 });
    }

    if (!scheduleTime) {
      return NextResponse.json({ error: "Please pick a schedule date and time." }, { status: 400 });
    }

    if (!subject?.trim() || !body?.trim()) {
      return NextResponse.json({ error: "Subject and email body are required." }, { status: 400 });
    }

    // Get verified mailbox
    let mailbox = null;
    if (requestedMailboxId) {
      mailbox = await prisma.mailbox.findFirst({ where: { id: requestedMailboxId, userId } });
    }
    if (!mailbox) {
      mailbox = await prisma.mailbox.findFirst({
        where: { userId, status: "ACTIVE", smtpStatus: "CONNECTED" },
        orderBy: { createdAt: "desc" },
      });
    }
    if (!mailbox) {
      mailbox = await prisma.mailbox.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
    }
    if (!mailbox) {
      return NextResponse.json(
        { error: "No mailbox found. Please configure a mailbox in the Mailboxes tab first." },
        { status: 400 }
      );
    }

    // Use or create template
    let effectiveTemplate = null;
    if (templateId) {
      effectiveTemplate = await prisma.template.findFirst({
        where: { id: templateId, userId },
      });
    }
    if (!effectiveTemplate) {
      effectiveTemplate = await prisma.template.findFirst({
        where: { userId, status: "ACTIVE", isDefault: true },
      });
    }
    if (!effectiveTemplate) {
      effectiveTemplate = await prisma.template.create({
        data: {
          userId,
          name: `Scheduled: ${subject.slice(0, 30)}`,
          subject,
          body,
          status: "ACTIVE",
          isDefault: true,
        },
      });
    }

    // Create a dedicated campaign container with the user's campaign name
    const effectiveCampaignName =
      campaignName?.trim() ||
      `Scheduled - ${subject.slice(0, 25)} (${new Date(scheduleTime).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })})`;

    const campaign = await prisma.campaign.create({
      data: {
        userId,
        mailboxId: mailbox.id,
        templateId: effectiveTemplate.id,
        name: effectiveCampaignName,
        description: `Direct scheduled to ${emailList.length} recipient(s) with ${delaySeconds}s delay`,
        status: "SCHEDULED",
        followUpsEnabled: Boolean(followUpEnabled),
      },
    });

    // Create Follow-up Rule if enabled
    if (followUpEnabled && Number(followUpDays) > 0) {
      const daysCount = Math.max(1, parseInt(String(followUpDays), 10) || 3);
      let followUpTemplate = null;
      if (followUpTemplateId) {
        followUpTemplate = await prisma.template.findFirst({
          where: { id: followUpTemplateId, userId },
        });
      }
      const fuSubject = followUpSubject?.trim() || `Re: ${subject}`;
      const fuBody =
        followUpBody?.trim() ||
        `Hi {{brandName}},\n\nJust following up on my previous message. Let me know if you have any questions.\n\nBest regards,`;

      if (!followUpTemplate) {
        followUpTemplate = await prisma.template.create({
          data: {
            userId,
            name: `Follow-up: ${fuSubject.slice(0, 30)}`,
            subject: fuSubject,
            body: fuBody,
            status: "ACTIVE",
          },
        });
      }

      await prisma.followUpRule.create({
        data: {
          userId,
          campaignId: campaign.id,
          stepNumber: 1,
          delayAmount: daysCount,
          delayUnit: "DAYS",
          delayMinutes: daysCount * 1440,
          enabled: true,
          templateId: followUpTemplate.id,
          subject: fuSubject,
          body: fuBody,
          status: "ACTIVE",
          timezone,
        },
      });
    }

    clearWorkerStopFile();
    const baseRunAt = parseScheduledTimeToUtc(scheduleTime, timezone);
    const spacing = Math.max(0, parseInt(String(delaySeconds), 10) || 0);

    const createdJobIds: string[] = [];

    for (let i = 0; i < emailList.length; i++) {
      const email = emailList[i];

      // Upsert contact
      const contact = await prisma.contact.upsert({
        where: { userId_email: { userId, email } },
        update: {},
        create: {
          userId,
          email,
          name: email.split("@")[0],
          status: "ACTIVE",
        },
      });

      // Create campaign recipient
      const recipient = await prisma.campaignRecipient.create({
        data: {
          campaignId: campaign.id,
          contactId: contact.id,
          status: "PENDING",
          snapshotEmail: email,
          snapshotName: contact.name,
        },
      });

      // Calculate staggered runAt
      const runAt = new Date(baseRunAt.getTime() + i * spacing * 1000);

      // Create scheduled job
      const job = await prisma.scheduledJob.create({
        data: {
          userId,
          campaignId: campaign.id,
          campaignRecipientId: recipient.id,
          runAt,
          timezone,
          status: "PENDING",
          deliveryState: "NOT_STARTED",
          jobType: "INITIAL_EMAIL",
        },
      });

      createdJobIds.push(job.id);
    }

    // Trigger real-time queue worker immediately if jobs are due now or within the next minute
    const delayUntilRun = Math.max(0, baseRunAt.getTime() - Date.now());
    if (delayUntilRun <= 5000) {
      void processDueJobs().catch((err) => console.error("Direct schedule immediate worker trigger failed:", err));
    } else if (delayUntilRun <= 60000) {
      setTimeout(() => {
        void processDueJobs().catch((err) => console.error("Direct schedule delayed worker trigger failed:", err));
      }, delayUntilRun);
    }

    return NextResponse.json({
      success: true,
      count: emailList.length,
      startTime: baseRunAt.toISOString(),
      delaySeconds: spacing,
      jobIds: createdJobIds,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Direct schedule error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to schedule email." },
      { status: 500 }
    );
  }
}
