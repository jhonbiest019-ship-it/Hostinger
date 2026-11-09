import { z } from "zod";

export const campaignSchema = z.object({ name: z.string().trim().max(150).optional().default(""), description: z.string().trim().max(5000).optional().default(""), mailboxId: z.string().optional(), templateId: z.string().optional() });
export const recipientSchema = z.object({ contactIds: z.array(z.string().min(1)).max(5000) });
