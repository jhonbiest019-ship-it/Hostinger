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
      where: { id: jobId, userId, jobType: "FOLLOW_UP", status: { in: ["PENDING", "PROCESSING"] } },
    });

    if (!job) {
      return NextResponse.json({ error: "Pending follow-up job not found." }, { status: 404 });
    }

    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: {
        status: "CANCELLED",
        processedAt: new Date(),
        lastError: "Cancelled by user manually.",
      },
    });

    return NextResponse.json({
      success: true,
      message: "Follow-up cancelled.",
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to cancel follow-up." }, { status: 500 });
  }
}
