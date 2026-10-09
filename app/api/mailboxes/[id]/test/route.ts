import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, safeErrorMessage } from "@/lib/auth";
import { connectionRateLimit } from "@/lib/rate-limit";
import { passwordFromMailbox, testMailboxConnections } from "@/lib/email/mailbox-service";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let userId = "";
  try {
    userId = await requireUser(request);
    const { id } = await context.params;
    if (!connectionRateLimit(`${userId}:${id}`)) return NextResponse.json({ error: "Too many connection attempts. Please wait a minute and try again." }, { status: 429 });
    const mailbox = await prisma.mailbox.findFirst({ where: { id, userId } });
    if (!mailbox || !mailbox.encryptedCredentials || !mailbox.username) return NextResponse.json({ error: "Mailbox credentials are not configured." }, { status: 400 });
    const password = passwordFromMailbox(mailbox.encryptedCredentials);
    const result = await testMailboxConnections({ emailAddress: mailbox.emailAddress, displayName: mailbox.displayName ?? undefined, username: mailbox.username, password, smtpHost: mailbox.smtpHost, smtpPort: mailbox.smtpPort, smtpSecurity: mailbox.smtpSecurity, imapHost: mailbox.imapHost, imapPort: mailbox.imapPort, imapSecurity: mailbox.imapSecurity });
    const now = new Date();
    const overall = result.smtp && result.imap ? "ACTIVE" : "ERROR";
    const lastError = [!result.smtp && "SMTP_FAILED", !result.imap && "IMAP_FAILED"].filter(Boolean).join(", ") || null;
    await prisma.mailbox.update({ where: { id: mailbox.id }, data: { status: overall, smtpStatus: result.smtp ? "CONNECTED" : "FAILED", imapStatus: result.imap ? "CONNECTED" : "FAILED", lastCheckedAt: now, lastSuccessfulAt: result.smtp && result.imap ? now : mailbox.lastSuccessfulAt, lastError } });
    console.info("mailbox_connection_test", { mailboxId: id, userId, operation: "smtp+imap_verify", timestamp: now.toISOString(), success: result.smtp && result.imap, errorCategory: lastError });
    return NextResponse.json({ success: result.smtp && result.imap, smtp: result.smtp ? "Connected" : "Failed", imap: result.imap ? "Connected" : "Failed", message: result.smtp && result.imap ? "SMTP and IMAP connections verified." : "Connection test completed with failures." });
  } catch (error) {
    if (error instanceof Response) return error;
    const safeMessage = safeErrorMessage(error);
    console.info("mailbox_connection_test", { mailboxId: (await context.params).id, userId, operation: "smtp+imap_verify", timestamp: new Date().toISOString(), success: false, errorCategory: safeMessage });
    return NextResponse.json({ success: false, error: safeMessage }, { status: 502 });
  }
}
