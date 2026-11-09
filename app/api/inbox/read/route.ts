import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const { id, ids, read = true, all = false, mailboxId } = body;

    // Verify mailbox ownership if mailboxId is provided
    let verifiedMailboxId: string | undefined = undefined;
    if (typeof mailboxId === "string" && mailboxId.trim()) {
      const verified = await prisma.mailbox.findFirst({
        where: { id: mailboxId.trim(), userId },
        select: { id: true },
      });
      if (verified) verifiedMailboxId = verified.id;
    }

    const notTrashFilter = {
      OR: [
        { errorMessage: null },
        { errorMessage: { not: "TRASH" } },
      ],
    };

    if (all) {
      // Mark all unread inbound messages as READ for this specific mailbox
      const unread = await prisma.emailMessage.findMany({
        where: {
          userId,
          ...(verifiedMailboxId ? { mailboxId: verifiedMailboxId } : {}),
          direction: "INBOUND",
          ...notTrashFilter,
          OR: [
            { references: null },
            { NOT: { references: { contains: "READ" } } },
          ],
        },
        select: { id: true, references: true },
      });

      for (const msg of unread) {
        const current = msg.references || "";
        await prisma.emailMessage.update({
          where: { id: msg.id },
          data: { references: current ? `${current} READ` : "READ" },
        });
      }
    } else {
      const targetIds: string[] = Array.isArray(ids) ? ids : id ? [id] : [];

      for (const targetId of targetIds) {
        const msg = await prisma.emailMessage.findFirst({
          where: {
            id: targetId,
            userId,
            ...(verifiedMailboxId ? { mailboxId: verifiedMailboxId } : {}),
          },
          select: { id: true, references: true },
        });

        if (msg) {
          const current = msg.references || "";
          if (read) {
            if (!current.includes("READ")) {
              await prisma.emailMessage.update({
                where: { id: msg.id },
                data: { references: current ? `${current} READ` : "READ" },
              });
            }
          } else {
            // Mark as UNREAD
            if (current.includes("READ")) {
              const cleaned = current.replace(/\bREAD\b/g, "").replace(/\s+/g, " ").trim() || null;
              await prisma.emailMessage.update({
                where: { id: msg.id },
                data: { references: cleaned },
              });
            }
          }
        }
      }
    }

    // Return fresh real-time counts strictly scoped to this mailbox
    const unreadFilter = {
      OR: [
        { references: null },
        { NOT: { references: { contains: "READ" } } },
      ],
    };

    const [inboxUnreadCount, sentCount, scheduledCount, draftMessagesCount, trashCount] =
      await Promise.all([
        // Real-time UNREAD Inbound count
        prisma.emailMessage.count({
          where: {
            userId,
            ...(verifiedMailboxId ? { mailboxId: verifiedMailboxId } : {}),
            direction: "INBOUND",
            ...notTrashFilter,
            AND: [unreadFilter],
          },
        }),
        // Real-time Sent count
        prisma.emailMessage.count({
          where: {
            userId,
            ...(verifiedMailboxId ? { mailboxId: verifiedMailboxId } : {}),
            direction: "OUTBOUND",
            status: "SENT",
            ...notTrashFilter,
          },
        }),
        // Real-time Scheduled jobs count
        prisma.scheduledJob.count({
          where: {
            userId,
            status: { in: ["PENDING", "PROCESSING"] },
            ...(verifiedMailboxId
              ? {
                  OR: [
                    { campaign: { mailboxId: verifiedMailboxId } },
                    { message: { mailboxId: verifiedMailboxId } },
                  ],
                }
              : {}),
          },
        }),
        prisma.emailMessage.count({
          where: {
            userId,
            ...(verifiedMailboxId ? { mailboxId: verifiedMailboxId } : {}),
            direction: "OUTBOUND",
            status: "PENDING",
            ...notTrashFilter,
          },
        }),
        // Real-time Trash count
        prisma.emailMessage.count({
          where: {
            userId,
            ...(verifiedMailboxId ? { mailboxId: verifiedMailboxId } : {}),
            errorMessage: "TRASH",
          },
        }),
      ]);

    const counts = {
      inbox: inboxUnreadCount,
      sent: sentCount,
      scheduled: scheduledCount,
      drafts: draftMessagesCount,
      spam: 0,
      trash: trashCount,
    };

    return NextResponse.json({ success: true, counts });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to update read status." }, { status: 500 });
  }
}
