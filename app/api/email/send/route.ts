import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, safeErrorMessage } from "@/lib/auth";
import { connectionRateLimit } from "@/lib/rate-limit";
import { sendFromMailbox } from "@/lib/email/send-service";
import { renderTemplate } from "@/lib/email/template";
import { sendSchema } from "@/lib/email/message-validation";

export async function POST(request: NextRequest) {
  let userId = "";
  try {
    userId = await requireUser(request);
    const bodyJson = await request.json();
    const parsed = sendSchema.safeParse(bodyJson);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Provide a valid mailbox, recipient email, subject, and message body." },
        { status: 400 }
      );
    }

    const input = parsed.data;

    // Rate-limit check per mailbox
    if (!connectionRateLimit(`manual-send:${userId}:${input.mailboxId}`)) {
      return NextResponse.json(
        { error: "Too many send attempts. Please wait a moment before sending again." },
        { status: 429 }
      );
    }

    // 1. Fetch Mailbox
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: input.mailboxId, userId },
    });

    if (!mailbox) {
      return NextResponse.json({ error: "Sender mailbox not found." }, { status: 404 });
    }
    if (mailbox.status !== "ACTIVE" || mailbox.smtpStatus !== "CONNECTED") {
      return NextResponse.json(
        { error: "Please verify this mailbox connection before sending." },
        { status: 409 }
      );
    }

    // 2. Fetch or Upsert Contact
    let contact = null;
    if (input.contactId) {
      contact = await prisma.contact.findFirst({ where: { id: input.contactId, userId } });
    } else if (input.recipient) {
      const cleanEmail = input.recipient.trim().toLowerCase();
      contact = await prisma.contact.upsert({
        where: { userId_email: { userId, email: cleanEmail } },
        update: {},
        create: {
          userId,
          email: cleanEmail,
          name: cleanEmail.split("@")[0],
          fullName: cleanEmail.split("@")[0],
          status: "ACTIVE",
        },
      });
    }

    if (!contact) {
      return NextResponse.json({ error: "Recipient contact could not be resolved." }, { status: 404 });
    }
    if (contact.status === "DO_NOT_CONTACT") {
      return NextResponse.json({ error: "This recipient is marked DO_NOT_CONTACT." }, { status: 409 });
    }
    if (contact.status === "INVALID") {
      return NextResponse.json({ error: "This recipient has an invalid email status." }, { status: 409 });
    }

    // 3. Optional Template
    const template = input.templateId
      ? await prisma.template.findFirst({ where: { id: input.templateId, userId, status: "ACTIVE" } })
      : null;

    const variables = {
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName ?? contact.name,
      brandName: contact.brandName,
      companyName: contact.companyName ?? (contact as any).company,
      email: contact.email,
      phone: contact.phone,
      website: contact.website,
      formUrl: contact.formUrl,
      productCategory: (contact as any).notes,
      category: (contact as any).notes,
      notes: (contact as any).notes,
    };

    const finalSubject = renderTemplate(input.subject, variables);
    const finalBody = renderTemplate(input.body, variables);
    const now = new Date();

    // 4. Create EmailMessage
    const pending = await prisma.emailMessage.create({
      data: {
        userId,
        mailboxId: mailbox.id,
        contactId: contact.id,
        templateId: template?.id,
        toAddress: contact.email,
        fromAddress: mailbox.emailAddress,
        subject: finalSubject,
        body: finalBody,
        direction: "OUTBOUND",
        status: "SENDING",
      },
      select: { id: true },
    });

    // 5. Create EmailLog
    const log = await prisma.emailLog.create({
      data: {
        userId,
        messageId: pending.id,
        mailboxId: mailbox.id,
        contactId: contact.id,
        sender: mailbox.emailAddress,
        recipient: contact.email,
        subject: finalSubject,
        status: "SENDING",
      },
      select: { id: true },
    });

    // 6. Send in 100% Real-Time via Hostinger SMTP
    try {
      const result = await sendFromMailbox(mailbox, {
        to: contact.email,
        subject: finalSubject,
        body: finalBody,
      });

      const providerMessageId = result.messageId || null;

      await prisma.$transaction([
        prisma.emailMessage.update({
          where: { id: pending.id },
          data: { status: "SENT", sentAt: now, providerMessageId },
        }),
        prisma.emailLog.update({
          where: { id: log.id },
          data: { status: "SENT", providerMessageId, message: "Sent successfully via Hostinger SMTP." },
        }),
        prisma.contact.update({
          where: { id: contact.id },
          data: { status: contact.status === "ACTIVE" ? "CONTACTED" : contact.status },
        }),
      ]);

      if (input.draftId && input.draftId !== pending.id) {
        await prisma.emailMessage.deleteMany({
          where: { id: input.draftId, userId },
        });
      }

      return NextResponse.json({
        success: true,
        messageId: providerMessageId,
        from: mailbox.emailAddress,
        to: contact.email,
      });
    } catch (sendError) {
      const safe = safeErrorMessage(sendError);
      await prisma.$transaction([
        prisma.emailMessage.update({
          where: { id: pending.id },
          data: { status: "FAILED", errorMessage: safe },
        }),
        prisma.emailLog.update({
          where: { id: log.id },
          data: { status: "FAILED", message: safe },
        }),
      ]);
      return NextResponse.json({ error: safe }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}
