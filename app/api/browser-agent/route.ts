import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { browserAgent } from "@/lib/browser/agent";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const agentStatus = await browserAgent.getStatus();

    const [pendingCount, inProgressCount, manualCount, submittedCount, failedCount, jobs] =
      await Promise.all([
        prisma.websiteFormJob.count({ where: { userId, status: "PENDING" } }),
        prisma.websiteFormJob.count({ where: { userId, status: "IN_PROGRESS" } }),
        prisma.websiteFormJob.count({ where: { userId, status: "AWAITING_MANUAL_ACTION" } }),
        prisma.websiteFormJob.count({ where: { userId, status: "SUBMITTED" } }),
        prisma.websiteFormJob.count({ where: { userId, status: "FAILED" } }),
        prisma.websiteFormJob.findMany({
          where: { userId },
          include: {
            campaign: { select: { id: true, name: true, status: true } },
            contact: { select: { id: true, name: true, brandName: true, email: true, website: true, notes: true } },
            formTemplate: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      ]);

    return NextResponse.json({
      agent: agentStatus,
      metrics: {
        total: pendingCount + inProgressCount + manualCount + submittedCount + failedCount,
        pending: pendingCount,
        inProgress: inProgressCount,
        awaitingManual: manualCount,
        submitted: submittedCount,
        failed: failedCount,
      },
      jobs,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get browser agent status." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const body = await request.json();
    const { action, jobId, outcome = "SUBMITTED", targetUrl } = body;

    if (action === "launch") {
      const launched = await browserAgent.ensureBrowserRunning();
      const status = await browserAgent.getStatus();
      return NextResponse.json({ success: launched, status });
    }

    if (action === "process") {
      const processed = await browserAgent.processDueFormJobs();
      return NextResponse.json({ success: true, processedCount: processed });
    }

    if (action === "fill_single_now") {
      if (!jobId) {
        return NextResponse.json({ error: "jobId is required" }, { status: 400 });
      }

      const job = await prisma.websiteFormJob.findFirst({
        where: { id: jobId, userId },
        include: {
          campaign: true,
          contact: true,
          campaignRecipient: true,
        },
      });

      if (!job) {
        return NextResponse.json({ error: "Website form job not found." }, { status: 404 });
      }

      let values: Record<string, any> = {};
      try {
        values = JSON.parse(job.resolvedValuesJson || "{}");
      } catch {
        values = {};
      }

      // Mark IN_PROGRESS
      await prisma.websiteFormJob.update({
        where: { id: job.id },
        data: { status: "IN_PROGRESS", lastAttemptAt: new Date() },
      });

      const outcome = await browserAgent.processFormJob(job.id, job.targetUrl, values, true);

      if (outcome.status === "SUBMITTED") {
        await prisma.websiteFormJob.update({
          where: { id: job.id },
          data: {
            status: "SUBMITTED",
            submittedAt: new Date(),
            browserTabId: null,
            lastError: null,
          },
        });
        if (job.campaignRecipientId) {
          await prisma.campaignRecipient.update({
            where: { id: job.campaignRecipientId },
            data: { formStatus: "SUBMITTED" },
          });
        }
      } else if (outcome.status === "AWAITING_MANUAL_ACTION") {
        await prisma.websiteFormJob.update({
          where: { id: job.id },
          data: {
            status: "AWAITING_MANUAL_ACTION",
            manualActionReason: outcome.reason,
            browserTabId: outcome.tabId || null,
          },
        });
        if (job.campaignRecipientId) {
          await prisma.campaignRecipient.update({
            where: { id: job.campaignRecipientId },
            data: { formStatus: "AWAITING_MANUAL_ACTION" },
          });
        }
      } else if (outcome.status === "FAILED") {
        await prisma.websiteFormJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            lastError: outcome.reason,
            attempts: { increment: 1 },
          },
        });
        if (job.campaignRecipientId) {
          await prisma.campaignRecipient.update({
            where: { id: job.campaignRecipientId },
            data: { formStatus: "FAILED" },
          });
        }
      }

      return NextResponse.json({
        success: outcome.status === "SUBMITTED",
        status: outcome.status,
        reason: outcome.reason || null,
        message:
          outcome.status === "SUBMITTED"
            ? `✓ Form for "${job.contact?.brandName || "Brand"}" submitted successfully in browser!`
            : outcome.status === "AWAITING_MANUAL_ACTION"
            ? `⚠️ Form opened in browser. CAPTCHA or manual verification required in open tab.`
            : `Failed: ${outcome.reason || "Unknown error"}`,
      });
    }

    if (action === "fill_by_scheduled_job") {
      const { scheduledJobId } = body;
      if (!scheduledJobId) {
        return NextResponse.json({ error: "scheduledJobId is required." }, { status: 400 });
      }

      const scheduledJob = await prisma.scheduledJob.findFirst({
        where: { id: scheduledJobId, userId },
        include: {
          campaign: true,
          campaignRecipient: {
            include: {
              contact: true,
              websiteFormJobs: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
        },
      });

      if (!scheduledJob) {
        return NextResponse.json({ error: "Scheduled job not found." }, { status: 404 });
      }

      const recipient = scheduledJob.campaignRecipient;
      const contact = recipient?.contact;
      let targetUrl = (recipient?.formUrl || contact?.formUrl || contact?.website || "").trim();

      if (!targetUrl) {
        return NextResponse.json(
          { error: "No website form URL found for this brand. Please set the Webform Link first." },
          { status: 400 }
        );
      }

      if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
        targetUrl = `https://${targetUrl}`;
      }

      const template =
        (scheduledJob.campaign?.formTemplateId
          ? await prisma.formTemplate.findFirst({ where: { id: scheduledJob.campaign.formTemplateId, userId } })
          : null) ||
        (await prisma.formTemplate.findFirst({ where: { userId, isDefault: true } })) ||
        (await prisma.formTemplate.findFirst({ where: { isDefault: true } }));

      let fieldsObj: Record<string, any> = {};
      try {
        fieldsObj = JSON.parse(template?.fieldsJson || "{}");
      } catch {
        fieldsObj = {};
      }

      const brandName =
        recipient?.snapshotBrand || contact?.brandName || contact?.companyName || contact?.name || "Brand";
      const email = recipient?.snapshotEmail || contact?.email || "";
      const productCategory = recipient?.productCategory || contact?.notes || "General";

      const resolved: Record<string, any> = {};
      for (const [k, v] of Object.entries(fieldsObj)) {
        resolved[k] =
          typeof v === "string"
            ? v
                .replace(/\{\{brandName\}\}/g, brandName)
                .replace(/\{\{contactEmail\}\}/g, email)
                .replace(/\{\{email\}\}/g, email)
                .replace(/\{\{productCategory\}\}/g, productCategory)
            : v;
      }
      if (!resolved.brandName) resolved.brandName = brandName;
      if (!resolved.email) resolved.email = email;

      let formJob = recipient?.websiteFormJobs?.[0];
      if (!formJob) {
        formJob = await prisma.websiteFormJob.create({
          data: {
            userId,
            campaignId: scheduledJob.campaignId || "",
            campaignRecipientId: recipient?.id || "",
            contactId: contact?.id || "",
            formTemplateId: template?.id || null,
            targetUrl,
            resolvedValuesJson: JSON.stringify(resolved),
            status: "IN_PROGRESS",
            runAt: new Date(),
            lastAttemptAt: new Date(),
          },
        });
      } else {
        formJob = await prisma.websiteFormJob.update({
          where: { id: formJob.id },
          data: {
            targetUrl,
            resolvedValuesJson: JSON.stringify(resolved),
            status: "IN_PROGRESS",
            lastAttemptAt: new Date(),
          },
        });
      }

      const outcome = await browserAgent.processFormJob(formJob.id, targetUrl, resolved, true);

      if (outcome.status === "SUBMITTED") {
        await prisma.websiteFormJob.update({
          where: { id: formJob.id },
          data: {
            status: "SUBMITTED",
            submittedAt: new Date(),
            browserTabId: null,
            lastError: null,
          },
        });
        if (recipient?.id) {
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { formStatus: "SUBMITTED", formUrl: targetUrl },
          });
        }
      } else if (outcome.status === "AWAITING_MANUAL_ACTION") {
        await prisma.websiteFormJob.update({
          where: { id: formJob.id },
          data: {
            status: "AWAITING_MANUAL_ACTION",
            manualActionReason: outcome.reason,
            browserTabId: outcome.tabId || null,
          },
        });
        if (recipient?.id) {
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { formStatus: "AWAITING_MANUAL_ACTION", formUrl: targetUrl },
          });
        }
      } else if (outcome.status === "FAILED") {
        await prisma.websiteFormJob.update({
          where: { id: formJob.id },
          data: {
            status: "FAILED",
            lastError: outcome.reason,
            attempts: { increment: 1 },
          },
        });
        if (recipient?.id) {
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { formStatus: "FAILED" },
          });
        }
      }

      return NextResponse.json({
        success: outcome.status === "SUBMITTED",
        status: outcome.status,
        reason: outcome.reason || null,
        targetUrl,
        message:
          outcome.status === "SUBMITTED"
            ? `✓ Form for "${brandName}" submitted successfully in Chrome browser!`
            : outcome.status === "AWAITING_MANUAL_ACTION"
            ? `⚠️ Form opened in browser for "${brandName}". Solve CAPTCHA / verify in tab.`
            : `Form execution status: ${outcome.reason || "Unable to submit"}`,
      });
    }

    if (action === "generate_from_campaign") {
      const { campaignId, formTemplateId } = body;
      if (!campaignId) {
        return NextResponse.json({ error: "campaignId is required." }, { status: 400 });
      }

      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, userId },
        include: {
          recipients: {
            include: { contact: true },
          },
        },
      });

      if (!campaign) {
        return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
      }

      const template =
        (formTemplateId
          ? await prisma.formTemplate.findFirst({ where: { id: formTemplateId, userId } })
          : await prisma.formTemplate.findFirst({ where: { userId, isDefault: true } })) ||
        (await prisma.formTemplate.findFirst({ where: { isDefault: true } }));

      let createdCount = 0;
      const now = new Date();

      for (let i = 0; i < campaign.recipients.length; i++) {
        const r = campaign.recipients[i];
        const contact = r.contact;
        const targetUrl = r.formUrl || contact.formUrl || contact.website;
        if (!targetUrl || r.formExcluded) continue;

        // Skip if job already exists for this recipient
        const existing = await prisma.websiteFormJob.findFirst({
          where: { campaignRecipientId: r.id },
        });
        if (existing) continue;

        let fieldsObj: Record<string, any> = {};
        try {
          fieldsObj = JSON.parse(template?.fieldsJson || "{}");
        } catch {
          fieldsObj = {};
        }

        const brandName = r.snapshotBrand || contact.brandName || contact.name || "Brand";
        const email = r.snapshotEmail || contact.email || "";

        const resolved: Record<string, any> = {};
        for (const [k, v] of Object.entries(fieldsObj)) {
          resolved[k] =
            typeof v === "string"
              ? v
                  .replace(/\{\{brandName\}\}/g, brandName)
                  .replace(/\{\{contactEmail\}\}/g, email)
                  .replace(/\{\{email\}\}/g, email)
                  .replace(/\{\{productCategory\}\}/g, r.productCategory || contact.notes || "General")
              : v;
        }

        await prisma.websiteFormJob.create({
          data: {
            userId,
            campaignId: campaign.id,
            campaignRecipientId: r.id,
            contactId: contact.id,
            formTemplateId: template?.id || null,
            targetUrl,
            resolvedValuesJson: JSON.stringify(resolved),
            status: "PENDING",
            runAt: new Date(now.getTime() + i * 30000), // staggered
          },
        });

        await prisma.campaignRecipient.update({
          where: { id: r.id },
          data: {
            formStatus: "PENDING",
            formUrl: targetUrl,
          },
        });

        createdCount++;
      }

      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          formAutomationEnabled: true,
          formTemplateId: template?.id || null,
        },
      });

      return NextResponse.json({
        success: true,
        createdCount,
        message: `Generated ${createdCount} website form jobs for campaign "${campaign.name}"!`,
      });
    }

    if (action === "resolve_manual") {
      if (!jobId) {
        return NextResponse.json({ error: "jobId is required" }, { status: 400 });
      }

      const job = await prisma.websiteFormJob.findFirst({
        where: { id: jobId, userId },
      });

      if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }

      const newStatus = outcome === "FAILED" ? "FAILED" : "SUBMITTED";
      await prisma.websiteFormJob.update({
        where: { id: job.id },
        data: {
          status: newStatus,
          submittedAt: newStatus === "SUBMITTED" ? new Date() : undefined,
          browserTabId: null,
          lastError: newStatus === "FAILED" ? "Marked failed by user" : null,
        },
      });

      await prisma.campaignRecipient.update({
        where: { id: job.campaignRecipientId },
        data: { formStatus: newStatus },
      });

      return NextResponse.json({ success: true, status: newStatus });
    }

    if (action === "update_url_and_schedule") {
      if (!jobId && !body.campaignRecipientId) {
        return NextResponse.json({ error: "jobId or campaignRecipientId is required" }, { status: 400 });
      }
      if (!targetUrl || typeof targetUrl !== "string") {
        return NextResponse.json({ error: "A valid targetUrl is required" }, { status: 400 });
      }

      if (jobId) {
        await prisma.websiteFormJob.update({
          where: { id: jobId, userId },
          data: {
            targetUrl: targetUrl.trim(),
            status: "PENDING",
            attempts: 0,
            lastError: null,
            manualActionReason: null,
          },
        });
      } else if (body.campaignRecipientId) {
        const recipient = await prisma.campaignRecipient.findUnique({
          where: { id: body.campaignRecipientId },
          include: { campaign: true, contact: true },
        });

        if (!recipient || recipient.campaign.userId !== userId) {
          return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
        }

        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            formUrl: targetUrl.trim(),
            formStatus: "PENDING",
            formMissingInfo: null,
          },
        });

        // Upsert form job
        const defaultTemplate = await prisma.formTemplate.findFirst({
          where: { userId, isDefault: true },
        });
        const values = {
          applicantName: recipient.contact.name || "David Lucas",
          contactEmail: recipient.contact.email,
          brandName: recipient.snapshotBrand || recipient.contact.brandName || "Brand",
          message: "Wholesale inquiry",
        };

        await prisma.websiteFormJob.create({
          data: {
            userId,
            campaignId: recipient.campaignId,
            campaignRecipientId: recipient.id,
            contactId: recipient.contactId,
            formTemplateId: recipient.campaign.formTemplateId || defaultTemplate?.id || null,
            targetUrl: targetUrl.trim(),
            resolvedValuesJson: JSON.stringify(values),
            status: "PENDING",
            runAt: new Date(),
          },
        });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to execute browser agent command." },
      { status: 500 }
    );
  }
}
