import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { lockEditableCampaign } from "@/lib/campaign-controls";
import { recipientSchema } from "@/lib/campaign";
import { processDueJobs } from "@/lib/queue/worker";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;
    const campaign = await prisma.campaign.findFirst({
      where: { id, userId },
      select: { id: true, status: true, _count: { select: { messages: true } } },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    if (!["DRAFT", "READY"].includes(campaign.status) || campaign._count.messages) {
      return NextResponse.json(
        { error: "Recipients cannot be changed after scheduling. Duplicate this campaign for a new recipient list." },
        { status: 409 }
      );
    }
    const parsed = recipientSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid recipient selection." }, { status: 400 });
    const ids = [...new Set(parsed.data.contactIds)];
    const contacts = await prisma.contact.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true, name: true, fullName: true, brandName: true, companyName: true, email: true, status: true },
    });
    const excluded = contacts.filter((item) => item.status === "DO_NOT_CONTACT" || item.status === "INVALID");
    const allowed = contacts.filter((item) => item.status !== "DO_NOT_CONTACT" && item.status !== "INVALID");
    const missing = ids.filter((id) => !contacts.some((item) => item.id === id));
    await prisma.$transaction(async (tx) => {
      await lockEditableCampaign(tx, userId, id);
      await tx.campaignRecipient.deleteMany({ where: { campaignId: id } });
      if (allowed.length) {
        await tx.campaignRecipient.createMany({
          data: allowed.map((contact) => ({
            campaignId: id,
            contactId: contact.id,
            status: "PENDING" as const,
            snapshotName: contact.fullName ?? contact.name,
            snapshotBrand: contact.brandName ?? contact.companyName,
            snapshotEmail: contact.email,
          })),
          skipDuplicates: true,
        });
      }
      await tx.campaign.update({ where: { id }, data: { status: "DRAFT" } });
    });
    return NextResponse.json({
      selected: allowed.length,
      excluded: excluded.length,
      missing: missing.length,
      message:
        missing.length || excluded.length
          ? "Some contacts were excluded from the recipient list."
          : "Recipients saved.",
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to save recipients." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;

    const campaign = await prisma.campaign.findFirst({
      where: { id, userId },
      include: {
        scheduledJobs: {
          where: { jobType: "INITIAL_EMAIL" },
          orderBy: { runAt: "desc" },
          take: 1,
        },
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    const json = await request.json().catch(() => ({}));

    type InputItem = {
      email?: string;
      brandName?: string;
      productCategory?: string;
      website?: string;
      asin?: string;
      amazonLink?: string;
    };

    let items: InputItem[] = [];
    if (Array.isArray(json.recipients)) {
      items = json.recipients;
    } else if (json.email) {
      items = [
        {
          email: json.email,
          brandName: json.brandName,
          productCategory: json.productCategory,
          website: json.website,
          asin: json.asin,
          amazonLink: json.amazonLink,
        },
      ];
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const validItems: {
      email: string;
      brandName: string;
      productCategory: string;
      website: string | null;
      asin: string | null;
    }[] = [];

    for (const raw of items) {
      const email = String(raw.email || "").trim().toLowerCase();
      if (!email || !emailRegex.test(email)) continue;

      const brandName = String(raw.brandName || "").trim() || email.split("@")[0];
      const productCategory = String(raw.productCategory || "General").trim();
      const asin = String(raw.asin || "").trim() || null;
      const amazonLink = String(raw.amazonLink || "").trim();
      const website = String(raw.website || amazonLink || "").trim() || null;

      validItems.push({
        email,
        brandName,
        productCategory,
        website,
        asin,
      });
    }

    if (validItems.length === 0) {
      return NextResponse.json(
        { error: "Please provide at least one valid email address." },
        { status: 400 }
      );
    }

    // Existing recipients to avoid duplicates
    const existingRecipients = await prisma.campaignRecipient.findMany({
      where: { campaignId: id },
      select: { snapshotEmail: true, contact: { select: { email: true } } },
    });

    const existingEmails = new Set(
      existingRecipients
        .map((r) => (r.snapshotEmail || r.contact?.email || "").toLowerCase().trim())
        .filter(Boolean)
    );

    const maxRow = await prisma.campaignRecipient.aggregate({
      where: { campaignId: id },
      _max: { sheetRowIndex: true },
    });
    let nextIndex = (maxRow._max.sheetRowIndex || existingRecipients.length || 0) + 1;

    let addedCount = 0;
    let skippedCount = 0;
    const addedRecipients: any[] = [];

    for (const item of validItems) {
      if (existingEmails.has(item.email)) {
        skippedCount++;
        continue;
      }

      existingEmails.add(item.email);

      // Upsert contact
      const contact = await prisma.contact.upsert({
        where: {
          userId_email: { userId, email: item.email },
        },
        update: {
          brandName: item.brandName || undefined,
          notes: item.productCategory || undefined,
          website: item.website || undefined,
          formUrl: item.asin || undefined,
        },
        create: {
          userId,
          email: item.email,
          name: item.brandName,
          fullName: item.brandName,
          brandName: item.brandName,
          notes: item.productCategory,
          website: item.website,
          formUrl: item.asin,
          status: "ACTIVE",
        },
      });

      // Create Campaign Recipient
      const recipient = await prisma.campaignRecipient.create({
        data: {
          campaignId: id,
          contactId: contact.id,
          status: "PENDING",
          snapshotName: item.brandName,
          snapshotBrand: item.brandName,
          snapshotEmail: item.email,
          productCategory: item.productCategory,
          sheetRowIndex: nextIndex++,
          sheetSyncStatus: "PENDING",
        },
      });

      // If campaign is actively queued or sending, queue scheduled job for this new recipient
      if (["SENDING", "SCHEDULED", "ACTIVE"].includes(campaign.status)) {
        const lastJob = campaign.scheduledJobs[0];
        const delayMs = 60 * 1000;
        const now = Date.now();
        const baseTime =
          lastJob && lastJob.runAt.getTime() > now
            ? lastJob.runAt.getTime() + (addedCount + 1) * delayMs
            : now + (addedCount + 1) * 2000;

        await prisma.scheduledJob.create({
          data: {
            userId,
            campaignId: id,
            campaignRecipientId: recipient.id,
            jobType: "INITIAL_EMAIL",
            followUpStep: 0,
            runAt: new Date(baseTime),
            timezone: lastJob?.timezone || "Asia/Karachi",
            status: "PENDING",
            deliveryState: "NOT_STARTED",
          },
        });
      }

      addedCount++;
      addedRecipients.push({
        id: recipient.id,
        email: item.email,
        brandName: item.brandName,
        category: item.productCategory,
      });
    }

    if (addedCount > 0 && (campaign.status === "SENDING" || campaign.status === "ACTIVE")) {
      void processDueJobs().catch((err) => console.error("Worker trigger failed:", err));
    }

    return NextResponse.json({
      success: true,
      addedCount,
      skippedCount,
      message:
        addedCount > 0
          ? `Successfully added ${addedCount} email${addedCount > 1 ? "s" : ""} to the campaign.${
              skippedCount > 0 ? ` (${skippedCount} duplicate/invalid skipped)` : ""
            }`
          : "No new emails added (already in this campaign).",
      recipients: addedRecipients,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Add manual recipient error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to add recipient to campaign." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    let recipientId = searchParams.get("recipientId");
    if (!recipientId) {
      const body = await request.json().catch(() => ({}));
      recipientId = body.recipientId;
    }

    if (!recipientId) {
      return NextResponse.json({ error: "recipientId is required." }, { status: 400 });
    }

    const recipient = await prisma.campaignRecipient.findFirst({
      where: { id: recipientId, campaignId: id, campaign: { userId } },
      include: { messages: true },
    });

    if (!recipient) {
      return NextResponse.json({ error: "Recipient not found." }, { status: 404 });
    }

    if (recipient.status === "SENT") {
      return NextResponse.json(
        { error: "Cannot delete a recipient who has already received an email." },
        { status: 400 }
      );
    }

    // Delete pending jobs
    await prisma.scheduledJob.deleteMany({
      where: { campaignRecipientId: recipientId, status: "PENDING" },
    });

    // Delete recipient record
    await prisma.campaignRecipient.delete({
      where: { id: recipientId },
    });

    return NextResponse.json({ success: true, message: "Recipient removed from campaign." });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Delete recipient error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to remove recipient." },
      { status: 500 }
    );
  }
}
