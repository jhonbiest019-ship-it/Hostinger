import { z } from "zod";

export const sendSchema = z
  .object({
    mailboxId: z.string().min(1),
    contactId: z.string().optional(),
    recipient: z.string().email().optional(),
    templateId: z.string().optional(),
    draftId: z.string().optional(),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(998)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Subject contains invalid control characters."),
    body: z.string().trim().min(0).max(100_000),
  })
  .refine((data) => data.contactId || data.recipient, {
    message: "Either contactId or recipient email must be provided.",
  });

export const testSendSchema = z.object({
  mailboxId: z.string().min(1),
  recipient: z.string().email(),
  subject: z.string().trim().min(1).max(998),
  body: z.string().trim().min(1).max(100_000),
});
