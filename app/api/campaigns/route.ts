import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { campaignSchema } from "@/lib/campaign";

function counters(recipients: { status: string }[]) { return { total: recipients.length, pending: recipients.filter((item) => item.status === "PENDING").length, sending: recipients.filter((item) => item.status === "SENDING").length, sent: recipients.filter((item) => item.status === "SENT").length, failed: recipients.filter((item) => item.status === "FAILED").length, skipped: recipients.filter((item) => item.status === "SKIPPED").length }; }
const select = { id: true, name: true, description: true, status: true, sheetUrl: true, sheetWebhookUrl: true, mailbox: { select: { id: true, emailAddress: true, displayName: true, status: true, smtpStatus: true } }, template: { select: { id: true, name: true, subject: true } }, createdAt: true, updatedAt: true, recipients: { select: { status: true } } } as const;

export async function GET(request: NextRequest) { try { const userId = await requireUser(request); const campaigns = await prisma.campaign.findMany({ where: { userId }, select, orderBy: { updatedAt: "desc" } }); return NextResponse.json({ campaigns: campaigns.map((campaign) => ({ ...campaign, counters: counters(campaign.recipients) })) }); } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to load campaigns." }, { status: 500 }); } }

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const parsed = campaignSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid campaign input.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
    const data = parsed.data;

    const now = new Date();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const baseDateName = `Campaign - ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
    let finalName = data.name?.trim();
    if (!finalName) {
      const existingCount = await prisma.campaign.count({
        where: { userId, name: { startsWith: baseDateName } },
      });
      finalName = existingCount > 0 ? `${baseDateName} (#${existingCount + 1})` : baseDateName;
    }

    if (data.mailboxId) {
      const mailbox = await prisma.mailbox.findFirst({ where: { id: data.mailboxId, userId } });
      if (!mailbox) return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
      if (mailbox.status !== "ACTIVE" || mailbox.smtpStatus !== "CONNECTED") return NextResponse.json({ error: "Select a verified mailbox." }, { status: 409 });
    }
    if (data.templateId && !(await prisma.template.findFirst({ where: { id: data.templateId, userId, status: "ACTIVE" }, select: { id: true } }))) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    const campaign = await prisma.campaign.create({ data: { userId, name: finalName, description: data.description || null, mailboxId: data.mailboxId || null, templateId: data.templateId || null }, select: { id: true } });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to create campaign." }, { status: 500 });
  }
}
