import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { controlCampaign, lockEditableCampaign } from "@/lib/campaign-controls";
import { autoFormatGreetingWithBrand } from "@/lib/email/template";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().max(10_000).optional().nullable(),
  mailboxId: z.string().min(1).optional().nullable(),
  templateId: z.string().min(1).optional().nullable(),
  subject: z.string().trim().min(1).max(998).optional(),
  body: z.string().trim().min(1).max(100_000).optional(),
  delaySeconds: z.number().int().min(0).max(86400).optional(),
  sheetUrl: z.string().trim().optional().nullable(),
  sheetWebhookUrl: z.string().trim().optional().nullable(),
  action: z.enum(["pause", "resume", "cancel"]).optional(),
});

const include = {
  mailbox: { select: { id: true, emailAddress: true, displayName: true, status: true, smtpStatus: true } },
  template: { select: { id: true, name: true, subject: true, body: true } },
  recipients: {
    include: {
      contact: {
        select: {
          id: true,
          userId: true,
          name: true,
          fullName: true,
          brandName: true,
          companyName: true,
          email: true,
          status: true,
          notes: true,
          website: true,
          formUrl: true,
        },
      },
      messages: {
        select: {
          id: true,
          status: true,
          sentAt: true,
          scheduledAt: true,
          errorMessage: true,
          direction: true,
        },
        orderBy: { createdAt: "desc" as const },
        take: 1,
      },
      scheduledJobs: {
        select: {
          id: true,
          status: true,
          runAt: true,
          processedAt: true,
          lastError: true,
        },
        orderBy: { createdAt: "desc" as const },
        take: 1,
      },
      websiteFormJobs: {
        select: {
          id: true,
          status: true,
          targetUrl: true,
          resolvedValuesJson: true,
          runAt: true,
          attempts: true,
          lastError: true,
          manualActionReason: true,
          browserTabId: true,
          submittedAt: true,
          lastAttemptAt: true,
        },
        orderBy: { createdAt: "desc" as const },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  formTemplate: { select: { id: true, name: true, description: true } },
  websiteFormJobs: {
    select: {
      id: true,
      campaignRecipientId: true,
      status: true,
      targetUrl: true,
      runAt: true,
      manualActionReason: true,
      browserTabId: true,
      submittedAt: true,
      lastError: true,
    },
    orderBy: { createdAt: "desc" as const },
  },
  followUpRules: {
    where: { enabled: true },
    orderBy: { stepNumber: "asc" as const },
    select: {
      stepNumber: true,
      delayAmount: true,
      delayUnit: true,
      template: { select: { name: true } },
    },
  },
  scheduledJobs: {
    where: { jobType: "FOLLOW_UP" },
    orderBy: { followUpStep: "asc" as const },
    select: {
      followUpStep: true,
      status: true,
      runAt: true,
      timezone: true,
      lastError: true,
    },
  },
  _count: { select: { messages: true, emailLogs: true } },
} as const;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;
    const campaign = await prisma.campaign.findFirst({ where: { id, userId }, include });
    if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

    const rawRecipients = campaign.recipients.filter((item) => item.contact.userId === userId);
    const counters = {
      total: rawRecipients.length,
      pending: rawRecipients.filter((item) => item.status === "PENDING").length,
      sending: rawRecipients.filter((item) => item.status === "SENDING").length,
      sent: rawRecipients.filter((item) => item.status === "SENT").length,
      failed: rawRecipients.filter((item) => item.status === "FAILED").length,
      replied: rawRecipients.filter((item) => item.status === "REPLIED").length,
      cancelled: rawRecipients.filter((item) => item.status === "CANCELLED").length,
      skipped: rawRecipients.filter((item) => item.status === "SKIPPED").length,
      syncedSheet: rawRecipients.filter((item) => item.sheetSyncStatus === "SYNCED").length,
      pendingSheet: rawRecipients.filter((item) => item.status === "SENT" && item.sheetSyncStatus !== "SYNCED").length,
    };

    const formCounters = {
      total: rawRecipients.length,
      pending: rawRecipients.filter((item) => item.formStatus === "PENDING").length,
      inProgress: rawRecipients.filter((item) => item.formStatus === "IN_PROGRESS").length,
      submitted: rawRecipients.filter((item) => item.formStatus === "SUBMITTED").length,
      awaitingManual: rawRecipients.filter((item) => item.formStatus === "AWAITING_MANUAL_ACTION").length,
      failed: rawRecipients.filter((item) => item.formStatus === "FAILED").length,
      notAvailable: rawRecipients.filter((item) => item.formStatus === "NOT_AVAILABLE").length,
      excluded: rawRecipients.filter((item) => item.formExcluded).length,
    };

    let completeCount = 0;
    let missingEmailCount = 0;
    let missingBrandCount = 0;
    let missingCategoryCount = 0;

    for (const r of rawRecipients) {
      const emailVal = r.snapshotEmail || (r.contact.email.includes(".invalid") ? "" : r.contact.email);
      const isEmailValid = Boolean(
        emailVal &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal) &&
        !/^(n\/a|none|undefined|null|-)$/i.test(emailVal)
      );
      const brandVal = r.snapshotBrand || r.contact.brandName || r.contact.fullName || r.contact.name || "";
      const isBrandValid = Boolean(
        brandVal &&
        !/^brand \(/i.test(brandVal) &&
        !/^lead #/i.test(brandVal) &&
        !/^(undefined|null|none|n\/a|-)$/i.test(brandVal)
      );
      const catVal = r.productCategory || r.contact.notes || "";
      const isCatValid = Boolean(
        catVal &&
        catVal !== "Missing Category" &&
        !/^(undefined|null|none|n\/a|-)$/i.test(catVal)
      );

      if (!isEmailValid) missingEmailCount++;
      if (!isBrandValid) missingBrandCount++;
      if (!isCatValid) missingCategoryCount++;

      if (isEmailValid && isBrandValid && isCatValid) {
        completeCount++;
      }
    }

    const rowIndices = rawRecipients.map((r) => r.sheetRowIndex).filter((x): x is number => typeof x === "number");
    const minRow = rowIndices.length ? Math.min(...rowIndices) : 1;
    const maxRow = rowIndices.length ? Math.max(...rowIndices) : rawRecipients.length;

    const rowSelection = {
      startRow: minRow,
      endRow: maxRow,
      totalSelected: rawRecipients.length,
      completeCount,
      missingEmailCount,
      missingBrandCount,
      missingCategoryCount,
    };

    const recipients = rawRecipients.map((item, idx) => {
      const brandName = item.snapshotBrand || item.contact.brandName || item.contact.fullName || item.contact.name || "Brand";
      const isPlaceholder = item.contact.email.includes(".invalid");
      const email = isPlaceholder ? (item.snapshotEmail || "") : (item.snapshotEmail || item.contact.email);
      const category = item.productCategory || item.contact.notes || "General";
      const sentAt = item.sentAt || item.messages[0]?.sentAt || (item.status === "SENT" ? item.scheduledJobs[0]?.processedAt : null);
      const errorMessage = item.errorMessage || item.messages[0]?.errorMessage || item.scheduledJobs[0]?.lastError || null;

      const formJob = item.websiteFormJobs?.[0];

      return {
        id: item.id,
        contactId: item.contactId,
        status: item.status,
        brandName,
        email,
        category,
        sheetRowIndex: item.sheetRowIndex ?? idx + 1,
        sentAt,
        errorMessage,
        sheetSyncStatus: item.sheetSyncStatus || "PENDING",
        sheetSyncedAt: item.sheetSyncedAt,
        sheetSyncError: item.sheetSyncError,
        scheduledRunAt: item.scheduledJobs[0]?.runAt || null,
        formStatus: item.formStatus,
        formUrl: item.formUrl || formJob?.targetUrl || null,
        formExcluded: item.formExcluded,
        formMissingInfo: item.formMissingInfo,
        formJob: formJob ? {
          id: formJob.id,
          status: formJob.status,
          targetUrl: formJob.targetUrl,
          resolvedValuesJson: formJob.resolvedValuesJson,
          runAt: formJob.runAt,
          submittedAt: formJob.submittedAt,
          lastError: formJob.lastError,
          manualActionReason: formJob.manualActionReason,
          browserTabId: formJob.browserTabId,
        } : null,
        contact: item.contact,
      };
    });

    return NextResponse.json({ campaign: { ...campaign, recipients, counters, formCounters, rowSelection } });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to load campaign." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid campaign update data.", fields: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const data = parsed.data;

    // Handle quick control action (pause / resume / cancel)
    if (data.action) {
      const result = await controlCampaign(userId, id, data.action);
      return NextResponse.json({ success: true, control: result });
    }

    const existing = await prisma.campaign.findFirst({
      where: { id, userId },
      select: { id: true, name: true, status: true, templateId: true, mailboxId: true },
    });
    if (!existing) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

    // Validate Mailbox if updated
    if (data.mailboxId) {
      const mailbox = await prisma.mailbox.findFirst({
        where: { id: data.mailboxId, userId, status: "ACTIVE", smtpStatus: "CONNECTED" },
        select: { id: true },
      });
      if (!mailbox) return NextResponse.json({ error: "Select a verified active mailbox." }, { status: 409 });
    }

    // Validate Template if updated
    let effectiveTemplateId = data.templateId !== undefined ? data.templateId : existing.templateId;
    if (data.templateId) {
      const tpl = await prisma.template.findFirst({
        where: { id: data.templateId, userId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!tpl) return NextResponse.json({ error: "Selected template not found." }, { status: 404 });
    }

    // If subject and body are provided directly, update or create dedicated template
    if (data.subject || data.body) {
      const formattedBody = data.body ? autoFormatGreetingWithBrand(data.body) : undefined;
      if (effectiveTemplateId) {
        await prisma.template.update({
          where: { id: effectiveTemplateId },
          data: {
            ...(data.subject ? { subject: data.subject } : {}),
            ...(formattedBody ? { body: formattedBody } : {}),
          },
        });
      } else {
        const newTpl = await prisma.template.create({
          data: {
            userId,
            name: `${data.name || existing.name} Template`,
            subject: data.subject || "Collaboration Proposal",
            body: formattedBody || "Hi {{brandName}} Team,\n\nWe would love to collaborate.",
            status: "ACTIVE",
          },
        });
        effectiveTemplateId = newTpl.id;
      }
    }

    // Re-space pending jobs if delaySeconds is updated
    if (data.delaySeconds !== undefined && data.delaySeconds >= 0) {
      const pendingJobs = await prisma.scheduledJob.findMany({
        where: { campaignId: id, userId, status: "PENDING" },
        orderBy: { runAt: "asc" },
      });
      if (pendingJobs.length > 0) {
        const base = Math.max(Date.now(), pendingJobs[0].runAt.getTime());
        for (let i = 0; i < pendingJobs.length; i++) {
          await prisma.scheduledJob.update({
            where: { id: pendingJobs[i].id },
            data: { runAt: new Date(base + i * data.delaySeconds * 1000) },
          });
        }
      }
    }

    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.mailboxId !== undefined ? { mailboxId: data.mailboxId } : {}),
        ...(effectiveTemplateId !== undefined ? { templateId: effectiveTemplateId } : {}),
        ...(data.sheetUrl !== undefined ? { sheetUrl: data.sheetUrl ? String(data.sheetUrl).trim() : null } : {}),
        ...(data.sheetWebhookUrl !== undefined ? { sheetWebhookUrl: data.sheetWebhookUrl ? String(data.sheetWebhookUrl).trim() : null } : {}),
        // Preserve current running or paused status; only set DRAFT if it was DRAFT/READY
        status: ["DRAFT", "READY"].includes(existing.status) ? "DRAFT" : existing.status,
      },
      select: { id: true, name: true, status: true },
    });

    return NextResponse.json({ success: true, campaign });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to update campaign." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;

    const existing = await prisma.campaign.findFirst({
      where: { id, userId },
      select: { id: true, name: true, status: true },
    });

    if (!existing) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      // 1. Immediately delete all pending/scheduled/cancelled jobs so dispatch halts instantly
      await tx.scheduledJob.deleteMany({
        where: {
          campaignId: id,
          status: { in: ["PENDING", "PROCESSING", "FAILED", "CANCELLED"] },
        },
      });

      // 2. Delete the campaign (recipients & followUpRules cascade; messages/emailLogs have campaignId set to null)
      await tx.campaign.delete({ where: { id } });
    });

    return NextResponse.json({
      success: true,
      message: `Campaign "${existing.name}" deleted successfully.`,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to delete campaign." }, { status: 500 });
  }
}
