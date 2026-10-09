import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { scheduleSchema, localDateTimeToUtc, isValidTimezone } from "@/lib/schedule";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request); const { id } = await context.params; const parsed = scheduleSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Choose Send Now or provide a valid date, time, and timezone." }, { status: 400 });
    const campaign = await prisma.campaign.findFirst({ where: { id, userId }, include: { mailbox: { select: { id: true, status: true, smtpStatus: true } }, template: { select: { id: true, status: true } }, recipients: { include: { contact: { select: { id: true, userId: true, email: true, status: true } } } } } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    if (!["READY", "SCHEDULED", "SENDING"].includes(campaign.status)) return NextResponse.json({ error: "Campaign must be READY before queueing emails." }, { status: 409 });
    if (!campaign.mailbox || campaign.mailbox.status !== "ACTIVE" || campaign.mailbox.smtpStatus !== "CONNECTED") return NextResponse.json({ error: "A verified mailbox is required." }, { status: 409 });
    if (!campaign.template || campaign.template.status !== "ACTIVE") return NextResponse.json({ error: "An active template is required." }, { status: 409 });
    const validRecipients = campaign.recipients.filter((item) => item.contact.userId === userId && item.contact.status !== "DO_NOT_CONTACT" && item.contact.status !== "INVALID" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.contact.email) && item.status !== "SENT");
    if (!validRecipients.length) return NextResponse.json({ error: "No valid pending recipients are available." }, { status: 409 });
    const existingJobs = await prisma.scheduledJob.findMany({ where: { campaignId: id, campaignRecipientId: { in: validRecipients.map((item) => item.id) }, status: { in: ["PENDING", "PROCESSING"] } }, select: { campaignRecipientId: true } });
    const inFlight = new Set(existingJobs.map((job) => job.campaignRecipientId)); const recipientsToQueue = validRecipients.filter((item) => !inFlight.has(item.id));
    if (!recipientsToQueue.length) return NextResponse.json({ error: "This campaign already has pending jobs." }, { status: 409 });
    let runAt: Date; let timezone = "UTC";
    if (parsed.data.mode === "sendNow") runAt = new Date(Date.now() + 1000);
    else { timezone = parsed.data.timezone; if (!isValidTimezone(timezone)) return NextResponse.json({ error: "Invalid timezone." }, { status: 400 }); try { runAt = localDateTimeToUtc(parsed.data.date, parsed.data.time, timezone); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid scheduled time." }, { status: 400 }); } if (runAt.getTime() <= Date.now()) return NextResponse.json({ error: "Scheduled time must be in the future." }, { status: 400 }); }
    await prisma.$transaction([prisma.scheduledJob.createMany({ data: recipientsToQueue.map((item) => ({ userId, campaignId: id, campaignRecipientId: item.id, jobType: "INITIAL_EMAIL" as const, followUpStep: 0, runAt, timezone, status: "PENDING" as const })) }), prisma.campaignRecipient.updateMany({ where: { id: { in: recipientsToQueue.map((item) => item.id) }, campaignId: id }, data: { status: "PENDING" } }), prisma.campaign.update({ where: { id }, data: { status: parsed.data.mode === "sendNow" ? "SENDING" : "SCHEDULED" } })]);
    return NextResponse.json({ success: true, queued: recipientsToQueue.length, runAt: runAt.toISOString(), timezone });
  } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to queue campaign." }, { status: 500 }); }
}
