import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, safeErrorMessage } from "@/lib/auth";
import { encryptedPassword, passwordFromMailbox, testMailboxConnections } from "@/lib/email/mailbox-service";
import { mailboxUpdateSchema } from "@/lib/validation";
import { MailboxStatus, ConnectionStatus } from "@prisma/client";

const select = { id: true, displayName: true, emailAddress: true, username: true, smtpHost: true, smtpPort: true, smtpSecurity: true, imapHost: true, imapPort: true, imapSecurity: true, status: true, smtpStatus: true, imapStatus: true, lastCheckedAt: true, lastSuccessfulAt: true, lastError: true, createdAt: true } as const;
function publicMailbox(mailbox: Record<string, unknown>) { return { ...mailbox, lastError: mailbox.lastError || null, hasPassword: true }; }

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const userId = await requireUser(request); const { id } = await context.params; const mailbox = await prisma.mailbox.findFirst({ where: { id, userId }, select }); if (!mailbox) return NextResponse.json({ error: "Mailbox not found." }, { status: 404 }); return NextResponse.json({ mailbox: publicMailbox(mailbox) }); }
  catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to load mailbox." }, { status: 500 }); }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request); const { id } = await context.params;
    const existing = await prisma.mailbox.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
    const parsed = mailboxUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid mailbox details.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
    const rawData = parsed.data;
    const cleanEmail = rawData.emailAddress.trim().toLowerCase();
    const cleanUsername = rawData.username.includes("@") ? rawData.username.trim() : cleanEmail;
    const cleanSmtpHost = rawData.smtpHost?.trim() || "smtp.hostinger.com";
    const cleanImapHost = rawData.imapHost?.trim() || "imap.hostinger.com";

    const data = {
      ...rawData,
      emailAddress: cleanEmail,
      username: cleanUsername,
      smtpHost: cleanSmtpHost,
      imapHost: cleanImapHost,
    };

    const credsChanged =
      Boolean(data.password) ||
      data.emailAddress !== existing.emailAddress ||
      data.username !== existing.username ||
      data.smtpHost !== existing.smtpHost ||
      data.smtpPort !== existing.smtpPort ||
      data.imapHost !== existing.imapHost ||
      data.imapPort !== existing.imapPort;

    let newStatus: MailboxStatus = credsChanged ? "PENDING" : existing.status;
    let newSmtpStatus: ConnectionStatus = credsChanged ? "NOT_TESTED" : existing.smtpStatus;
    let newImapStatus: ConnectionStatus = credsChanged ? "NOT_TESTED" : existing.imapStatus;
    let newLastError = credsChanged ? null : existing.lastError;
    let newLastCheckedAt = existing.lastCheckedAt;
    let newLastSuccessfulAt = existing.lastSuccessfulAt;

    if (credsChanged) {
      let pwd = data.password;
      if (!pwd && existing.encryptedCredentials) {
        try {
          pwd = passwordFromMailbox(existing.encryptedCredentials);
        } catch {}
      }

      if (pwd) {
        try {
          const now = new Date();
          const testResult = await testMailboxConnections({
            emailAddress: data.emailAddress,
            displayName: data.displayName || undefined,
            username: data.username,
            password: pwd,
            smtpHost: data.smtpHost,
            smtpPort: data.smtpPort,
            smtpSecurity: data.smtpSecurity,
            imapHost: data.imapHost,
            imapPort: data.imapPort,
            imapSecurity: data.imapSecurity,
          });

          if (!testResult.testMode) {
            newLastCheckedAt = now;
            if (testResult.smtp && testResult.imap) {
              newStatus = "ACTIVE";
              newSmtpStatus = "CONNECTED";
              newImapStatus = "CONNECTED";
              newLastSuccessfulAt = now;
              newLastError = null;
            } else {
              newStatus = "ERROR";
              newSmtpStatus = testResult.smtp ? "CONNECTED" : "FAILED";
              newImapStatus = testResult.imap ? "CONNECTED" : "FAILED";
              const smtpErr = testResult.smtpError ? (testResult.smtpError instanceof Error ? testResult.smtpError.message : String(testResult.smtpError)) : "";
              const imapErr = testResult.imapError ? (testResult.imapError instanceof Error ? testResult.imapError.message : String(testResult.imapError)) : "";
              const combined = `${smtpErr} ${imapErr}`.toLowerCase();
              if (combined.includes("535") || combined.includes("auth") || combined.includes("password") || combined.includes("credential")) {
                newLastError = `Hostinger Password Rejected (Code 535): Invalid password or username for ${data.emailAddress}. Check Hostinger hPanel -> Emails.`;
              } else {
                newLastError = [!testResult.smtp && `SMTP: ${smtpErr || "Failed"}`, !testResult.imap && `IMAP: ${imapErr || "Failed"}`].filter(Boolean).join(" | ");
              }
            }
          }
        } catch {}
      }
    }

    const mailbox = await prisma.mailbox.update({
      where: { id },
      data: {
        emailAddress: data.emailAddress,
        displayName: data.displayName || null,
        username: data.username,
        ...(data.password ? { encryptedCredentials: encryptedPassword(data.password) } : {}),
        smtpHost: data.smtpHost,
        smtpPort: data.smtpPort,
        smtpSecurity: data.smtpSecurity,
        imapHost: data.imapHost,
        imapPort: data.imapPort,
        imapSecurity: data.imapSecurity,
        status: newStatus,
        smtpStatus: newSmtpStatus,
        imapStatus: newImapStatus,
        lastError: newLastError,
        lastCheckedAt: newLastCheckedAt,
        lastSuccessfulAt: newLastSuccessfulAt,
      },
      select,
    });
    return NextResponse.json({
      mailbox: publicMailbox(mailbox),
      connectionStatus: newStatus,
      lastError: newLastError,
    });
  } catch (error) { if (error instanceof Response) return error; if (error instanceof Error && error.message.includes("Unique constraint")) return NextResponse.json({ error: "A mailbox with this email address already exists." }, { status: 409 }); return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 }); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const userId = await requireUser(request); const { id } = await context.params; const result = await prisma.mailbox.deleteMany({ where: { id, userId } }); if (!result.count) return NextResponse.json({ error: "Mailbox not found." }, { status: 404 }); return NextResponse.json({ success: true }); }
  catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to disconnect mailbox." }, { status: 500 }); }
}
