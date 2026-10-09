import { z } from "zod";

export const sendSchema = z.object({ mailboxId: z.string().min(1), contactId: z.string().min(1), templateId: z.string().optional(), subject: z.string().trim().min(1).max(998).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Subject contains invalid control characters."), body: z.string().trim().min(1).max(100_000) });
export const testSendSchema = z.object({ mailboxId: z.string().min(1), recipient: z.string().email(), subject: z.string().trim().min(1).max(998), body: z.string().trim().min(1).max(100_000) });
