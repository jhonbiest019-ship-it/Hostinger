import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { processDueJobs } from "@/lib/queue/worker";
import { localDateTimeToUtc, formatScheduledTime } from "@/lib/schedule";
import { clearWorkerStopFile } from "@/lib/campaign-controls";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;

    let bodyData: any = {};
    try {
      bodyData = await request.json();
    } catch {
      bodyData = {};
    }

    const {
      mode = "sendNow",
      date,
      time,
      timezone = "Asia/Karachi",
      delaySeconds = 60,
      mailboxId,
      followUpEnabled = false,
      followUpDays = 3,
      followUpTemplateId,
      queueWebforms = false,
    } = bodyData;

    const campaign = await prisma.campaign.findFirst({
      where: { id, userId },
      include: {
        mailbox: true,
        template: true,
        recipients: {
          include: { contact: true },
        },
        scheduledJobs: {
          where: { status: "PENDING" },
        },
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    // Clear any emergency stop flag so real-time dispatch proceeds
    clearWorkerStopFile();

    // Determine target start time (baseRunAt)
    let baseRunAt = new Date();
    if (mode === "schedule") {
      if (!date || !time) {
        return NextResponse.json({ error: "Please pick a schedule date and time." }, { status: 400 });
      }
      try {
        baseRunAt = localDateTimeToUtc(date, time, timezone);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Invalid scheduled date or time." },
          { status: 400 }
        );
      }
    } else {
      // mode === "sendNow" - instant real-time spaced send
      baseRunAt = new Date();
    }

    const spacingSeconds = Math.max(0, parseInt(String(delaySeconds), 10) || 0);

    // Update or verify sender mailbox
    let finalMailboxId: string | null = null;
    if (mailboxId) {
      const targetMailbox = await prisma.mailbox.findFirst({
        where: { id: mailboxId, userId, status: "ACTIVE", smtpStatus: "CONNECTED" },
      });
      if (!targetMailbox) {
        return NextResponse.json(
          { error: "Selected sender mailbox not found or unauthorized." },
          { status: 403 }
        );
      }
      finalMailboxId = targetMailbox.id;
    } else if (campaign.mailboxId) {
      const campMailbox = await prisma.mailbox.findFirst({
        where: { id: campaign.mailboxId, userId, status: "ACTIVE", smtpStatus: "CONNECTED" },
      });
      if (campMailbox) finalMailboxId = campMailbox.id;
    }

    if (!finalMailboxId) {
      const activeMailbox = await prisma.mailbox.findFirst({
        where: { userId, status: "ACTIVE", smtpStatus: "CONNECTED" },
        orderBy: { createdAt: "desc" },
      });
      if (activeMailbox) {
        finalMailboxId = activeMailbox.id;
      } else {
        return NextResponse.json(
          { error: "Please connect and verify an active sender mailbox first in Mailboxes." },
          { status: 400 }
        );
      }
    }

    // Configure follow-up rule if followUpEnabled
    if (followUpEnabled && Number(followUpDays) > 0) {
      const daysCount = Math.max(1, parseInt(String(followUpDays), 10) || 3);
      let fuTemplate = null;
      if (followUpTemplateId) {
        fuTemplate = await prisma.template.findFirst({
          where: { id: followUpTemplateId, userId },
        });
      }
      const fuSubject = `Re: ${campaign.template?.subject || campaign.name}`;
      const fuBody =
        `Hi {{brandName}},\n\nJust following up on my previous message. Please let me know if you received it.\n\nBest regards,`;

      if (!fuTemplate) {
        fuTemplate = await prisma.template.create({
          data: {
            userId,
            name: `Follow-up: ${fuSubject.slice(0, 30)}`,
            subject: fuSubject,
            body: fuBody,
            status: "ACTIVE",
          },
        });
      }

      const existingRule = await prisma.followUpRule.findFirst({
        where: { campaignId: id, stepNumber: 1 },
      });

      if (existingRule) {
        await prisma.followUpRule.update({
          where: { id: existingRule.id },
          data: {
            delayAmount: daysCount,
            delayUnit: "DAYS",
            delayMinutes: daysCount * 1440,
            enabled: true,
            templateId: fuTemplate.id,
            subject: fuSubject,
            body: fuBody,
            status: "ACTIVE",
            timezone,
          },
        });
      } else {
        await prisma.followUpRule.create({
          data: {
            userId,
            campaignId: campaign.id,
            stepNumber: 1,
            delayAmount: daysCount,
            delayUnit: "DAYS",
            delayMinutes: daysCount * 1440,
            enabled: true,
            templateId: fuTemplate.id,
            subject: fuSubject,
            body: fuBody,
            status: "ACTIVE",
            timezone,
          },
        });
      }

      await prisma.campaign.update({
        where: { id },
        data: { followUpsEnabled: true },
      });
    }

    const campaignStatus = mode === "sendNow" ? "SENDING" : "SCHEDULED";

    // Only schedule recipients that have a valid email and have not been sent or replied
    const eligibleRecipients = campaign.recipients.filter((r) => {
      const email = (r.snapshotEmail || r.contact?.email || "").trim();
      const isValid = Boolean(
        email &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
        !/^(n\/a|none|undefined|null|-)$/i.test(email) &&
        !email.includes("@placeholder.invalid")
      );
      return isValid && !r.sentAt && !r.repliedAt && r.status !== "REPLIED";
    });

    if (eligibleRecipients.length === 0) {
      return NextResponse.json(
        { error: "No eligible pending recipients with valid email addresses found in this campaign." },
        { status: 400 }
      );
    }

    // Find all existing scheduled jobs for this campaign that are not COMPLETED
    const existingJobs = await prisma.scheduledJob.findMany({
      where: {
        campaignId: id,
        userId,
        status: { in: ["PENDING", "CANCELLED", "FAILED"] },
      },
      orderBy: { createdAt: "asc" },
    });

    // Clean up any stale jobs belonging to skipped recipients with no email
    const eligibleRecipientIds = new Set(eligibleRecipients.map((r) => r.id));
    const staleJobIds = existingJobs
      .filter((j) => !j.campaignRecipientId || !eligibleRecipientIds.has(j.campaignRecipientId))
      .map((j) => j.id);

    if (staleJobIds.length > 0) {
      await prisma.scheduledJob.deleteMany({
        where: { id: { in: staleJobIds } },
      });
    }

    // Map existing jobs by campaignRecipientId to reuse existing job records and avoid duplicates
    const jobsByRecipient = new Map<string, typeof existingJobs>();
    for (const j of existingJobs) {
      if (j.campaignRecipientId && eligibleRecipientIds.has(j.campaignRecipientId)) {
        const arr = jobsByRecipient.get(j.campaignRecipientId) || [];
        arr.push(j);
        jobsByRecipient.set(j.campaignRecipientId, arr);
      }
    }

    let configuredCount = 0;

    for (let i = 0; i < eligibleRecipients.length; i++) {
      const recipient = eligibleRecipients[i];
      const jobRunAt = new Date(baseRunAt.getTime() + i * spacingSeconds * 1000);
      const recipientJobs = jobsByRecipient.get(recipient.id) || [];

      // Reactivate campaign recipient status so worker will dispatch
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "PENDING",
          errorMessage: null,
        },
      });

      if (recipientJobs.length > 0) {
        // Reuse the first job record
        const primaryJob = recipientJobs[0];
        await prisma.scheduledJob.update({
          where: { id: primaryJob.id },
          data: {
            runAt: jobRunAt,
            nextAttemptAt: null,
            status: "PENDING",
            deliveryState: "NOT_STARTED",
            leaseToken: null,
            leaseExpiresAt: null,
            lastError: null,
            timezone,
          },
        });

        // Delete any extra duplicate jobs for this recipient to prevent clutter
        if (recipientJobs.length > 1) {
          const duplicateIds = recipientJobs.slice(1).map((j) => j.id);
          await prisma.scheduledJob.deleteMany({
            where: { id: { in: duplicateIds } },
          });
        }
      } else {
        // Create new scheduled job for this recipient
        await prisma.scheduledJob.create({
          data: {
            userId,
            campaignId: campaign.id,
            campaignRecipientId: recipient.id,
            jobType: "INITIAL_EMAIL",
            runAt: jobRunAt,
            timezone,
            status: "PENDING",
            deliveryState: "NOT_STARTED",
          },
        });
      }

      // Automatically queue website form job if enabled and brand has webform link or website
      if (queueWebforms || campaign.formAutomationEnabled) {
        let formTargetUrl = (recipient.formUrl || recipient.contact?.formUrl || recipient.contact?.website || "").trim();
        if (formTargetUrl && !recipient.formExcluded) {
          if (!formTargetUrl.startsWith("http://") && !formTargetUrl.startsWith("https://")) {
            formTargetUrl = `https://${formTargetUrl}`;
          }

          const existingFormJob = await prisma.websiteFormJob.findFirst({
            where: { campaignRecipientId: recipient.id },
          });

          if (!existingFormJob) {
            const bName = recipient.snapshotBrand || recipient.contact.brandName || recipient.contact.name || "Brand";
            const bEmail = recipient.snapshotEmail || recipient.contact.email || "";
            const bCat = recipient.productCategory || recipient.contact.notes || "General";
            const resolvedValues = { brandName: bName, email: bEmail, productCategory: bCat };

            await prisma.websiteFormJob.create({
              data: {
                userId,
                campaignId: campaign.id,
                campaignRecipientId: recipient.id,
                contactId: recipient.contact.id,
                targetUrl: formTargetUrl,
                resolvedValuesJson: JSON.stringify(resolvedValues),
                status: "PENDING",
                runAt: jobRunAt,
                timezone,
              },
            });

            await prisma.campaignRecipient.update({
              where: { id: recipient.id },
              data: { formStatus: "PENDING", formUrl: formTargetUrl },
            });
          }
        }
      }

      configuredCount++;
    }

    await prisma.campaign.update({
      where: { id },
      data: {
        mailboxId: finalMailboxId,
        status: campaignStatus,
        formAutomationEnabled: Boolean(queueWebforms || campaign.formAutomationEnabled),
        updatedAt: new Date(),
      },
    });

    // Trigger real-time queue worker if jobs are due now or within the next 5 seconds
    const delayUntilStart = Math.max(0, baseRunAt.getTime() - Date.now());
    if (mode === "sendNow" || delayUntilStart <= 5000) {
      void processDueJobs().catch((err) => console.error("Worker trigger failed:", err));
    } else if (delayUntilStart <= 60000) {
      setTimeout(() => {
        void processDueJobs().catch((err) => console.error("Delayed worker trigger failed:", err));
      }, delayUntilStart);
    }

    const formattedTime = formatScheduledTime(baseRunAt, timezone);

    return NextResponse.json({
      success: true,
      count: configuredCount,
      mode,
      startTime: baseRunAt.toISOString(),
      formattedStartTime: formattedTime,
      message:
        mode === "sendNow"
          ? `🚀 Campaign "${campaign.name}" dispatched! ${configuredCount} emails sending in real time with ${spacingSeconds}s gap.`
          : `🕒 Campaign "${campaign.name}" scheduled successfully for ${formattedTime} with ${spacingSeconds}s interval!`,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Campaign forward error:", error);
    return NextResponse.json({ error: "Failed to forward/schedule campaign." }, { status: 500 });
  }
}
