import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const now = new Date();

    // Check for active campaigns in SENDING, SCHEDULED, or ACTIVE status
    const campaigns = await prisma.campaign.findMany({
      where: {
        userId,
        status: { in: ["SENDING", "SCHEDULED", "ACTIVE"] },
      },
      select: {
        id: true,
        name: true,
        status: true,
        mailbox: {
          select: {
            id: true,
            emailAddress: true,
            displayName: true,
          },
        },
        recipients: {
          select: {
            status: true,
          },
        },
        scheduledJobs: {
          where: {
            status: { in: ["PENDING", "PROCESSING"] },
          },
          select: {
            id: true,
            status: true,
            runAt: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const pausedCampaigns = await prisma.campaign.findMany({
      where: { userId, status: "PAUSED" },
      select: {
        id: true,
        name: true,
        description: true,
        mailboxId: true,
        templateId: true,
        updatedAt: true,
        mailbox: {
          select: {
            id: true,
            emailAddress: true,
            displayName: true,
          },
        },
        template: {
          select: {
            id: true,
            name: true,
            subject: true,
            body: true,
          },
        },
        _count: {
          select: {
            recipients: true,
            scheduledJobs: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const directScheduledCount = await prisma.scheduledJob.count({
      where: {
        userId,
        campaignId: null,
        status: { in: ["PENDING", "PROCESSING"] },
      },
    });

    const activeList = campaigns.map((camp) => {
      const total = camp.recipients.length;
      const sent = camp.recipients.filter((r) => r.status === "SENT").length;
      const pending = camp.recipients.filter((r) => r.status === "PENDING" || r.status === "SENDING").length;
      const failed = camp.recipients.filter((r) => r.status === "FAILED").length;
      const processingJobs = camp.scheduledJobs.filter((j) => j.status === "PROCESSING").length;
      const dueJobs = camp.scheduledJobs.filter((j) => j.status === "PENDING" && new Date(j.runAt) <= now).length;
      const futureJobs = camp.scheduledJobs.filter((j) => j.status === "PENDING" && new Date(j.runAt) > now).length;

      return {
        id: camp.id,
        name: camp.name,
        status: camp.status,
        mailboxEmail: camp.mailbox?.emailAddress || "Default Hostinger Mailbox",
        mailboxName: camp.mailbox?.displayName || null,
        total,
        sent,
        pending,
        failed,
        processingJobs,
        dueJobs,
        futureJobs,
        isCurrentlyDispatching: camp.status === "SENDING" || processingJobs > 0 || dueJobs > 0,
      };
    });

    const isSending = activeList.some((c) => c.isCurrentlyDispatching);
    const hasActiveSchedules = activeList.length > 0 || directScheduledCount > 0;

    return NextResponse.json({
      success: true,
      isSending,
      hasActiveSchedules,
      activeCampaigns: activeList,
      pausedCampaigns,
      directScheduledCount,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to check active sending status." }, { status: 500 });
  }
}
