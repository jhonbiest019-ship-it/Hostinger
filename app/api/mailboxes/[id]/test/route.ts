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
    if (!mailbox) return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
    if (!mailbox.encryptedCredentials || !mailbox.username) return NextResponse.json({ error: "Mailbox credentials are not configured." }, { status: 400 });
    const password = passwordFromMailbox(mailbox.encryptedCredentials);
    const result = await testMailboxConnections({ emailAddress: mailbox.emailAddress, displayName: mailbox.displayName ?? undefined, username: mailbox.username, password, smtpHost: mailbox.smtpHost, smtpPort: mailbox.smtpPort, smtpSecurity: mailbox.smtpSecurity, imapHost: mailbox.imapHost, imapPort: mailbox.imapPort, imapSecurity: mailbox.imapSecurity });
    if (result.testMode) return NextResponse.json({ success: false, testMode: true, smtp: "Not tested", imap: "Not tested", message: "EMAIL_TEST_MODE is enabled; no SMTP or IMAP network connection was attempted." });
    const now = new Date();
    const overall = result.smtp && result.imap ? "ACTIVE" : "ERROR";

    let lastError: string | null = null;
    if (!result.smtp || !result.imap) {
      const smtpErr = result.smtpError ? (result.smtpError instanceof Error ? result.smtpError.message : String(result.smtpError)) : "";
      const imapErr = result.imapError ? (result.imapError instanceof Error ? result.imapError.message : String(result.imapError)) : "";
      const combined = `${smtpErr} ${imapErr}`.toLowerCase();

      if (combined.includes("535") || combined.includes("auth") || combined.includes("password") || combined.includes("credential")) {
        const isHostinger = mailbox.smtpHost.includes("hostinger.com");
        lastError = isHostinger
          ? `Hostinger Password Rejected (Code 535): Invalid password or username for ${mailbox.emailAddress}. Check Hostinger hPanel -> Emails.`
          : `Webmail Authentication Failed: Invalid password or username for ${mailbox.emailAddress} on ${mailbox.smtpHost}. Please verify your Webmail login credentials.`;
      } else if (combined.includes("timeout") || combined.includes("timed out")) {
        lastError = `Connection Timed Out: Unable to reach ${mailbox.smtpHost}:${mailbox.smtpPort}. Check host and network.`;
      } else {
        lastError = [!result.smtp && `SMTP: ${smtpErr || "Failed"}`, !result.imap && `IMAP: ${imapErr || "Failed"}`].filter(Boolean).join(" | ");
      }
    }

    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        status: overall,
        smtpStatus: result.smtp ? "CONNECTED" : "FAILED",
        imapStatus: result.imap ? "CONNECTED" : "FAILED",
        lastCheckedAt: now,
        lastSuccessfulAt: result.smtp && result.imap ? now : mailbox.lastSuccessfulAt,
        lastError,
      },
    });

    console.info("mailbox_connection_test", { mailboxId: id, userId, operation: "smtp+imap_verify", timestamp: now.toISOString(), success: result.smtp && result.imap, errorCategory: lastError });
    return NextResponse.json({
      success: result.smtp && result.imap,
      smtp: result.smtp ? "Connected" : "Failed",
      imap: result.imap ? "Connected" : "Failed",
      smtpError: result.smtpError ? safeErrorMessage(result.smtpError) : null,
      imapError: result.imapError ? safeErrorMessage(result.imapError) : null,
      lastError,
      message: result.smtp && result.imap
        ? "SMTP and IMAP connections verified."
        : (lastError || "Connection test completed with failures."),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const safeMessage = safeErrorMessage(error);
    console.info("mailbox_connection_test", { mailboxId: (await context.params).id, userId, operation: "smtp+imap_verify", timestamp: new Date().toISOString(), success: false, errorCategory: safeMessage });
    return NextResponse.json({ success: false, error: safeMessage }, { status: 502 });
  }
}
