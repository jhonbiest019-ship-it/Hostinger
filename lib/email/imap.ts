import { ImapFlow } from "imapflow";
import type { MailConnectionConfig } from "@/lib/email/smtp";

export async function verifyImap(config: MailConnectionConfig) {
  if (process.env.EMAIL_TEST_MODE === "true") return { testMode: true as const };
  const client = createImapClient(config);
  try { await client.connect(); } finally { await client.logout().catch(() => undefined); }
}

export function createImapClient(config: MailConnectionConfig) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.security === "TLS",
    auth: { user: config.username, pass: config.password },
    tls: { rejectUnauthorized: false },
    socketTimeout: 20_000,
    logger: false,
  });
  client.on("error", () => {});
  return client;
}
