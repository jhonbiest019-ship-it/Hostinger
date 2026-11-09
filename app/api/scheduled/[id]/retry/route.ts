import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request); const { id } = await context.params;
    const job = await prisma.scheduledJob.findFirst({ where: { id, userId } });
    if (!job?.campaignId || !job.campaignRecipientId) return NextResponse.json({ error: "Job is unavailable." }, { status: 404 });
    await prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.updateMany({ where: { id: job.campaignId!, userId, status: { not: "CANCELLED" } }, data: { updatedAt: new Date() } });
      if (!campaign.count) throw new Error("Campaign is cancelled.");
      const recipient = await tx.campaignRecipient.findUnique({ where: { id: job.campaignRecipientId! } });
      if (!recipient || recipient.repliedAt || ["REPLIED", "CANCELLED"].includes(recipient.status)) throw new Error("Recipient has replied or was cancelled.");
      const changed = await tx.scheduledJob.updateMany({ where: { id, userId, status: "FAILED", deliveryState: "NOT_STARTED" }, data: { status: "PENDING", runAt: new Date(), nextAttemptAt: null, processedAt: null, attempts: 0, leaseToken: null, leaseExpiresAt: null, lastError: null } });
      if (!changed.count) throw new Error("Only failed jobs with a confirmed non-delivery can be retried.");
      await tx.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "PENDING" } });
      await tx.campaign.updateMany({ where: { id: job.campaignId!, status: "COMPLETED" }, data: { status: "SCHEDULED" } });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Retry unavailable. The recipient may have replied, the campaign may be cancelled, or delivery may be uncertain. Refresh the status." }, { status: 409 });
  }
}
