import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json({ error: "Job ID is required." }, { status: 400 });
    }

    const job = await prisma.scheduledJob.findFirst({
      where: { id: jobId, userId, jobType: "FOLLOW_UP", status: "PENDING" },
      include: { campaignRecipient: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Scheduled follow-up job not found or not pending." }, { status: 404 });
    }

    if (job.campaignRecipient?.status === "REPLIED" || job.campaignRecipient?.repliedAt) {
      return NextResponse.json({ error: "Recipient has already replied. Follow-up cannot be sent." }, { status: 400 });
    }

    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: {
        runAt: new Date(Date.now() - 1000),
        nextAttemptAt: null,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Follow-up queued for immediate delivery.",
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to expedite follow-up." }, { status: 500 });
  }
}
