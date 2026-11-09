import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { syncRecipientToGoogleSheet, syncCampaignSheetBatch } from "@/lib/google-sheets-sync";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;

    const campaign = await prisma.campaign.findFirst({
      where: { id, userId },
      select: { id: true, name: true, sheetUrl: true, sheetWebhookUrl: true },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { recipientId, webhookUrl, batch } = body;

    // 1. Update webhook URL if supplied
    if (webhookUrl !== undefined) {
      await prisma.campaign.update({
        where: { id },
        data: { sheetWebhookUrl: webhookUrl ? String(webhookUrl).trim() : null },
      });
    }

    // 2. Single recipient sync retry
    if (recipientId) {
      const recipient = await prisma.campaignRecipient.findFirst({
        where: { id: recipientId, campaignId: id },
      });

      if (!recipient) {
        return NextResponse.json({ error: "Recipient not found." }, { status: 404 });
      }

      const result = await syncRecipientToGoogleSheet(recipientId);
      return NextResponse.json({
        success: result.success,
        sheetSyncStatus: result.success ? "SYNCED" : "RETRY",
        error: result.error || null,
        message: result.success
          ? "Google Sheet row successfully updated!"
          : result.error || "Sync pending webhook setup.",
      });
    }

    // 3. Batch sync retry for all SENT/FAILED recipients in this campaign
    const batchResult = await syncCampaignSheetBatch(id, userId);

    return NextResponse.json({
      success: true,
      ...batchResult,
      message:
        batchResult.total === 0
          ? "No pending sheet syncs found."
          : `Synced ${batchResult.synced} of ${batchResult.total} brand records to Google Sheet.`,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Sheet sync endpoint error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync with Google Sheet." },
      { status: 500 }
    );
  }
}
