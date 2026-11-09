import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { updateCampaignProgress } from "@/lib/campaign-controls";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request); const { id } = await context.params;
    const job = await prisma.scheduledJob.findFirst({ where: { id, userId } });
    if (!job) return NextResponse.json({ error: "Scheduled job not found." }, { status: 404 });
    const changed = await prisma.$transaction(async (tx) => {
      if (job.campaignId) await tx.campaign.updateMany({ where: { id: job.campaignId, userId }, data: { updatedAt: new Date() } });
      const result = await tx.scheduledJob.updateMany({ where: { id, userId, OR: [{ status: "PENDING" }, { status: "PROCESSING", deliveryState: "NOT_STARTED" }] }, data: { status: "CANCELLED", processedAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastError: "Cancelled by user. Later follow-ups for this recipient are stopped." } });
      if (result.count && job.campaignRecipientId) {
        await tx.campaignRecipient.updateMany({ where: { id: job.campaignRecipientId, status: { not: "REPLIED" } }, data: { status: "CANCELLED" } });
        await tx.scheduledJob.updateMany({ where: { campaignRecipientId: job.campaignRecipientId, userId, status: "PENDING" }, data: { status: "CANCELLED", processedAt: new Date(), lastError: "Recipient sequence cancelled." } });
      }
      return result.count;
    });
    if (!changed) return NextResponse.json({ error: "This job has already started sending or finished. Refresh its status." }, { status: 409 });
    if (job.campaignId) await updateCampaignProgress(job.campaignId);
    return NextResponse.json({ success: true });
  } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to cancel scheduled job." }, { status: 500 }); }
}
