import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { updateCampaignProgress } from "@/lib/campaign-controls";

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const { recipientId, jobId, contactId } = body;

    let targetRecipientId = recipientId;

    if (!targetRecipientId && jobId) {
      const job = await prisma.scheduledJob.findFirst({
        where: { id: jobId, userId },
        select: { campaignRecipientId: true },
      });
      targetRecipientId = job?.campaignRecipientId;
    }

    if (!targetRecipientId && contactId) {
      const rec = await prisma.campaignRecipient.findFirst({
        where: { contactId, campaign: { userId } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      targetRecipientId = rec?.id;
    }

    if (!targetRecipientId) {
      return NextResponse.json({ error: "Recipient ID or Job ID is required." }, { status: 400 });
    }

    const recipient = await prisma.campaignRecipient.findFirst({
      where: { id: targetRecipientId, campaign: { userId } },
      include: { contact: true, campaign: true },
    });

    if (!recipient) {
      return NextResponse.json({ error: "Recipient not found." }, { status: 404 });
    }

    const now = new Date();

    // 1. Mark recipient as REPLIED
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: "REPLIED",
        repliedAt: now,
      },
    });

    // 2. Mark contact as REPLIED
    if (recipient.contactId) {
      await prisma.contact.updateMany({
        where: { id: recipient.contactId, userId },
        data: { status: "REPLIED" },
      });
    }

    // 3. Cancel all pending/processing FOLLOW_UP jobs for this recipient
    const cancelledJobs = await prisma.scheduledJob.updateMany({
      where: {
        userId,
        campaignRecipientId: recipient.id,
        jobType: "FOLLOW_UP",
        status: { in: ["PENDING", "PROCESSING"] },
      },
      data: {
        status: "CANCELLED",
        processedAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: "Cancelled: Marked as replied by user.",
      },
    });

    // 4. Create an email log entry
    await prisma.emailLog.create({
      data: {
        userId,
        campaignId: recipient.campaignId,
        contactId: recipient.contactId,
        sender: "user-action",
        recipient: recipient.contact.email,
        subject: "Brand marked as replied",
        status: "REPLIED",
        message: `Marked as replied manually. Cancelled ${cancelledJobs.count} pending follow-up job(s).`,
      },
    });

    if (recipient.campaignId) {
      await updateCampaignProgress(recipient.campaignId);
    }

    return NextResponse.json({
      success: true,
      message: `Brand "${recipient.contact.brandName || recipient.contact.name}" marked as replied. Future follow-ups stopped immediately.`,
      cancelledCount: cancelledJobs.count,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to mark as replied." }, { status: 500 });
  }
}
