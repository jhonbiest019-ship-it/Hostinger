import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export function clearWorkerStopFile() {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const stopFile = path.join(process.cwd(), ".local-run", "worker.stop");
    if (fs.existsSync(stopFile)) fs.unlinkSync(stopFile);
  } catch {
    // non-fatal
  }
}

export const RUNNING_STATUSES = ["SCHEDULED", "SENDING", "ACTIVE"] as const;
export async function updateCampaignProgress(campaignId: string) {
  await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({ where: { id: campaignId }, select: { id: true, status: true, followUpsEnabled: true } });
    if (!campaign || campaign.status === "CANCELLED" || campaign.status === "PAUSED") return;
    const pending = await tx.scheduledJob.count({ where: { campaignId, status: { in: ["PENDING", "PROCESSING"] } } });
    const pendingForms = await tx.websiteFormJob.count({ where: { campaignId, status: { in: ["PENDING", "IN_PROGRESS"] } } });
    if (!pending && !pendingForms && (RUNNING_STATUSES as readonly string[]).includes(campaign.status)) {
      await tx.campaign.update({ where: { id: campaignId }, data: { status: "COMPLETED", updatedAt: new Date() } });
    } else if ((pending > 0 || pendingForms > 0) && campaign.status === "COMPLETED") {
      await tx.campaign.update({ where: { id: campaignId }, data: { status: "SCHEDULED", updatedAt: new Date() } });
    }
  });
}
export async function controlCampaign(userId: string, id: string, action: "pause" | "resume" | "cancel") {
  return prisma.$transaction(async (tx) => {
    const allowed = action === "pause" ? [...RUNNING_STATUSES] : action === "resume" ? ["PAUSED" as const] : ["DRAFT", "READY", ...RUNNING_STATUSES, "PAUSED", "COMPLETED", "CANCELLED"] as const;
    const result = await tx.campaign.updateMany({ where: { id, userId, status: { in: [...allowed] } }, data: { status: action === "pause" ? "PAUSED" : action === "resume" ? "SCHEDULED" : "CANCELLED" } });
    if (!result.count) throw new Error("Campaign is unavailable or this action is not valid for its current state.");
    if (action === "pause") {
      await tx.scheduledJob.updateMany({
        where: { campaignId: id, userId, status: "PROCESSING", deliveryState: "NOT_STARTED" },
        data: { status: "PENDING", leaseToken: null, leaseExpiresAt: null },
      });
    }
    if (action === "cancel") {
      await tx.scheduledJob.updateMany({ where: { campaignId: id, userId, OR: [{ status: "PENDING" }, { status: "PROCESSING", deliveryState: "NOT_STARTED" }] }, data: { status: "CANCELLED", processedAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastError: "Campaign cancelled." } });
      await tx.campaignRecipient.updateMany({ where: { campaignId: id, status: "PENDING" }, data: { status: "CANCELLED" } });
      await tx.websiteFormJob.updateMany({
        where: { campaignId: id, userId, status: { in: ["PENDING", "IN_PROGRESS"] } },
        data: { status: "CANCELLED", lastError: "Campaign cancelled." },
      });
    }
    if (action === "resume") {
      clearWorkerStopFile();
      await tx.campaignRecipient.updateMany({
        where: { campaignId: id, status: "CANCELLED", repliedAt: null, sentAt: null },
        data: { status: "PENDING", errorMessage: null },
      });
      const pendingJobs = await tx.scheduledJob.findMany({
        where: { campaignId: id, userId, status: "PENDING" },
        orderBy: { runAt: "asc" },
      });
      const now = Date.now();
      // Only shift jobs if they are in the past (overdue while paused)
      if (pendingJobs.length > 0 && pendingJobs[0].runAt.getTime() < now) {
        // Calculate original interval if possible
        const originalGap = pendingJobs.length > 1
          ? Math.max(10000, pendingJobs[1].runAt.getTime() - pendingJobs[0].runAt.getTime())
          : 30000;
        for (let i = 0; i < pendingJobs.length; i++) {
          await tx.scheduledJob.update({
            where: { id: pendingJobs[i].id },
            data: { runAt: new Date(now + 2000 + i * originalGap) },
          });
        }
      }
    }
    const inFlight = await tx.scheduledJob.count({ where: { campaignId: id, status: "PROCESSING", deliveryState: "IN_FLIGHT" } });
    return { success: true, status: action === "pause" ? "PAUSED" : action === "resume" ? "SCHEDULED" : "CANCELLED", inFlight };
  });
}

