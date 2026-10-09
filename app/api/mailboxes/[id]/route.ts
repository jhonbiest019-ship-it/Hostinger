import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, safeErrorMessage } from "@/lib/auth";
import { encryptedPassword } from "@/lib/email/mailbox-service";
import { mailboxUpdateSchema } from "@/lib/validation";

const select = { id: true, displayName: true, emailAddress: true, username: true, smtpHost: true, smtpPort: true, smtpSecurity: true, imapHost: true, imapPort: true, imapSecurity: true, status: true, smtpStatus: true, imapStatus: true, lastCheckedAt: true, lastSuccessfulAt: true, lastError: true, createdAt: true } as const;
function publicMailbox(mailbox: Record<string, unknown>) { return { ...mailbox, lastError: mailbox.lastError ? "Connection test failed. Review settings and test again." : null, hasPassword: true }; }

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const userId = await requireUser(request); const { id } = await context.params; const mailbox = await prisma.mailbox.findFirst({ where: { id, userId }, select }); if (!mailbox) return NextResponse.json({ error: "Mailbox not found." }, { status: 404 }); return NextResponse.json({ mailbox: publicMailbox(mailbox) }); }
  catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to load mailbox." }, { status: 500 }); }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request); const { id } = await context.params;
    const existing = await prisma.mailbox.findFirst({ where: { id, userId }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
    const parsed = mailboxUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid mailbox details.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
    const data = parsed.data;
    const mailbox = await prisma.mailbox.update({ where: { id }, data: { emailAddress: data.emailAddress, displayName: data.displayName || null, username: data.username, ...(data.password ? { encryptedCredentials: encryptedPassword(data.password) } : {}), smtpHost: data.smtpHost, smtpPort: data.smtpPort, smtpSecurity: data.smtpSecurity, imapHost: data.imapHost, imapPort: data.imapPort, imapSecurity: data.imapSecurity, status: "PENDING", smtpStatus: "NOT_TESTED", imapStatus: "NOT_TESTED", lastError: null }, select });
    return NextResponse.json({ mailbox: publicMailbox(mailbox) });
  } catch (error) { if (error instanceof Response) return error; if (error instanceof Error && error.message.includes("Unique constraint")) return NextResponse.json({ error: "A mailbox with this email address already exists." }, { status: 409 }); return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 }); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const userId = await requireUser(request); const { id } = await context.params; const result = await prisma.mailbox.deleteMany({ where: { id, userId } }); if (!result.count) return NextResponse.json({ error: "Mailbox not found." }, { status: 404 }); return NextResponse.json({ success: true }); }
  catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to disconnect mailbox." }, { status: 500 }); }
}
