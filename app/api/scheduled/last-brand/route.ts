import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);

    // 1. Check pending scheduled job first (highest priority)
    const pendingJob = await prisma.scheduledJob.findFirst({
      where: { userId, status: "PENDING" },
      orderBy: { runAt: "desc" },
      include: {
        campaignRecipient: {
          include: { contact: true },
        },
        campaign: {
          select: { id: true, name: true },
        },
      },
    });

    // 2. If no pending, check most recently created scheduled job
    const anyJob = pendingJob
      ? null
      : await prisma.scheduledJob.findFirst({
          where: { userId },
          orderBy: { createdAt: "desc" },
          include: {
            campaignRecipient: {
              include: { contact: true },
            },
            campaign: {
              select: { id: true, name: true },
            },
          },
        });

    const targetJob = pendingJob || anyJob;

    if (targetJob) {
      const cr = targetJob.campaignRecipient;
      const contact = cr?.contact;
      const brandName =
        cr?.snapshotBrand ||
        contact?.brandName ||
        contact?.companyName ||
        contact?.name ||
        contact?.fullName ||
        "";
      const email = cr?.snapshotEmail || contact?.email || "";
      const category = cr?.productCategory || contact?.notes || "";

      if (brandName || email) {
        return NextResponse.json({
          lastBrand: {
            brandName: brandName || "Brand",
            email,
            category,
            campaignName: targetJob.campaign?.name || "",
            scheduledAt: targetJob.runAt || targetJob.createdAt,
            status: targetJob.status,
          },
        });
      }
    }

    // 3. If no scheduled jobs yet, check the most recent campaign recipient
    const recipient = await prisma.campaignRecipient.findFirst({
      where: { campaign: { userId } },
      orderBy: { createdAt: "desc" },
      include: {
        contact: true,
        campaign: { select: { id: true, name: true } },
      },
    });

    if (recipient) {
      const contact = recipient.contact;
      const brandName =
        recipient.snapshotBrand ||
        contact?.brandName ||
        contact?.companyName ||
        contact?.name ||
        contact?.fullName ||
        "";
      const email = recipient.snapshotEmail || contact?.email || "";
      const category = recipient.productCategory || contact?.notes || "";

      return NextResponse.json({
        lastBrand: {
          brandName: brandName || "Brand",
          email,
          category,
          campaignName: recipient.campaign?.name || "",
          scheduledAt: recipient.createdAt,
          status: recipient.status,
        },
      });
    }

    return NextResponse.json({ lastBrand: null });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to retrieve last scheduled brand." }, { status: 500 });
  }
}
