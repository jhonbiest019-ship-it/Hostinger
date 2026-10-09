import { z } from "zod";

export const contactStatus = z.enum(["ACTIVE", "CONTACTED", "REPLIED", "DO_NOT_CONTACT", "INVALID", "ARCHIVED"]);
export const contactSchema = z.object({
  firstName: z.string().trim().max(100).optional().default(""),
  lastName: z.string().trim().max(100).optional().default(""),
  fullName: z.string().trim().max(200).optional().default(""),
  companyName: z.string().trim().max(200).optional().default(""),
  brandName: z.string().trim().max(200).optional().default(""),
  email: z.string().trim().email("Enter a valid email address.").max(255),
  phone: z.string().trim().max(40).optional().default(""),
  website: z.string().trim().url("Enter a valid website URL.").max(500).optional().or(z.literal("")),
  formUrl: z.string().trim().url("Enter a valid form URL.").max(500).optional().or(z.literal("")),
  notes: z.string().trim().max(5000).optional().default(""),
  status: contactStatus.default("ACTIVE"),
});
export type ContactInput = z.infer<typeof contactSchema>;

export function contactData(input: ContactInput) {
  const fullName = input.fullName || [input.firstName, input.lastName].filter(Boolean).join(" ") || input.email;
  return { firstName: input.firstName || null, lastName: input.lastName || null, fullName, name: fullName, companyName: input.companyName || null, brandName: input.brandName || null, company: input.companyName || input.brandName || null, email: input.email.toLowerCase(), phone: input.phone || null, website: input.website || null, formUrl: input.formUrl || null, notes: input.notes || null, status: input.status };
}
