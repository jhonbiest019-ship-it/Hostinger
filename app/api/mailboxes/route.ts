import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, safeErrorMessage } from "@/lib/auth";
import { encryptedPassword, testMailboxConnections } from "@/lib/email/mailbox-service";
import { mailboxSchema } from "@/lib/validation";
import { MailboxStatus, ConnectionStatus } from "@prisma/client";

function publicMailbox(mailbox: {
  id: string;
  displayName: string | null;
  emailAddress: string;
  username: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  status: string;
  smtpStatus: string;
  imapStatus: string;
  lastCheckedAt: Date | null;
  lastSuccessfulAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}) {
  return { ...mailbox, lastError: mailbox.lastError || null, hasPassword: true };
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const mailboxes = await prisma.mailbox.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        displayName: true,
        emailAddress: true,
        username: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecurity: true,
        imapHost: true,
        imapPort: true,
        imapSecurity: true,
        status: true,
        smtpStatus: true,
        imapStatus: true,
        lastCheckedAt: true,
        lastSuccessfulAt: true,
        lastError: true,
        createdAt: true,
        encryptedCredentials: false,
      },
    });
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
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid mailbox details.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const data = parsed.data;

    // Real-time connection test on creation
    let initialStatus: MailboxStatus = "PENDING";
    let initialSmtpStatus: ConnectionStatus = "NOT_TESTED";
    let initialImapStatus: ConnectionStatus = "NOT_TESTED";
    let initialLastError: string | null = null;
    let initialLastCheckedAt: Date | null = null;
    let initialLastSuccessfulAt: Date | null = null;

    try {
      const now = new Date();
      const testResult = await testMailboxConnections({
        emailAddress: data.emailAddress,
        displayName: data.displayName || undefined,
        username: data.username,
        password: data.password,
        smtpHost: data.smtpHost,
        smtpPort: data.smtpPort,
        smtpSecurity: data.smtpSecurity,
        imapHost: data.imapHost,
        imapPort: data.imapPort,
        imapSecurity: data.imapSecurity,
      });

      if (!testResult.testMode) {
        initialLastCheckedAt = now;
        if (testResult.smtp && testResult.imap) {
          initialStatus = "ACTIVE";
          initialSmtpStatus = "CONNECTED";
          initialImapStatus = "CONNECTED";
          initialLastSuccessfulAt = now;
        } else {
          initialStatus = "ERROR";
          initialSmtpStatus = testResult.smtp ? "CONNECTED" : "FAILED";
          initialImapStatus = testResult.imap ? "CONNECTED" : "FAILED";
          const smtpErr = testResult.smtpError ? (testResult.smtpError instanceof Error ? testResult.smtpError.message : String(testResult.smtpError)) : "";
          const imapErr = testResult.imapError ? (testResult.imapError instanceof Error ? testResult.imapError.message : String(testResult.imapError)) : "";
          const combined = `${smtpErr} ${imapErr}`.toLowerCase();
          if (combined.includes("535") || combined.includes("auth") || combined.includes("password") || combined.includes("credential")) {
            const isHostinger = data.smtpHost.includes("hostinger.com");
            initialLastError = isHostinger
              ? `Hostinger Password Rejected (Code 535): Invalid password or username for ${data.emailAddress}. Check Hostinger hPanel -> Emails.`
              : `Webmail Authentication Failed: Invalid password or username for ${data.emailAddress} on ${data.smtpHost}. Please verify your Webmail login credentials.`;
          } else {
            initialLastError = [!testResult.smtp && `SMTP: ${smtpErr || "Failed"}`, !testResult.imap && `IMAP: ${imapErr || "Failed"}`].filter(Boolean).join(" | ");
          }
        }
      }
    } catch {}

    const mailbox = await prisma.mailbox.create({
      data: {
        userId,
        emailAddress: data.emailAddress,
        displayName: data.displayName || null,
        username: data.username,
        encryptedCredentials: encryptedPassword(data.password),
        smtpHost: data.smtpHost,
        smtpPort: data.smtpPort,
        smtpSecurity: data.smtpSecurity,
        imapHost: data.imapHost,
        imapPort: data.imapPort,
        imapSecurity: data.imapSecurity,
        status: initialStatus,
        smtpStatus: initialSmtpStatus,
        imapStatus: initialImapStatus,
        lastError: initialLastError,
        lastCheckedAt: initialLastCheckedAt,
        lastSuccessfulAt: initialLastSuccessfulAt,
      },
      select: {
        id: true,
        displayName: true,
        emailAddress: true,
        username: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecurity: true,
        imapHost: true,
        imapPort: true,
        imapSecurity: true,
        status: true,
        smtpStatus: true,
        imapStatus: true,
        lastCheckedAt: true,
        lastSuccessfulAt: true,
        lastError: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      mailbox: publicMailbox(mailbox),
      connectionStatus: initialStatus,
      lastError: initialLastError,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "A mailbox with this email address already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
