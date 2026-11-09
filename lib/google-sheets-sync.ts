import { prisma } from "@/lib/prisma";

export function formatSentDateTime(date: Date | string | null) {
  if (!date) return { dateStr: "", timeStr: "", fullStr: "" };
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return { dateStr: "", timeStr: "", fullStr: "" };

  const pad = (n: number) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const readableMonth = months[d.getMonth()];

  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hours}:${minutes}`;
  const readableStr = `${day} ${readableMonth} ${year}, ${timeStr}`;

  return { dateStr, timeStr, readableStr, fullStr: `${dateStr} ${timeStr}` };
}

/**
 * Synchronizes an individual recipient's SENT / FAILED status to Google Sheet.
 * Crucial safety guarantee: This NEVER sends or re-sends emails.
 */
export async function syncRecipientToGoogleSheet(recipientId: string) {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: {
      campaign: {
        select: {
          id: true,
          name: true,
          sheetUrl: true,
          sheetTab: true,
          sheetWebhookUrl: true,
        },
      },
      contact: {
        select: {
          name: true,
          brandName: true,
          email: true,
          notes: true,
        },
      },
    },
  });

  if (!recipient) {
    return { success: false, error: "Recipient not found." };
  }

  // Only sync if recipient has reached terminal status (SENT or FAILED)
  if (recipient.status !== "SENT" && recipient.status !== "FAILED") {
    return { success: false, error: "Recipient email has not been processed yet." };
  }

  const { dateStr, timeStr, readableStr } = formatSentDateTime(recipient.sentAt || new Date());
  const brandName = recipient.snapshotBrand || recipient.contact.brandName || recipient.contact.name || "Brand";
  const email = recipient.snapshotEmail || recipient.contact.email;
  const category = recipient.productCategory || recipient.contact.notes || "General";
  const rowIndex = recipient.sheetRowIndex ?? null;

  const webhookUrl = recipient.campaign.sheetWebhookUrl?.trim();

  if (!webhookUrl) {
    // No webhook configured yet; record that sync is pending webhook configuration
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: {
        sheetSyncStatus: "RETRY",
        sheetSyncError: "Pending Google Sheet webhook setup. Paste your Apps Script Web App URL to auto-update rows.",
      },
    });
    return {
      success: false,
      pendingSetup: true,
      error: "Google Sheet Webhook URL is not configured for this campaign.",
    };
  }

  try {
    const payload = {
      action: "updateRow",
      campaignId: recipient.campaign.id,
      campaignName: recipient.campaign.name,
      sheetUrl: recipient.campaign.sheetUrl,
      sheetTab: recipient.campaign.sheetTab || "0",
      rowIndex,
      brandName,
      email,
      category,
      status: recipient.status,
      sentDate: dateStr,
      sentTime: timeStr,
      sentDisplay: `${recipient.status} (${readableStr})`,
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "HTTP Error " + res.status);
      throw new Error(`Google Sheet Webhook error (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json().catch(() => ({ success: true }));

    if (data && data.success === false) {
      throw new Error(data.error || "Google Sheet script returned failure.");
    }

    // Success! Update recipient record
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: {
        sheetSyncStatus: "SYNCED",
        sheetSyncedAt: new Date(),
        sheetSyncError: null,
      },
    });

    return { success: true };
  } catch (error: any) {
    const errorMessage = error?.message || "Failed to update Google Sheet.";
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: {
        sheetSyncStatus: "RETRY",
        sheetSyncError: errorMessage,
      },
    });
    return { success: false, error: errorMessage };
  }
}

/**
 * Batch retry synchronization of all SENT recipients for a campaign.
 * Will NEVER trigger any email dispatch; only writes to the Google Sheet.
 */
export async function syncCampaignSheetBatch(campaignId: string, userId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId },
    select: { id: true, name: true, sheetWebhookUrl: true },
  });

  if (!campaign) {
    throw new Error("Campaign not found.");
  }

  // Find all recipients that were successfully SENT or FAILED, but not yet SYNCED to sheet
  const pendingRecipients = await prisma.campaignRecipient.findMany({
    where: {
      campaignId,
      status: { in: ["SENT", "FAILED"] },
      NOT: { sheetSyncStatus: "SYNCED" },
    },
    select: { id: true },
  });

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const r of pendingRecipients) {
    const result = await syncRecipientToGoogleSheet(r.id);
    if (result.success) {
      synced++;
    } else {
      failed++;
      if (result.error && !errors.includes(result.error)) {
        errors.push(result.error);
      }
    }
  }

  return {
    total: pendingRecipients.length,
    synced,
    failed,
    errors,
  };
}
