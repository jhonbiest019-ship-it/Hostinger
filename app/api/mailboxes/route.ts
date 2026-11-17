import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, safeErrorMessage } from "@/lib/auth";
import { encryptedPassword, testMailboxConnections } from "@/lib/email/mailbox-service";
import { mailboxSchema } from "@/lib/validation";
import { MailboxStatus, ConnectionStatus } from "@prisma/client";
import { attachVaultToResponse } from "@/lib/vault";
import { exportStoreToVault } from "@/lib/fallback-db";

function publicMailbox(mailbox: {
  id: string;
  userId?: string;
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
}, currentUserId?: string) {
  return {
    ...mailbox,
    lastError: mailbox.lastError || null,
    hasPassword: true,
    isOwner: mailbox.userId ? mailbox.userId === currentUserId : true,
  };
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);

    // 1. User's own mailboxes
    const ownMailboxes = await prisma.mailbox.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
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

    // 2. Also include all other mailboxes connected in this ERP system
    // so all accounts (up to 15 users) have real-time access to verified active senders!
    const ownIds = ownMailboxes.map((m) => m.id);
    const sharedMailboxes = await prisma.mailbox.findMany({
      where: {
        ...(ownIds.length > 0 ? { id: { notIn: ownIds } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        userId: true,
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

    const allMailboxes = [...ownMailboxes, ...sharedMailboxes];
    const response = NextResponse.json({ mailboxes: allMailboxes.map((m) => publicMailbox(m, userId)) });
    attachVaultToResponse(response, exportStoreToVault());
    return response;
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("GET /api/mailboxes error:", error);
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
    const cleanEmail = data.emailAddress.trim().toLowerCase();
    // Hostinger username requires the full email address
    const cleanUsername = data.username.includes("@")
      ? data.username.trim()
      : cleanEmail;
    const cleanSmtpHost = data.smtpHost?.trim() || "smtp.hostinger.com";
    const cleanImapHost = data.imapHost?.trim() || "imap.hostinger.com";

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
        emailAddress: cleanEmail,
        displayName: data.displayName || undefined,
        username: cleanUsername,
        password: data.password,
        smtpHost: cleanSmtpHost,
        smtpPort: data.smtpPort,
        smtpSecurity: data.smtpSecurity,
        imapHost: cleanImapHost,
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
        } else if (testResult.smtp) {
          // SMTP is verified and ready for real-time outreach!
          initialStatus = "ACTIVE";
          initialSmtpStatus = "CONNECTED";
          initialImapStatus = "FAILED";
          initialLastSuccessfulAt = now;
          const imapErr = testResult.imapError ? (testResult.imapError instanceof Error ? testResult.imapError.message : String(testResult.imapError)) : "";
          initialLastError = `SMTP Connected. IMAP notice: ${imapErr || "Check incoming settings"}`;
        } else {
          initialStatus = "ERROR";
          initialSmtpStatus = "FAILED";
          initialImapStatus = testResult.imap ? "CONNECTED" : "FAILED";
          const smtpErr = testResult.smtpError ? (testResult.smtpError instanceof Error ? testResult.smtpError.message : String(testResult.smtpError)) : "";
          const imapErr = testResult.imapError ? (testResult.imapError instanceof Error ? testResult.imapError.message : String(testResult.imapError)) : "";
          const combined = `${smtpErr} ${imapErr}`.toLowerCase();
          if (combined.includes("535") || combined.includes("auth") || combined.includes("password") || combined.includes("credential")) {
            const isHostinger = cleanSmtpHost.includes("hostinger.com");
            initialLastError = isHostinger
              ? `Hostinger Password Rejected (Code 535): Invalid password or username for ${cleanEmail}. Check Hostinger hPanel -> Emails.`
              : `Webmail Authentication Failed: Invalid password or username for ${cleanEmail} on ${cleanSmtpHost}. Please verify your Webmail login credentials.`;
          } else {
            initialLastError = [!testResult.smtp && `SMTP: ${smtpErr || "Failed"}`, !testResult.imap && `IMAP: ${imapErr || "Failed"}`].filter(Boolean).join(" | ");
          }
          if (initialLastError && initialLastError.length > 490) {
            initialLastError = initialLastError.slice(0, 487) + "...";
          }
        }
      }
    } catch {}

    const mailbox = await prisma.mailbox.create({
      data: {
        userId,
        emailAddress: cleanEmail,
        displayName: data.displayName || null,
        username: cleanUsername,
        encryptedCredentials: encryptedPassword(data.password),
        smtpHost: cleanSmtpHost,
        smtpPort: data.smtpPort,
        smtpSecurity: data.smtpSecurity,
        imapHost: cleanImapHost,
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

    const response = NextResponse.json({
      mailbox: publicMailbox(mailbox, userId),
      connectionStatus: initialStatus,
      lastError: initialLastError,
    }, { status: 201 });

    response.cookies.set("active_mailbox_id", mailbox.id, {
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 365,
    });

    attachVaultToResponse(response, exportStoreToVault(mailbox.id));

    return response;
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("POST /api/mailboxes error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Unique constraint") || msg.includes("P2002") || msg.includes("Duplicate entry")) {
      return NextResponse.json({ error: "A mailbox with this email address already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
