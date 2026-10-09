import { ImapFlow } from "imapflow";
import type { MailConnectionConfig } from "@/lib/email/smtp";

export async function verifyImap(config: MailConnectionConfig) {
  const client = createImapClient(config);
  try { await client.connect(); } finally { await client.logout().catch(() => undefined); }
}

export function createImapClient(config: MailConnectionConfig) {
  return new ImapFlow({ host: config.host, port: config.port, secure: config.security === "TLS", auth: { user: config.username, pass: config.password }, socketTimeout: 20_000, logger: false });
}
