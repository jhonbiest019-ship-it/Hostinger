import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, safeErrorMessage } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);

    // 1. Check if user has an active_mailbox_id cookie
    const cookieMailboxId = request.cookies.get("active_mailbox_id")?.value?.trim();
    if (cookieMailboxId) {
      const cookieMailbox = await prisma.mailbox.findFirst({
        where: { id: cookieMailboxId, userId, status: "ACTIVE" },
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
        return NextResponse.json({
          activeMailboxId: cookieMailbox.id,
          mailbox: cookieMailbox,
        });
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

    if (campaign?.mailbox && campaign.mailbox.status === "ACTIVE" && campaign.mailbox.smtpStatus === "CONNECTED") {
      return NextResponse.json({
        activeMailboxId: campaign.mailbox.id,
        mailbox: campaign.mailbox,
      });
    }

    // 3. Fallback to first active and connected mailbox
    const firstActiveMailbox = await prisma.mailbox.findFirst({
      where: { userId, status: "ACTIVE", smtpStatus: "CONNECTED" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        emailAddress: true,
        displayName: true,
        status: true,
        smtpStatus: true,
        imapStatus: true,
      },
    });

    return NextResponse.json({
      activeMailboxId: firstActiveMailbox?.id || null,
      mailbox: firstActiveMailbox || null,
    });
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
      where: { id: mailboxId, userId },
      select: {
        id: true,
        emailAddress: true,
        displayName: true,
        status: true,
        smtpStatus: true,
        imapStatus: true,
      },
    });

    if (!mailbox) {
      return NextResponse.json({ error: "Mailbox not found or unauthorized." }, { status: 404 });
    }

    if (mailbox.status !== "ACTIVE" || mailbox.smtpStatus !== "CONNECTED") {
      return NextResponse.json(
        { error: `Mailbox ${mailbox.emailAddress} is not verified. Please test SMTP connection first.` },
        { status: 400 }
      );
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

    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