// Call only inside a transaction. This lock also serializes queueing against edits.
export async function lockEditableCampaign(tx: Prisma.TransactionClient, userId: string, id: string) {
  const locked = await tx.campaign.updateMany({ where: { id, userId, status: { in: ["DRAFT", "READY"] } }, data: { updatedAt: new Date() } });
  if (!locked.count || await tx.scheduledJob.count({ where: { campaignId: id } })) throw new Error("This campaign is already scheduled. Duplicate it to change recipients or content.");
}

export async function emergencyStopAll(userId: string, action: "pause" | "cancel" = "pause") {
  return prisma.$transaction(async (tx) => {
    const activeCampaigns = await tx.campaign.findMany({
      where: { userId, status: { in: [...RUNNING_STATUSES] } },
      select: { id: true, name: true },
    });

    const targetStatus = action === "cancel" ? "CANCELLED" : "PAUSED";
    let updatedCampaigns = 0;
    if (activeCampaigns.length > 0) {
      const campRes = await tx.campaign.updateMany({
        where: { userId, status: { in: [...RUNNING_STATUSES] } },
        data: { status: targetStatus, updatedAt: new Date() },
      });
      updatedCampaigns = campRes.count;
    }

    const resetProcessing = await tx.scheduledJob.updateMany({
      where: {
        userId,
        status: "PROCESSING",
        deliveryState: "NOT_STARTED",
      },
      data: {
        status: action === "cancel" ? "CANCELLED" : "PENDING",
        leaseToken: null,
        leaseExpiresAt: null,
        processedAt: action === "cancel" ? new Date() : null,
        lastError: action === "cancel" ? "Emergency stop: cancelled by user." : "Emergency stop: paused by user.",
      },
    });

    let cancelledDirect = 0;
    if (action === "cancel") {
      const cancelJobs = await tx.scheduledJob.updateMany({
        where: {
          userId,
          status: "PENDING",
        },
        data: {
          status: "CANCELLED",
          processedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: "Emergency stop: cancelled by user.",
        },
      });
      cancelledDirect = cancelJobs.count;

      await tx.campaignRecipient.updateMany({
        where: {
          campaign: { userId },
          status: "PENDING",
        },
        data: { status: "CANCELLED" },
      });
    }

    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const stopDir = path.join(process.cwd(), ".local-run");
      if (!fs.existsSync(stopDir)) fs.mkdirSync(stopDir, { recursive: true });
      fs.writeFileSync(path.join(stopDir, "worker.stop"), "stop");
    } catch {
      // non-fatal if running in environments without direct fs access
    }

    return {
      success: true,
      action,
      pausedCampaignsCount: updatedCampaigns,
      campaignNames: activeCampaigns.map((c) => c.name),
      resetProcessingJobs: resetProcessing.count,
      cancelledJobsCount: cancelledDirect,
    };
  });
}

export async function emergencyResumeAll(userId: string) {
  return prisma.$transaction(async (tx) => {
    const paused = await tx.campaign.findMany({
      where: { userId, status: "PAUSED" },
      select: { id: true, name: true },
    });

    if (paused.length > 0) {
      await tx.campaign.updateMany({
        where: { userId, status: "PAUSED" },
        data: { status: "SCHEDULED", updatedAt: new Date() },
      });
    }

    clearWorkerStopFile();

    return {
      success: true,
      resumedCampaignsCount: paused.length,
      campaignNames: paused.map((c) => c.name),
    };
  });
}
