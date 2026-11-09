import { z } from "zod";

export const mailboxSchema = z.object({
  emailAddress: z.string().email("Enter a valid email address."),
  displayName: z.string().trim().max(120).optional(),
  smtpHost: z
    .string()
    .trim()
    .optional()
    .default("smtp.hostinger.com")
    .transform((val) => val || "smtp.hostinger.com"),
  smtpPort: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(465),
  smtpSecurity: z.enum(["TLS", "STARTTLS", "NONE"]).default("TLS"),
  imapHost: z
    .string()
    .trim()
    .optional()
    .default("imap.hostinger.com")
    .transform((val) => val || "imap.hostinger.com"),
  imapPort: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(993),
  imapSecurity: z.enum(["TLS", "STARTTLS", "NONE"]).default("TLS"),
  username: z.string().trim().min(1, "Username is required."),
  password: z.string().min(1, "Password is required."),
});

export const mailboxUpdateSchema = mailboxSchema.extend({ password: z.string().optional() });
