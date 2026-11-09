import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { processDueJobs } from "@/lib/queue/worker";
import { parseScheduledTimeToUtc } from "@/lib/schedule";
import { clearWorkerStopFile } from "@/lib/campaign-controls";
import { discoverBrandFormUrl } from "@/lib/forms/discovery";
import { resolveFormTemplateValues } from "@/lib/forms/resolver";
import { browserAgent } from "@/lib/browser/agent";

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const data = await request.json();

    const {
      campaignName,
      mailboxId,
      templateId,
      subject,
      body,
      sendMode,
      scheduleTime,
      delaySeconds = 60, // default 60 seconds (1 minute) spacing between emails
      timezone = "Asia/Karachi",
      rows,
      sheetUrl,
      sheetTab,
      sheetWebhookUrl,
      followUpEnabled = false,
      followUpDays = 3,
      followUpSubject,
      followUpBody,
      followUpTemplateId,
      saveOnly = false,
      startRow,
      endRow,
      totalSelectedRows,
      formAutomationEnabled = false,
      formTemplateId = null,
      formScheduleMode = "SAME_TIME",
      formScheduledAt = null,
      formConcurrency = 2,
      formOverrides = null,
    } = data;

    // Find active default template first
    const activeDefaultTemplate = await prisma.template.findFirst({
      where: { userId, status: "ACTIVE", isDefault: true },
    });

    const effectiveSubject = subject?.trim() || activeDefaultTemplate?.subject || "Partnership Outreach";
    const effectiveBody = body?.trim() || activeDefaultTemplate?.body || "";

    let mailbox = null;
    if (mailboxId) {
      mailbox = await prisma.mailbox.findFirst({
        where: { id: mailboxId, userId },
      });
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

    if (!saveOnly && !mailbox) {
      return NextResponse.json({ error: "Please select a verified sender mailbox." }, { status: 400 });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No email recipients selected in the chosen range." }, { status: 400 });
    }

    // Determine Campaign Name (Use provided name or auto-generate from today's date)
    const now = new Date();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const baseDateName = `Campaign - ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
    let finalCampaignName = campaignName?.trim();
    if (!finalCampaignName) {
      const existingCount = await prisma.campaign.count({
        where: { userId, name: { startsWith: baseDateName } },
      });
      finalCampaignName = existingCount > 0 ? `${baseDateName} (#${existingCount + 1})` : baseDateName;
    }

    // Prepare Template
    let effectiveTemplateId = templateId;
    if (!effectiveTemplateId) {
      const activeTemplate = await prisma.template.findFirst({
        where: { userId, status: "ACTIVE", isDefault: true },
        select: { id: true },
      });
      if (activeTemplate) {
        effectiveTemplateId = activeTemplate.id;
      } else {
        const newTemplate = await prisma.template.create({
          data: {
            userId,
            name: `${finalCampaignName} Template`,
            subject: effectiveSubject,
            body: effectiveBody,
            status: "ACTIVE",
            isDefault: true,
          },
        });
        effectiveTemplateId = newTemplate.id;
      }
    }

    // Determine start time
    clearWorkerStopFile();
    const baseRunAt = sendMode === "schedule" && scheduleTime
      ? parseScheduledTimeToUtc(scheduleTime, timezone)
      : new Date();
    const spacingSeconds = Math.max(0, parseInt(String(delaySeconds), 10) || 0);

    // Resolve Form Template if enabled
    let effectiveFormTemplate = null;
    if (formAutomationEnabled) {
      if (formTemplateId) {
        effectiveFormTemplate = await prisma.formTemplate.findFirst({
          where: { id: formTemplateId, userId },
        });
      }
      if (!effectiveFormTemplate) {
        effectiveFormTemplate = await prisma.formTemplate.findFirst({
          where: { userId, isDefault: true },
        });
      }
      if (!effectiveFormTemplate) {
        effectiveFormTemplate = await prisma.formTemplate.findFirst({
          where: { userId },
          orderBy: { createdAt: "desc" },
        });
      }
    }

    const selectedStartRow = typeof startRow === "number" ? startRow : parseInt(String(startRow), 10) || 1;
    const selectedEndRow = typeof endRow === "number" ? endRow : parseInt(String(endRow), 10) || (selectedStartRow + rows.length - 1);
    const totalSelected = rows.length;

    // Create Campaign
    const campaign = await prisma.campaign.create({
      data: {
        userId,
        mailboxId: mailbox?.id || null,
        templateId: effectiveTemplateId,
        name: finalCampaignName,
        description: `Selected Rows: ${selectedStartRow}–${selectedEndRow} (${totalSelected} rows)${spacingSeconds > 0 ? ` with ${spacingSeconds}s interval` : ""}`,
        sheetUrl: sheetUrl ? String(sheetUrl).trim() : null,
        sheetTab: sheetTab ? String(sheetTab).trim() : `Rows ${selectedStartRow}-${selectedEndRow}`,
        sheetWebhookUrl: sheetWebhookUrl ? String(sheetWebhookUrl).trim() : null,
        status: saveOnly ? "DRAFT" : "SCHEDULED",
        followUpsEnabled: Boolean(followUpEnabled),
        formAutomationEnabled: Boolean(formAutomationEnabled),
        formTemplateId: formAutomationEnabled && effectiveFormTemplate ? effectiveFormTemplate.id : null,
        formScheduleMode: formScheduleMode === "DIFFERENT_TIME" ? "DIFFERENT_TIME" : "SAME_TIME",
        formScheduledAt: formAutomationEnabled && formScheduleMode === "DIFFERENT_TIME" && formScheduledAt
          ? parseScheduledTimeToUtc(formScheduledAt, timezone)
          : null,
        formConcurrency: Math.max(1, parseInt(String(formConcurrency), 10) || 2),
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
        `Hi {{brandName}},\n\nJust following up on my previous email. Let me know if you have any questions.\n\nBest regards,`;

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

    let createdCount = 0;
    let validEmailCount = 0;
    let skippedNoEmailCount = 0;
    let formJobsCreatedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rawEmail = String(row.brandEmail || "").trim().toLowerCase();
      const isValidEmail = Boolean(
        rawEmail &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) &&
        !/^(n\/a|none|undefined|null|-)$/i.test(rawEmail)
      );

      const brandName = String(row.brandName || "").trim() || (isValidEmail ? rawEmail.split("@")[0] : `Lead #${i + 1}`);
      const productCategory = String(row.productCategory || row.category || "").trim();
      const asin = String(row.asin || "").trim() || null;
      const amazonLink = String(row.amazonLink || "").trim();
      const website = String(row.website || amazonLink || "").trim() || null;
      const rowIndex = row.sheetNum || row.rowIndex || (selectedStartRow + i);

      let recipient = null;
      let contact = null;

      if (isValidEmail) {
        // Upsert valid contact
        contact = await prisma.contact.upsert({
          where: {
            userId_email: { userId, email: rawEmail },
          },
          update: {
            brandName: brandName || undefined,
            notes: productCategory || undefined,
            website: website || undefined,
            formUrl: asin || undefined,
          },
          create: {
            userId,
            email: rawEmail,
            name: brandName,
            fullName: brandName,
            brandName,
            notes: productCategory,
            website,
            formUrl: asin,
            status: "ACTIVE",
          },
        });

        // Check for duplicate recipient in this campaign
        const existingRecipient = await prisma.campaignRecipient.findUnique({
          where: {
            campaignId_contactId: { campaignId: campaign.id, contactId: contact.id },
          },
        });
        if (existingRecipient) continue;

        // Create Campaign Recipient (Pending)
        recipient = await prisma.campaignRecipient.create({
          data: {
            campaignId: campaign.id,
            contactId: contact.id,
            status: "PENDING",
            snapshotName: brandName,
            snapshotBrand: brandName,
            snapshotEmail: rawEmail,
            productCategory: productCategory || "General",
            sheetRowIndex: typeof rowIndex === "number" ? rowIndex : parseInt(String(rowIndex), 10) || (selectedStartRow + i),
            sheetSyncStatus: "PENDING",
          },
        });

        if (!saveOnly) {
          // Stagger runAt for each email in real-time according to spacingSeconds
          const jobRunAt = new Date(baseRunAt.getTime() + validEmailCount * spacingSeconds * 1000);

          // Create ScheduledJob
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

        validEmailCount++;
        createdCount++;
      } else {
        // Incomplete lead without valid email: PRESERVE EXACT ROW IN CAMPAIGN AS SKIPPED
        const placeholderEmail = `missing-email-r${rowIndex}-${campaign.id.slice(0, 8)}@placeholder.invalid`;
        contact = await prisma.contact.upsert({
          where: {
            userId_email: { userId, email: placeholderEmail },
          },
          update: {
            brandName: brandName || undefined,
            notes: productCategory || undefined,
            website: website || undefined,
            formUrl: asin || undefined,
            status: "INVALID",
          },
          create: {
            userId,
            email: placeholderEmail,
            name: brandName,
            fullName: brandName,
            brandName,
            notes: productCategory,
            website,
            formUrl: asin,
            status: "INVALID",
          },
        });

        const existingRecipient = await prisma.campaignRecipient.findUnique({
          where: {
            campaignId_contactId: { campaignId: campaign.id, contactId: contact.id },
          },
        });
        if (existingRecipient) continue;

        recipient = await prisma.campaignRecipient.create({
          data: {
            campaignId: campaign.id,
            contactId: contact.id,
            status: "SKIPPED",
            snapshotName: brandName,
            snapshotBrand: brandName,
            snapshotEmail: "", // Explicitly empty for missing email display
            productCategory: productCategory || "General",
            sheetRowIndex: typeof rowIndex === "number" ? rowIndex : parseInt(String(rowIndex), 10) || (selectedStartRow + i),
            sheetSyncStatus: "SKIPPED",
            errorMessage: "Missing Email Address (Skipped from dispatch)",
          },
        });

        skippedNoEmailCount++;
        createdCount++;
      }

      // Website Form Automation for this recipient
      if (formAutomationEnabled && recipient && contact) {
        const rowOverride = (formOverrides && (
          formOverrides[rawEmail] ||
          formOverrides[brandName] ||
          formOverrides[String(rowIndex)] ||
          formOverrides[String(i)]
        )) || {};

        const formUrlToUse = rowOverride.targetUrl || rowOverride.formUrl || asin || row.formUrl || row.websiteFormUrl;
        const isExcluded = Boolean(rowOverride.excluded);

        const disc = discoverBrandFormUrl(website, formUrlToUse, brandName);
        const formStatus = isExcluded ? null : (disc.isAvailable ? "PENDING" : "NOT_AVAILABLE");
        const formMissingInfo = !disc.isAvailable ? (disc.missingInfo || "Missing brand website URL.") : null;
        const targetUrl = disc.targetFormUrl || null;

        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            formStatus,
            formUrl: targetUrl,
            formExcluded: isExcluded,
            formMissingInfo,
          },
        });

        if (!saveOnly && !isExcluded && disc.isAvailable && targetUrl) {
          const resolvedValues = rowOverride.resolvedValues || resolveFormTemplateValues(
            effectiveFormTemplate?.fieldsJson || "{}",
            {
              brandName,
              email: isValidEmail ? rawEmail : "",
              productCategory,
              senderEmail: mailbox?.emailAddress || "",
              senderName: mailbox?.displayName || "David Lucas",
              notes: productCategory,
              website: website || "",
              ...row,
            }
          );

          const formRunAt = (formScheduleMode === "DIFFERENT_TIME" && formScheduledAt)
            ? parseScheduledTimeToUtc(formScheduledAt, timezone)
            : baseRunAt;

          await prisma.websiteFormJob.create({
            data: {
              userId,
              campaignId: campaign.id,
              campaignRecipientId: recipient.id,
              contactId: contact.id,
              formTemplateId: effectiveFormTemplate?.id || null,
              targetUrl,
              resolvedValuesJson: JSON.stringify(resolvedValues),
              status: "PENDING",
              runAt: formRunAt,
              timezone,
            },
          });
          formJobsCreatedCount++;
        }
      }
    }

    // If sendNow and not saveOnly, trigger background worker and browser agent immediately
    if (!saveOnly && sendMode === "sendNow") {
      void processDueJobs().catch((err) => console.error("Worker trigger failed:", err));
      if (formAutomationEnabled) {
        void browserAgent.processDueFormJobs().catch((err) => console.error("Browser agent auto-dispatch failed:", err));
      }
    }

    const endTime = new Date(baseRunAt.getTime() + Math.max(0, validEmailCount - 1) * spacingSeconds * 1000);

    return NextResponse.json({
      success: true,
      campaignId: campaign.id,
      campaignName: finalCampaignName,
      count: validEmailCount,
      totalCount: createdCount,
      skippedCount: skippedNoEmailCount,
      startRow: selectedStartRow,
      endRow: selectedEndRow,
      saveOnly: Boolean(saveOnly),
      startTime: baseRunAt.toISOString(),
      endTime: endTime.toISOString(),
      delaySeconds: spacingSeconds,
      sendMode,
      formAutomationEnabled: Boolean(formAutomationEnabled),
      formJobsCount: formJobsCreatedCount,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Sheet send error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to process campaign sheet." },
      { status: 500 }
    );
  }
}
