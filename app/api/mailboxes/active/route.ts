import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, safeErrorMessage } from "@/lib/auth";
import { attachVaultToResponse } from "@/lib/vault";
import { exportStoreToVault } from "@/lib/fallback-db";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);

    // 1. Check if user has an active_mailbox_id cookie
    const cookieMailboxId = request.cookies.get("active_mailbox_id")?.value?.trim();
    if (cookieMailboxId) {
      const cookieMailbox = await prisma.mailbox.findFirst({
        where: { id: cookieMailboxId },
        select: {
          id: true,
          emailAddress: true,
          displayName: true,
          status: true,
          smtpStatus: true,
          imapStatus: true,
        },
      });
      if (cookieMailbox) {
        const res = NextResponse.json({
          activeMailboxId: cookieMailbox.id,
          mailbox: cookieMailbox,
        });
        attachVaultToResponse(res, exportStoreToVault(cookieMailbox.id));
        return res;
      }
    }

    // 2. Check if there is an active running campaign with a mailbox
    const campaign = await prisma.campaign.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "SCHEDULED", "SENDING"] },
        mailboxId: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      include: {
        mailbox: {
          select: {
            id: true,
            emailAddress: true,
            displayName: true,
            status: true,
            smtpStatus: true,
            imapStatus: true,
          },
        },
      },
    });

    if (campaign?.mailbox) {
      const res = NextResponse.json({
        activeMailboxId: campaign.mailbox.id,
        mailbox: campaign.mailbox,
      });
      attachVaultToResponse(res, exportStoreToVault(campaign.mailbox.id));
      return res;
    }

    // 3. Fallback to user's connected mailbox
    let firstActiveMailbox = await prisma.mailbox.findFirst({
      where: { userId, smtpStatus: "CONNECTED" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        emailAddress: true,
        displayName: true,
        status: true,
        smtpStatus: true,
        imapStatus: true,
      },
    });

    // 4. Fallback to any connected mailbox in this ERP system
    if (!firstActiveMailbox) {
      firstActiveMailbox = await prisma.mailbox.findFirst({
        where: { smtpStatus: "CONNECTED" },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          emailAddress: true,
          displayName: true,
          status: true,
          smtpStatus: true,
          imapStatus: true,
        },
      });
    }

    // 5. Fallback to any active mailbox in system
    if (!firstActiveMailbox) {
      firstActiveMailbox = await prisma.mailbox.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          emailAddress: true,
          displayName: true,
          status: true,
          smtpStatus: true,
          imapStatus: true,
        },
      });
    }

    // 6. Fallback to any mailbox in system
    if (!firstActiveMailbox) {
      firstActiveMailbox = await prisma.mailbox.findFirst({
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          emailAddress: true,
          displayName: true,
          status: true,
          smtpStatus: true,
          imapStatus: true,
        },
      });
    }

    const response = NextResponse.json({
      activeMailboxId: firstActiveMailbox?.id || null,
      mailbox: firstActiveMailbox || null,
    });

    if (firstActiveMailbox?.id) {
      response.cookies.set("active_mailbox_id", firstActiveMailbox.id, {
        path: "/",
        sameSite: "lax",
        httpOnly: false,
        maxAge: 60 * 60 * 24 * 365,
      });
      attachVaultToResponse(response, exportStoreToVault(firstActiveMailbox.id));
    }

    return response;
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const mailboxId = typeof body.mailboxId === "string" ? body.mailboxId.trim() : "";

    if (!mailboxId) {
      return NextResponse.json({ error: "mailboxId is required." }, { status: 400 });
    }

    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId },
      select: {
        id: true,
        emailAddress: true,
        displayName: true,
        status: true,
        smtpStatus: true,
        imapStatus: true,
        encryptedCredentials: true,
      },
    });

    if (!mailbox) {
      return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
    }

    // If mailbox has credentials, ensure it is active
    if (mailbox.status !== "ACTIVE" && mailbox.encryptedCredentials) {
      await prisma.mailbox.update({
        where: { id: mailbox.id },
        data: { status: "ACTIVE", smtpStatus: "CONNECTED" },
      });
      mailbox.status = "ACTIVE";
      mailbox.smtpStatus = "CONNECTED";
    }

    // Update all relevant draft/paused campaigns for this user to use this mailbox
    await prisma.campaign.updateMany({
      where: {
        userId,
        status: { in: ["PAUSED", "SCHEDULED", "SENDING", "ACTIVE", "DRAFT", "READY"] },
      },
      data: {
        mailboxId: mailbox.id,
        updatedAt: new Date(),
      },
    });

    const res = NextResponse.json({
      success: true,
      activeMailboxId: mailbox.id,
      mailbox,
      message: `Active mailbox successfully set to ${mailbox.displayName ? `[${mailbox.displayName}] ` : ""}${mailbox.emailAddress}.`,
    });

    res.cookies.set("active_mailbox_id", mailbox.id, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: false,
    });

    attachVaultToResponse(res, exportStoreToVault(mailbox.id));
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
