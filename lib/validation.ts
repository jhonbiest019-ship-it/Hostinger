import { z } from "zod";

export const mailboxSchema = z.object({
  emailAddress: z.string().email("Enter a valid email address."),
  displayName: z.string().trim().max(120).optional(),
  smtpHost: z.string().trim().min(1, "SMTP host is required."),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecurity: z.enum(["TLS", "STARTTLS", "NONE"]),
  imapHost: z.string().trim().min(1, "IMAP host is required."),
  imapPort: z.coerce.number().int().min(1).max(65535),
  imapSecurity: z.enum(["TLS", "STARTTLS", "NONE"]),
  username: z.string().trim().min(1, "Username is required."),
  password: z.string().min(1, "Password is required."),
});

export const mailboxUpdateSchema = mailboxSchema.extend({ password: z.string().optional() });
