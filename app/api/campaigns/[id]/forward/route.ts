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

    const campaign = (await prisma.campaign.findFirst({
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
    })) || (await prisma.campaign.findFirst({
      where: { id },
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
    }));

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
      const targetMailbox = (await prisma.mailbox.findFirst({ where: { id: mailboxId, userId } }))
        || (await prisma.mailbox.findFirst({ where: { id: mailboxId } }));
      if (targetMailbox) {
        finalMailboxId = targetMailbox.id;
      }
    }
    
    if (!finalMailboxId && campaign.mailboxId) {
      const campMailbox = (await prisma.mailbox.findFirst({ where: { id: campaign.mailboxId, userId } }))
        || (await prisma.mailbox.findFirst({ where: { id: campaign.mailboxId } }));
      if (campMailbox) finalMailboxId = campMailbox.id;
    }

    if (!finalMailboxId) {
      const activeMailbox = (await prisma.mailbox.findFirst({ where: { userId, status: "ACTIVE", smtpStatus: "CONNECTED" }, orderBy: { createdAt: "desc" } }))
        || (await prisma.mailbox.findFirst({ where: { status: "ACTIVE", smtpStatus: "CONNECTED" }, orderBy: { createdAt: "desc" } }))
        || (await prisma.mailbox.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" } }))
        || (await prisma.mailbox.findFirst({ orderBy: { createdAt: "desc" } }));
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

    const isInstantStart = mode === "sendNow" || (baseRunAt.getTime() <= Date.now() + 60_000);
    const campaignStatus = isInstantStart ? "SENDING" : "SCHEDULED";

    // Target all pending campaign recipients so every row appears 1-by-1 in the scheduled queue
    const targetRecipients = campaign.recipients.filter(
      (r) => !r.sentAt && !r.repliedAt && r.status !== "REPLIED"
    );

    if (targetRecipients.length === 0) {
      await prisma.campaign.update({
        where: { id },
        data: {
          mailboxId: finalMailboxId,
          status: "COMPLETED",
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        count: 0,
        mode,
        status: "COMPLETED",
        message: `All recipients in campaign "${campaign.name}" have already been sent!`,
      });
    }

    // Find all existing scheduled jobs for this campaign that are not COMPLETED
    const existingJobs = await prisma.scheduledJob.findMany({
      where: {
        campaignId: id,
        status: { in: ["PENDING", "CANCELLED", "FAILED"] },
      },
      orderBy: { createdAt: "asc" },
    });

    const targetRecipientIds = new Set(targetRecipients.map((r) => r.id));
    const staleJobIds = existingJobs
      .filter((j) => !j.campaignRecipientId || !targetRecipientIds.has(j.campaignRecipientId))
      .map((j) => j.id);

    if (staleJobIds.length > 0) {
      await prisma.scheduledJob.deleteMany({
        where: { id: { in: staleJobIds } },
      });
    }

    // Map existing jobs by campaignRecipientId to reuse existing job records and avoid duplicates
    const jobsByRecipient = new Map<string, typeof existingJobs>();
    for (const j of existingJobs) {
      if (j.campaignRecipientId && targetRecipientIds.has(j.campaignRecipientId)) {
        const arr = jobsByRecipient.get(j.campaignRecipientId) || [];
        arr.push(j);
        jobsByRecipient.set(j.campaignRecipientId, arr);
      }
    }

    let configuredCount = 0;
    let validEmailCount = 0;

    for (let i = 0; i < targetRecipients.length; i++) {
      const recipient = targetRecipients[i];
      const email = (recipient.snapshotEmail || recipient.contact?.email || "").trim();
      const hasValidEmail = Boolean(
        email &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
        !/^(n\/a|none|undefined|null|-)$/i.test(email) &&
        !email.includes("@placeholder.invalid")
      );

      let jobRunAt: Date;
      if (isInstantStart) {
        if (i === 0) {
          // Recipient 0 is due IMMEDIATELY in real-time
          jobRunAt = new Date(Date.now() - 2000);
        } else {
          jobRunAt = new Date(Date.now() + i * spacingSeconds * 1000);
        }
      } else {
        jobRunAt = new Date(baseRunAt.getTime() + i * spacingSeconds * 1000);
      }
      const recipientJobs = jobsByRecipient.get(recipient.id) || [];

      // Reactivate campaign recipient status
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "PENDING",
          errorMessage: hasValidEmail ? null : "Missing Email Address in Sheet (Enter email to dispatch)",
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
            lastError: hasValidEmail ? null : "Missing Email Address in Sheet (Enter email to dispatch)",
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
            userId: campaign.userId || userId,
            campaignId: campaign.id,
            campaignRecipientId: recipient.id,
            jobType: "INITIAL_EMAIL",
            runAt: jobRunAt,
            timezone,
            status: "PENDING",
            deliveryState: "NOT_STARTED",
            lastError: hasValidEmail ? null : "Missing Email Address in Sheet (Enter email to dispatch)",
          },
        });
      }

      if (hasValidEmail) {
        validEmailCount++;
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

    // Trigger real-time queue worker immediately so the first email is dispatched right away
    let workerResult: any = null;
    if (isInstantStart) {
      try {
        workerResult = await processDueJobs();
      } catch (err) {
        console.error("Worker immediate execution failed:", err);
      }
    } else {
      const delayUntilStart = Math.max(0, baseRunAt.getTime() - Date.now());
      if (delayUntilStart <= 5000) {
        try {
          workerResult = await processDueJobs();
        } catch (err) {
          console.error("Delayed worker trigger failed:", err);
        }
      }
    }

    const formattedTime = formatScheduledTime(baseRunAt, timezone);

    return NextResponse.json({
      success: true,
      count: configuredCount,
      mode,
      status: campaignStatus,
      firstEmailDispatched: Boolean(workerResult && workerResult.sent > 0),
      workerResult,
      startTime: baseRunAt.toISOString(),
      formattedStartTime: formattedTime,
      message: isInstantStart
        ? `🚀 Campaign "${campaign.name}" is now Active in Real Time! First email dispatched immediately via Hostinger SMTP.`
        : `🕒 Campaign "${campaign.name}" scheduled successfully for ${formattedTime} with ${spacingSeconds}s interval!`,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Campaign forward error:", error);
    return NextResponse.json({ error: "Failed to forward/schedule campaign." }, { status: 500 });
  }
}
