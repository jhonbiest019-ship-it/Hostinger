import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get("campaignId");
    const statusFilter = searchParams.get("status"); // ALL, SCHEDULED, SENT, REPLIED, CANCELLED
    const search = searchParams.get("search")?.toLowerCase().trim();

    // 1. Fetch campaigns for filter dropdown
    const campaigns = await prisma.campaign.findMany({
      where: { userId },
      select: { id: true, name: true, followUpsEnabled: true, status: true },
      orderBy: { createdAt: "desc" },
    });

    // 2. Fetch templates for sequence editor & preview
    const templates = await prisma.template.findMany({
      where: { userId, status: "ACTIVE" },
      select: { id: true, name: true, subject: true, body: true },
      orderBy: { createdAt: "desc" },
    });

    // 3. Fetch all follow-up scheduled jobs
    const jobs = await prisma.scheduledJob.findMany({
      where: {
        userId,
        jobType: "FOLLOW_UP",
        ...(campaignId ? { campaignId } : {}),
      },
      include: {
        campaign: { select: { id: true, name: true, status: true } },
        campaignRecipient: {
          include: {
            contact: true,
          },
        },
        followUpRule: {
          include: {
            template: true,
          },
        },
        message: {
          include: {
            template: true,
          },
        },
      },
      orderBy: { runAt: "desc" },
      take: 500,
    });

    // 4. Fetch recipients who replied and belong to campaigns with follow-ups enabled
    const repliedRecipients = await prisma.campaignRecipient.findMany({
      where: {
        campaign: { userId, ...(campaignId ? { id: campaignId } : {}) },
        repliedAt: { not: null },
      },
      include: {
        campaign: { select: { id: true, name: true, status: true } },
        contact: true,
        messages: {
          where: { direction: "INBOUND" },
          orderBy: { receivedAt: "desc" },
          take: 1,
        },
      },
      take: 200,
    });

    // 5. Fetch sent follow-up messages
    const sentFollowUpMessages = await prisma.emailMessage.findMany({
      where: {
        userId,
        followUpStep: { gt: 0 },
        status: "SENT",
        direction: "OUTBOUND",
        ...(campaignId ? { campaignId } : {}),
      },
      include: {
        campaign: { select: { id: true, name: true, status: true } },
        contact: true,
        recipient: true,
        template: true,
      },
      orderBy: { sentAt: "desc" },
      take: 200,
    });

    // Unified item map
    const itemsMap = new Map<string, any>();

    // Add Scheduled and In-Flight Follow-up Jobs
    for (const job of jobs) {
      const recipient = job.campaignRecipient;
      const contact = recipient?.contact;
      const brandName =
        contact?.brandName ||
        recipient?.snapshotBrand ||
        contact?.fullName ||
        contact?.name ||
        contact?.companyName ||
        "Unknown Brand";
      const brandEmail = contact?.email || recipient?.snapshotEmail || "";
      const category = contact?.notes || "";
      const stepNumber = job.followUpStep || job.followUpRule?.stepNumber || 1;

      const isReplied =
        recipient?.status === "REPLIED" ||
        Boolean(recipient?.repliedAt) ||
        (job.lastError?.toLowerCase().includes("replied") ?? false);

      let itemStatus: "SCHEDULED" | "PROCESSING" | "SENT" | "REPLIED_STOPPED" | "CANCELLED" | "FAILED" = "SCHEDULED";
      if (isReplied) {
        itemStatus = "REPLIED_STOPPED";
      } else if (job.status === "COMPLETED" || job.message?.status === "SENT") {
        itemStatus = "SENT";
      } else if (job.status === "PROCESSING") {
        itemStatus = "PROCESSING";
      } else if (job.status === "CANCELLED") {
        itemStatus = "CANCELLED";
      } else if (job.status === "FAILED") {
        itemStatus = "FAILED";
      } else {
        itemStatus = "SCHEDULED";
      }

      const template = job.message?.template || job.followUpRule?.template;
      const templateName =
        template?.name ||
        (job.followUpRule?.templateId ? "Assigned Template" : `Follow-up Step ${stepNumber}`);
      const subject =
        job.message?.subject ||
        job.followUpRule?.subject ||
        template?.subject ||
        "Follow-up";
      const bodyPreview =
        job.message?.body ||
        job.followUpRule?.body ||
        template?.body ||
        "";

      const key = `${job.campaignRecipientId || job.id}_${stepNumber}`;

      itemsMap.set(key, {
        id: job.id,
        jobId: job.id,
        messageId: job.messageId || job.message?.id || null,
        recipientId: job.campaignRecipientId || "",
        contactId: contact?.id || "",
        campaignId: job.campaignId || job.campaign?.id || "",
        campaignName: job.campaign?.name || "Campaign",
        brandName,
        brandEmail,
        productCategory: category,
        stepNumber,
        delayAmount: job.followUpRule?.delayAmount ?? 1,
        delayUnit: job.followUpRule?.delayUnit ?? "DAYS",
        templateId: template?.id || job.followUpRule?.templateId || null,
        templateName,
        subject,
        bodyPreview,
        runAt: job.runAt,
        sentAt: job.processedAt || job.message?.sentAt || null,
        repliedAt: recipient?.repliedAt || null,
        status: itemStatus,
        lastError: job.lastError,
        stopReason: isReplied ? (job.lastError || "Brand replied to email. Sequence stopped.") : null,
      });
    }

    // Add Sent Follow-up Messages if not already in itemsMap
    for (const msg of sentFollowUpMessages) {
      const stepNumber = msg.followUpStep || 1;
      const key = `${msg.recipientId || msg.id}_${stepNumber}`;
      if (!itemsMap.has(key)) {
        const contact = msg.contact;
        const brandName =
          contact?.brandName ||
          contact?.fullName ||
          contact?.name ||
          contact?.companyName ||
          "Unknown Brand";
        const brandEmail = msg.toAddress || contact?.email || "";

        itemsMap.set(key, {
          id: msg.id,
          jobId: null,
          messageId: msg.id,
          recipientId: msg.recipientId || "",
          contactId: msg.contactId || "",
          campaignId: msg.campaignId || "",
          campaignName: msg.campaign?.name || "Campaign",
          brandName,
          brandEmail,
          productCategory: contact?.notes || "",
          stepNumber,
          delayAmount: 1,
          delayUnit: "DAYS",
          templateId: msg.templateId || null,
          templateName: msg.template?.name || `Follow-up Step ${stepNumber}`,
          subject: msg.subject,
          bodyPreview: msg.body,
          runAt: msg.scheduledAt,
          sentAt: msg.sentAt,
          repliedAt: msg.recipient?.repliedAt || null,
          status: msg.recipient?.repliedAt ? "REPLIED_STOPPED" : "SENT",
          lastError: null,
          stopReason: msg.recipient?.repliedAt ? "Brand replied. Future follow-ups stopped." : null,
        });
      }
    }

    // Add Replied Recipients if not in itemsMap
    for (const r of repliedRecipients) {
      const key = `${r.id}_1`;
      if (!itemsMap.has(key)) {
        const brandName =
          r.contact?.brandName ||
          r.snapshotBrand ||
          r.contact?.fullName ||
          r.contact?.name ||
          "Unknown Brand";
        const brandEmail = r.contact?.email || r.snapshotEmail || "";
        itemsMap.set(key, {
          id: `replied-${r.id}`,
          jobId: null,
          messageId: null,
          recipientId: r.id,
          contactId: r.contactId,
          campaignId: r.campaignId,
          campaignName: r.campaign.name,
          brandName,
          brandEmail,
          productCategory: r.contact?.notes || "",
          stepNumber: 1,
          delayAmount: 1,
          delayUnit: "DAYS",
          templateName: "Follow-up (Stopped)",
          subject: r.messages[0]?.subject ? `Re: ${r.messages[0].subject}` : "Follow-up",
          bodyPreview: r.messages[0]?.body || "",
          runAt: null,
          sentAt: null,
          repliedAt: r.repliedAt,
          status: "REPLIED_STOPPED",
          lastError: "Brand replied. Follow-up cancelled.",
          stopReason: "Brand replied to email. Sequence stopped automatically.",
        });
      }
    }

    let allItems = Array.from(itemsMap.values());

    // Compute stats
    const stats = {
      total: allItems.length,
      scheduled: allItems.filter((i) => i.status === "SCHEDULED" || i.status === "PROCESSING").length,
      sent: allItems.filter((i) => i.status === "SENT").length,
      replied: allItems.filter((i) => i.status === "REPLIED_STOPPED").length,
      cancelled: allItems.filter((i) => i.status === "CANCELLED" || i.status === "FAILED").length,
    };

    // Apply status filter
    if (statusFilter && statusFilter !== "ALL") {
      allItems = allItems.filter((i) => {
        if (statusFilter === "SCHEDULED") return i.status === "SCHEDULED" || i.status === "PROCESSING";
        if (statusFilter === "SENT") return i.status === "SENT";
        if (statusFilter === "REPLIED") return i.status === "REPLIED_STOPPED";
        if (statusFilter === "CANCELLED") return i.status === "CANCELLED" || i.status === "FAILED";
        return true;
      });
    }

    // Apply search filter
    if (search) {
      allItems = allItems.filter(
        (i) =>
          i.brandName.toLowerCase().includes(search) ||
          i.brandEmail.toLowerCase().includes(search) ||
          i.campaignName.toLowerCase().includes(search) ||
          i.subject.toLowerCase().includes(search) ||
          i.productCategory.toLowerCase().includes(search)
      );
    }

    return NextResponse.json({
      items: allItems,
      stats,
      campaigns,
      templates,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to load follow-up tracking data." }, { status: 500 });
  }
}
