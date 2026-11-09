import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { prisma } from "../lib/prisma";
import { formatSentDateTime, syncRecipientToGoogleSheet, syncCampaignSheetBatch } from "../lib/google-sheets-sync";

function check(condition: any, name: string) {
  if (!condition) {
    console.error(`❌ Check failed: ${name}`);
    process.exit(1);
  }
  console.log(`✓ ${name}`);
}

async function run() {
  console.log("=== Running Campaign Management & Google Sheet Sync Tests ===");

  // 1. Create or find test user
  let user = await prisma.user.findFirst({ where: { email: "campaign-mgmt-test@example.com" } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: "campaign-mgmt-test@example.com",
        name: "Campaign Test User",
      },
    });
  }
  check(user, "User exists");

  // 2. Test Timestamp Formatting
  const testDate = new Date("2026-10-20T15:45:30Z");
  const formatted = formatSentDateTime(testDate);
  check(formatted.dateStr && formatted.timeStr, "formatSentDateTime produces date and hour/minute");
  console.log("  Formatted date/time:", formatted.readableStr);

  // 3. Test Campaign Creation with Google Sheet metadata
  const campaignName = `Test Sheet Campaign ${Date.now()}`;
  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      name: campaignName,
      description: "Organized brands from Google Sheet test",
      sheetUrl: "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0",
      sheetTab: "0",
      status: "DRAFT",
    },
  });
  check(campaign.id, "Campaign created with sheet metadata");

  // 4. Test Brand Organization & Duplicate Prevention
  const brandData = [
    { brandName: "Apple Inc", email: `apple-${Date.now()}@example.com`, category: "Technology", sheetRowIndex: 2 },
    { brandName: "Nike Sports", email: `nike-${Date.now()}@example.com`, category: "Apparel", sheetRowIndex: 3 },
    { brandName: "L'Oreal", email: `loreal-${Date.now()}@example.com`, category: "Beauty & Cosmetics", sheetRowIndex: 4 },
  ];

  const recipients = [];
  for (const b of brandData) {
    const contact = await prisma.contact.upsert({
      where: { userId_email: { userId: user.id, email: b.email } },
      create: { userId: user.id, name: b.brandName, brandName: b.brandName, email: b.email, notes: b.category },
      update: {},
    });

    const recipient = await prisma.campaignRecipient.create({
      data: {
        campaignId: campaign.id,
        contactId: contact.id,
        status: "PENDING",
        snapshotBrand: b.brandName,
        snapshotEmail: b.email,
        productCategory: b.category,
        sheetRowIndex: b.sheetRowIndex,
        sheetSyncStatus: "PENDING",
      },
    });
    recipients.push(recipient);
  }
  check(recipients.length === 3, "Organized 3 brands under the campaign");

  // 5. Test Duplicate Prevention
  let duplicatePrevented = false;
  try {
    const firstContact = await prisma.contact.findFirst({ where: { userId: user.id, email: brandData[0].email } });
    if (firstContact) {
      await prisma.campaignRecipient.create({
        data: {
          campaignId: campaign.id,
          contactId: firstContact.id,
          status: "PENDING",
        },
      });
    }
  } catch {
    duplicatePrevented = true;
  }
  check(duplicatePrevented, "Duplicate email in same campaign is strictly prevented");

  // 6. Test Email SENT status with actual sent date and hour/minute
  const sentAt = new Date();
  const sentRecipient = await prisma.campaignRecipient.update({
    where: { id: recipients[0].id },
    data: {
      status: "SENT",
      sentAt,
    },
  });
  check(sentRecipient.status === "SENT", "Recipient status updated to SENT");
  check(sentRecipient.sentAt !== null, "Actual sent date & time recorded in database");

  const sentFormat = formatSentDateTime(sentRecipient.sentAt);
  check(sentFormat.timeStr.length === 5, `Hour and minute formatted correctly: ${sentFormat.timeStr}`);

  // 7. Test Sheet Sync Resilience when webhook is not configured or failed:
  // Must NOT resend email; must record RETRY / error
  const syncAttempt = await syncRecipientToGoogleSheet(sentRecipient.id);
  check(syncAttempt.success === false, "Sync pending when webhook URL not configured");

  const afterSync = await prisma.campaignRecipient.findUnique({ where: { id: sentRecipient.id } });
  check(afterSync?.status === "SENT", "Email status REMAINED SENT (email never re-sent!)");
  check(afterSync?.sheetSyncStatus === "RETRY", "Google Sheet sync status set to RETRY");
  check(afterSync?.sheetSyncError !== null, "Sheet sync error/instructions saved in database");

  // 8. Test FAILED email status handling
  const failedRecipient = await prisma.campaignRecipient.update({
    where: { id: recipients[1].id },
    data: {
      status: "FAILED",
      errorMessage: "SMTP recipient mailbox rejected",
    },
  });
  check(failedRecipient.status === "FAILED", "Failed email status recorded as FAILED");
  check(failedRecipient.errorMessage === "SMTP recipient mailbox rejected", "Failure reason saved in database");

  // 9. Clean up test records
  await prisma.campaign.delete({ where: { id: campaign.id } });
  console.log("=== All Campaign Management & Google Sheet Sync Tests PASSED! ===");
}

run()
  .catch((err) => {
    console.error("Test error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
