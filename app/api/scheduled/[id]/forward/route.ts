import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { processDueJobs } from "@/lib/queue/worker";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;

    const job = await prisma.scheduledJob.findFirst({
      where: { id, userId },
      include: {
        campaign: { select: { id: true, name: true } },
        campaignRecipient: { include: { contact: true } },
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Scheduled email not found." }, { status: 404 });
    }

    // Set runAt to now, reset nextAttemptAt, clear lease, ensure PENDING
    await prisma.scheduledJob.update({
      where: { id },
      data: {
        runAt: new Date(),
        nextAttemptAt: null,
        status: "PENDING",
        deliveryState: "NOT_STARTED",
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });

    if (job.campaignRecipientId) {
      await prisma.campaignRecipient.updateMany({
        where: { id: job.campaignRecipientId },
        data: {
          status: "PENDING",
          errorMessage: null,
        },
      });
    }

    if (job.campaignId) {
      await prisma.campaign.updateMany({
        where: { id: job.campaignId, status: { in: ["PAUSED", "COMPLETED", "SCHEDULED", "DRAFT", "CANCELLED"] } },
        data: { status: "SENDING", updatedAt: new Date() },
      });
    }

    // Trigger worker immediately and wait for processing so the caller gets real-time sync
    const queueResult = await processDueJobs().catch((err) => {
      console.error("Direct worker execution failed:", err);
      return null;
    });

    // Check updated status
    const updatedJob = await prisma.scheduledJob.findUnique({
      where: { id },
      select: { status: true, lastError: true },
    });

    const brand =
      job.campaignRecipient?.snapshotBrand ||
      job.campaignRecipient?.contact.brandName ||
      job.campaignRecipient?.contact.name ||
      "Brand";

    const isSent = updatedJob?.status === "COMPLETED";
    const isFailed = updatedJob?.status === "FAILED";

    return NextResponse.json({
      success: true,
      jobStatus: updatedJob?.status ?? "PENDING",
      queueResult,
      message: isSent
        ? `⚡ Email for "${brand}" successfully sent in real time!`
        : isFailed
        ? `⚠️ Email dispatch for "${brand}" failed: ${updatedJob?.lastError || "Unknown error"}`
        : `⚡ Email for "${brand}" forwarded for immediate dispatch!`,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Single job forward error:", error);
    return NextResponse.json({ error: "Failed to forward email." }, { status: 500 });
  }
}
