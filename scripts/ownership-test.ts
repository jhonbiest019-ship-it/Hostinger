import { prisma } from "../lib/prisma";
import { createSessionToken } from "../lib/auth";
import { encryptSecret } from "../lib/credentials";
import { assertSafeTestDatabase } from "./test-safety";

async function main() {
  assertSafeTestDatabase();
  const userA = await prisma.user.findUniqueOrThrow({ where: { email: "test-user@example.test" } });
  const userB = await prisma.user.upsert({ where: { email: "test-user-b@example.test" }, update: {}, create: { email: "test-user-b@example.test", name: "Test User B", passwordHash: "test-only" } });
  const contact = await prisma.contact.upsert({ where: { userId_email: { userId: userB.id, email: "owner-b@example.test" } }, update: {}, create: { userId: userB.id, email: "owner-b@example.test", name: "Owner B", fullName: "Owner B", brandName: "Private B" } });
  const template = await prisma.template.create({ data: { userId: userB.id, name: `PRIVATE TEST ${Date.now()}`, subject: "Private", body: "Private" } });
  const campaign = await prisma.campaign.create({ data: { userId: userB.id, name: `PRIVATE TEST ${Date.now()}` } });
  const mailbox = await prisma.mailbox.create({ data: { userId: userB.id, emailAddress: `private-${Date.now()}@example.test`, username: "private@example.test", encryptedCredentials: encryptSecret("test-only"), smtpHost: "test.invalid", smtpPort: 587, smtpSecurity: "STARTTLS", imapHost: "test.invalid", imapPort: 993, imapSecurity: "TLS" } });
  const cookie = `outreach_session=${createSessionToken(userA.id)}`;
  const checks = await Promise.all([
    fetch(`http://localhost:3000/api/contacts/${contact.id}`, { headers: { cookie } }).then((response) => response.status),
    fetch(`http://localhost:3000/api/templates/${template.id}`, { headers: { cookie } }).then((response) => response.status),
    fetch(`http://localhost:3000/api/campaigns/${campaign.id}`, { headers: { cookie } }).then((response) => response.status),
    fetch(`http://localhost:3000/api/mailboxes/${mailbox.id}`, { headers: { cookie } }).then((response) => response.status),
  ]);
  const passed = checks.every((status) => status === 404 || status === 403); console.log(JSON.stringify({ status: passed ? "PASS" : "FAIL", statuses: checks }));
}
main().finally(() => prisma.$disconnect());
