import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const folder = request.nextUrl.searchParams.get("folder") || "inbox";
    const search = request.nextUrl.searchParams.get("search")?.trim() || "";
    const mailboxId = request.nextUrl.searchParams.get("mailboxId")?.trim() || "";

    // Task 3: If no mailbox is selected, return an empty state. Never mix or show messages across all mailboxes.
    if (!mailboxId) {
      return NextResponse.json({
        messages: [],
        counts: {
          inbox: 0,
          sent: 0,
          scheduled: 0,
          drafts: 0,
          spam: 0,
          trash: 0,
        },
        activeMailbox: null,
        requiresMailboxSelection: true,
      });
    }

    // Task 3: Strict mailbox authorization check. Verify mailbox ownership by authenticated user.
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, userId },
      select: {
        id: true,
        emailAddress: true,
        displayName: true,
        status: true,
        smtpStatus: true,
      },
    });

    if (!mailbox) {
      return NextResponse.json(
        { error: "Selected mailbox not found or unauthorized." },
        { status: 403 }
      );
    }

    const notTrashFilter = {
      OR: [
        { errorMessage: null },
        { errorMessage: { not: "TRASH" } },
      ],
    };

    const unreadFilter = {
      OR: [
        { references: null },
        { NOT: { references: { contains: "READ" } } },
      ],
    };

    const searchFilter = search
      ? {
          OR: [
            { subject: { contains: search } },
            { fromAddress: { contains: search } },
            { toAddress: { contains: search } },
            { body: { contains: search } },
          ],
        }
      : {};

    let folderFilter: any = {};

    if (folder === "sent") {
      folderFilter = { direction: "OUTBOUND", status: "SENT", ...notTrashFilter };
    } else if (folder === "scheduled") {
      folderFilter = { status: "SCHEDULED", ...notTrashFilter };
    } else if (folder === "drafts") {
      folderFilter = { direction: "OUTBOUND", status: "PENDING", ...notTrashFilter };
    } else if (folder === "trash") {
      folderFilter = { errorMessage: "TRASH" };
    } else if (folder === "spam") {
      folderFilter = { id: "__none__" };
    } else {
      // Inbox
      folderFilter = { direction: "INBOUND", ...notTrashFilter };
    }

    // Strict mailbox scoping on every single message query
    const where: any = {
      userId,
      mailboxId: mailbox.id,
      AND: [folderFilter, ...(search ? [searchFilter] : [])],
    };

    const [
      dbMessages,
      inboxUnreadCount,
      sentCount,
      scheduledCount,
      draftMessagesCount,
      trashCount,
    ] = await Promise.all([
      prisma.emailMessage.findMany({
        where,
        include: {
          mailbox: { select: { emailAddress: true } },
          campaign: { select: { id: true, name: true } },
          contact: { select: { name: true, fullName: true, email: true } },
        },
        orderBy: folder === "inbox" ? { receivedAt: "desc" } : { createdAt: "desc" },
        take: 50,
      }),
      // Real-time UNREAD Inbound count for this specific mailbox
      prisma.emailMessage.count({
        where: {
          userId,
          mailboxId: mailbox.id,
          direction: "INBOUND",
          ...notTrashFilter,
          AND: [unreadFilter],
        },
      }),
      // Real-time Sent count for this specific mailbox
      prisma.emailMessage.count({
        where: {
          userId,
          mailboxId: mailbox.id,
          direction: "OUTBOUND",
          status: "SENT",
          ...notTrashFilter,
        },
      }),
      // Real-time Scheduled jobs count for this specific mailbox
      prisma.scheduledJob.count({
        where: {
          userId,
          status: { in: ["PENDING", "PROCESSING"] },
          OR: [
            { campaign: { mailboxId: mailbox.id } },
            { message: { mailboxId: mailbox.id } },
          ],
        },
      }),
      // Real-time Drafts count for this specific mailbox
      prisma.emailMessage.count({
        where: {
          userId,
          mailboxId: mailbox.id,
          direction: "OUTBOUND",
          status: "PENDING",
          ...notTrashFilter,
        },
      }),
      // Real-time Trash count for this specific mailbox
      prisma.emailMessage.count({
        where: {
          userId,
          mailboxId: mailbox.id,
          errorMessage: "TRASH",
        },
      }),
    ]);

    // Format messages with isRead flag
    const formattedDbMessages = dbMessages.map((m) => ({
      ...m,
      isRead: Boolean(m.references && m.references.includes("READ")),
    }));

    return NextResponse.json({
      messages: formattedDbMessages,
      activeMailbox: mailbox,
      counts: {
        inbox: inboxUnreadCount,
        sent: sentCount,
        scheduled: scheduledCount,
        drafts: draftMessagesCount,
        spam: 0,
        trash: trashCount,
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to load inbox." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const body = await request.json();
    const { mailboxId, toAddress, subject, body: messageBody, draftId } = body;

    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, userId },
      select: { id: true, emailAddress: true },
    });

    if (!mailbox) {
      return NextResponse.json({ error: "Sender mailbox not found." }, { status: 404 });
    }

    if (draftId) {
      await prisma.emailMessage.updateMany({
        where: { id: draftId, userId },
        data: {
          mailboxId: mailbox.id,
          toAddress: toAddress || "",
          fromAddress: mailbox.emailAddress,
          subject: subject || "(No Subject)",
          body: messageBody || "",
          status: "PENDING",
          direction: "OUTBOUND",
          errorMessage: null,
        },
      });
      return NextResponse.json({ success: true, draftId });
    }

    const draft = await prisma.emailMessage.create({
      data: {
        userId,
        mailboxId: mailbox.id,
        toAddress: toAddress || "",
        fromAddress: mailbox.emailAddress,
        subject: subject || "(No Subject)",
        body: messageBody || "",
        status: "PENDING",
        direction: "OUTBOUND",
        errorMessage: null,
      },
    });

    return NextResponse.json({ success: true, draftId: draft.id });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to save draft." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const { id, permanent, mailboxId } = body;

    if (!id) return NextResponse.json({ error: "Message id required." }, { status: 400 });

    // Handle draft campaign deletion directly
    if (typeof id === "string" && id.startsWith("draft-campaign-")) {
      const realCampaignId = id.replace("draft-campaign-", "");
      await prisma.campaign.deleteMany({
        where: { id: realCampaignId, userId },
      });
      return NextResponse.json({ success: true, action: "draft_campaign_deleted" });
    }

    // Empty trash scoped to specific active mailbox if mailboxId provided
    if (id === "__all_trash__") {
      let verifiedMailboxId: string | undefined = undefined;
      if (mailboxId) {
        const verified = await prisma.mailbox.findFirst({
          where: { id: mailboxId, userId },
          select: { id: true },
        });
        if (verified) verifiedMailboxId = verified.id;
      }

      const deleted = await prisma.emailMessage.deleteMany({
        where: {
          userId,
          ...(verifiedMailboxId ? { mailboxId: verifiedMailboxId } : {}),
          errorMessage: "TRASH",
        },
      });
      return NextResponse.json({ success: true, count: deleted.count });
    }

    const existing = await prisma.emailMessage.findFirst({
      where: { id, userId },
      select: { id: true, errorMessage: true },
    });

    if (!existing) return NextResponse.json({ error: "Message not found." }, { status: 404 });

    if (permanent || existing.errorMessage === "TRASH") {
      // Already in trash or permanently requested: remove from database
      await prisma.emailMessage.deleteMany({
        where: { id, userId },
      });
      return NextResponse.json({ success: true, action: "deleted_permanently" });
    } else {
      // Move to Trash
      await prisma.emailMessage.updateMany({
        where: { id, userId },
        data: { errorMessage: "TRASH" },
      });
      return NextResponse.json({ success: true, action: "moved_to_trash" });
    }
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to delete message." }, { status: 500 });
  }
}
