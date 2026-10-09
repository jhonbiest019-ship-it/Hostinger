import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, safeErrorMessage } from "@/lib/auth";
import { connectionRateLimit } from "@/lib/rate-limit";
import { sendFromMailbox } from "@/lib/email/send-service";
import { renderTemplate } from "@/lib/email/template";
import { sendSchema } from "@/lib/email/message-validation";

export async function POST(request: NextRequest) {
  let userId = ""; let input: { mailboxId: string; contactId: string; templateId?: string; subject: string; body: string } | undefined;
  try {
    userId = await requireUser(request); const parsed = sendSchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Select a mailbox and contact, then provide a valid subject and body." }, { status: 400 }); input = parsed.data;
    if (!connectionRateLimit(`manual-send:${userId}:${input.contactId}`)) return NextResponse.json({ error: "Too many send attempts. Please wait a minute before trying again." }, { status: 429 });
    const [mailbox, contact, template] = await Promise.all([prisma.mailbox.findFirst({ where: { id: input.mailboxId, userId } }), prisma.contact.findFirst({ where: { id: input.contactId, userId } }), input.templateId ? prisma.template.findFirst({ where: { id: input.templateId, userId, status: "ACTIVE" } }) : null]);
    if (!mailbox) return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
    if (mailbox.status !== "ACTIVE" || mailbox.smtpStatus !== "CONNECTED") return NextResponse.json({ error: "Please verify this mailbox connection before sending." }, { status: 409 });
    if (!contact) return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    if (contact.status === "DO_NOT_CONTACT") return NextResponse.json({ error: "This contact is marked DO_NOT_CONTACT." }, { status: 409 });
    if (contact.status === "INVALID") return NextResponse.json({ error: "This contact has an invalid email status." }, { status: 409 });
    if (input.templateId && !template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    const variables = { firstName: contact.firstName, lastName: contact.lastName, fullName: contact.fullName ?? contact.name, brandName: contact.brandName, companyName: contact.companyName ?? contact.company, email: contact.email, phone: contact.phone, website: contact.website, formUrl: contact.formUrl };
    const subject = renderTemplate(input.subject, variables); const body = renderTemplate(input.body, variables); const now = new Date();
    const pending = await prisma.emailMessage.create({ data: { userId, mailboxId: mailbox.id, contactId: contact.id, templateId: template?.id, toAddress: contact.email, fromAddress: mailbox.emailAddress, subject, body, status: "SENDING" }, select: { id: true } });
    const log = await prisma.emailLog.create({ data: { userId, messageId: pending.id, mailboxId: mailbox.id, contactId: contact.id, sender: mailbox.emailAddress, recipient: contact.email, subject, status: "SENDING" }, select: { id: true } });
    try {
      const result = await sendFromMailbox(mailbox, { to: contact.email, subject, body }); const providerMessageId = result.messageId || null;
      await prisma.$transaction([prisma.emailMessage.update({ where: { id: pending.id }, data: { status: "SENT", sentAt: now, providerMessageId } }), prisma.emailLog.update({ where: { id: log.id }, data: { status: "SENT", providerMessageId, message: "Sent successfully." } }), prisma.contact.update({ where: { id: contact.id }, data: { status: contact.status === "ACTIVE" ? "CONTACTED" : contact.status } })]);
      return NextResponse.json({ success: true, messageId: providerMessageId });
    } catch (error) {
      const safe = safeErrorMessage(error); await prisma.$transaction([prisma.emailMessage.update({ where: { id: pending.id }, data: { status: "FAILED", errorMessage: safe } }), prisma.emailLog.update({ where: { id: log.id }, data: { status: "FAILED", message: safe } })]); return NextResponse.json({ error: safe }, { status: 502 });
    }
  } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 }); }
}
