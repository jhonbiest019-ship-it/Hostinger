import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, safeErrorMessage } from "@/lib/auth";
import { encryptedPassword } from "@/lib/email/mailbox-service";
import { mailboxSchema } from "@/lib/validation";

function publicMailbox(mailbox: { id: string; displayName: string | null; emailAddress: string; username: string | null; smtpHost: string; smtpPort: number; smtpSecurity: string; imapHost: string; imapPort: number; imapSecurity: string; status: string; smtpStatus: string; imapStatus: string; lastCheckedAt: Date | null; lastSuccessfulAt: Date | null; lastError: string | null; createdAt: Date }) {
  return { ...mailbox, lastError: mailbox.lastError ? "Connection test failed. Review settings and test again." : null, hasPassword: true };
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const mailboxes = await prisma.mailbox.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, displayName: true, emailAddress: true, username: true, smtpHost: true, smtpPort: true, smtpSecurity: true, imapHost: true, imapPort: true, imapSecurity: true, status: true, smtpStatus: true, imapStatus: true, lastCheckedAt: true, lastSuccessfulAt: true, lastError: true, createdAt: true, encryptedCredentials: false } });
    return NextResponse.json({ mailboxes: mailboxes.map(publicMailbox) });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to load mailboxes." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const parsed = mailboxSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid mailbox details.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
    const data = parsed.data;
    const mailbox = await prisma.mailbox.create({ data: { userId, emailAddress: data.emailAddress, displayName: data.displayName || null, username: data.username, encryptedCredentials: encryptedPassword(data.password), smtpHost: data.smtpHost, smtpPort: data.smtpPort, smtpSecurity: data.smtpSecurity, imapHost: data.imapHost, imapPort: data.imapPort, imapSecurity: data.imapSecurity }, select: { id: true, displayName: true, emailAddress: true, username: true, smtpHost: true, smtpPort: true, smtpSecurity: true, imapHost: true, imapPort: true, imapSecurity: true, status: true, smtpStatus: true, imapStatus: true, lastCheckedAt: true, lastSuccessfulAt: true, lastError: true, createdAt: true } });
    return NextResponse.json({ mailbox: publicMailbox(mailbox) }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof Error && error.message.includes("Unique constraint")) return NextResponse.json({ error: "A mailbox with this email address already exists." }, { status: 409 });
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
