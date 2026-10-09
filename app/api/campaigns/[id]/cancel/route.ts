import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request); const { id } = await context.params;
    const campaign = await prisma.campaign.findFirst({ where: { id, userId }, select: { id: true } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    await prisma.$transaction([prisma.scheduledJob.updateMany({ where: { campaignId: id, status: "PENDING" }, data: { status: "CANCELLED", processedAt: new Date(), lastError: "Campaign cancelled." } }), prisma.campaignRecipient.updateMany({ where: { campaignId: id, status: "PENDING" }, data: { status: "SKIPPED" } }), prisma.campaign.update({ where: { id }, data: { status: "CANCELLED" } })]);
    return NextResponse.json({ success: true, status: "CANCELLED" });
  } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to cancel campaign." }, { status: 500 }); }
}
