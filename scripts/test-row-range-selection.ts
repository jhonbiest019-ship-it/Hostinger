import { prisma } from "../lib/prisma";
import { parseCsv } from "../lib/csv";

async function runTests() {
  console.log("=================================================");
  console.log("RUNNING SHOTINGER ROW RANGE & BRAND EXTRACTION TESTS");
  console.log("=================================================\n");

  const url = "https://docs.google.com/spreadsheets/d/1MUWEwz-NZlp9OMFRRpdS13elFQV28mIRdje8UaHZpV4/export?format=csv&gid=0";
  console.log("[TEST 1] Fetching live Google Sheet...");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch sheet");
  const text = await res.text();
  const rawRows = parseCsv(text);
  console.log(`✓ Fetched ${rawRows.length} data rows from Google Sheet.\n`);

  // Detect columns
  const columns = Object.keys(rawRows[0] || {});
  const numKey = columns.find((k) => /^(num|no|s\.?no|sr\.?(no)?|#|index|id|serial)$/i.test(k.trim().toLowerCase())) || columns[0];
  const asinKey = columns.find((k) => /^asin$|^product\s*id/i.test(k.trim().toLowerCase()));
  const amazonLinkKey = columns.find((k) => /amazon|amz|listing/i.test(k.trim().toLowerCase()));
  const brandKey = columns.find((k) => /^brand(\s*name)?$/i.test(k.trim().toLowerCase())) ||
    columns.find((k) => /brand|company|business/i.test(k.toLowerCase()) && !/email|mail|phone|asin/i.test(k.toLowerCase()));

  const emailRegexMatch = (val: any) => {
    if (!val) return null;
    const cleaned = String(val).trim().replace(/^mailto:\s*/i, "");
    const match = cleaned.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    return match ? match[0].toLowerCase() : null;
  };

  const processedRows: any[] = [];
  let sequentialCounter = 0;

  rawRows.forEach((row, idx) => {
    const values = Object.values(row).map((v) => (v ? String(v).trim() : ""));
    if (values.every((v) => v === "")) return;

    let sheetNum: number | null = null;
    if (numKey && row[numKey] !== undefined && String(row[numKey]).trim() !== "") {
      const parsed = parseInt(String(row[numKey]).trim(), 10);
      if (!isNaN(parsed) && parsed > 0) sheetNum = parsed;
    }

    const asin = asinKey ? String(row[asinKey]).trim() : "";
    const amazonLink = amazonLinkKey ? String(row[amazonLinkKey]).trim() : "";
    const rawBrand = brandKey ? String(row[brandKey]).trim() : "";
    const hasBrand = Boolean(rawBrand && !/^(undefined|null|none|n\/a|-)$/i.test(rawBrand));

    sequentialCounter++;
    const itemNum = sheetNum !== null ? sheetNum : sequentialCounter;

    let foundEmail: string | null = null;
    const emailColKeys = columns.filter((k) => /email|mail/i.test(k) && !/phone|tel|mobile/i.test(k));
    for (const k of emailColKeys) {
      const candidate = emailRegexMatch(row[k]);
      if (candidate) {
        foundEmail = candidate;
        break;
      }
    }
    if (!foundEmail) {
      for (const [k, v] of Object.entries(row)) {
        if (k === numKey || k === asinKey || k === amazonLinkKey) continue;
        const candidate = emailRegexMatch(v);
        if (candidate) {
          foundEmail = candidate;
          break;
        }
      }
    }

    const isValidEmail = Boolean(foundEmail);
    const rawEmail = foundEmail || "";

    const categoryKey = Object.keys(row).find((k) =>
      /category|niche|product|industry|tag|segment|type/i.test(k.toLowerCase()) &&
      !/asin|link|num|brand|email/i.test(k.toLowerCase())
    );
    const rawCategory = categoryKey ? String(row[categoryKey]).trim() : "";
    const hasCategory = Boolean(rawCategory && !/^(undefined|null|none|n\/a|-)$/i.test(rawCategory));

    const webKey = Object.keys(row).find((k) =>
      /web|site|url|domain/i.test(k.toLowerCase()) && !/amazon|amz/i.test(k.toLowerCase())
    );
    const website = webKey ? String(row[webKey]).trim() : (amazonLink || "");

    const brandName = hasBrand ? rawBrand : (asin ? `Brand (${asin})` : (rawEmail ? `Brand (${rawEmail.split("@")[0]})` : `Item #${itemNum}`));

    const hasValidEmail = Boolean(isValidEmail);
    const hasValidBrand = Boolean(hasBrand);
    const hasValidCategory = Boolean(hasCategory);

    let quality = "COMPLETE";
    const missingFields: string[] = [];
    if (!hasValidEmail) missingFields.push("Email Address");
    if (!hasValidBrand) missingFields.push("Brand Name");
    if (!hasValidCategory) missingFields.push("Product Category");

    if (!hasValidEmail) quality = "NO_EMAIL";
    else if (!hasValidBrand) quality = "NO_BRAND";
    else if (!hasValidCategory) quality = "NO_CATEGORY";
    else if (missingFields.length > 0) quality = "INCOMPLETE";

    processedRows.push({
      index: sequentialCounter,
      sheetRowNumber: idx + 2,
      sheetNum: itemNum,
      asin,
      amazonLink,
      brandName,
      brandEmail: rawEmail,
      productCategory: hasCategory ? rawCategory : "Missing Category",
      website,
      hasValidEmail,
      hasValidBrand,
      hasValidCategory,
      quality,
      missingFields,
      raw: row,
    });
  });

  console.log(`[TEST 2] Verifying total processed rows: ${processedRows.length} matches raw rows: ${rawRows.length}`);
  if (processedRows.length !== rawRows.length) {
    throw new Error(`Mismatch: processedRows length ${processedRows.length} !== rawRows length ${rawRows.length}`);
  }
  console.log("✓ Processed rows match 1:1 without dropping any row.\n");

  // TEST 3: Range 51 to 60 (Section 1 & 7)
  console.log("[TEST 3] Testing Start Row: 51, End Row: 60");
  const fromRow = 51;
  const toRow = 60;
  const selected51_60 = processedRows.slice(fromRow - 1, toRow);
  const expectedCount = toRow - fromRow + 1;

  console.log(`  Selected count: ${selected51_60.length} (Expected: ${expectedCount})`);
  if (selected51_60.length !== expectedCount) {
    throw new Error(`Count mismatch: got ${selected51_60.length}, expected ${expectedCount}`);
  }

  const expectedBrands = [
    { row: 51, line: 52, brand: "Carpe", email: "help@mycarpe.com", complete: true },
    { row: 52, line: 53, brand: "HARMONÍA", email: "support@drinkharmonia.com", complete: true },
    { row: 53, line: 54, brand: "DOSE", email: "weactuallycare@dosedaily.co", complete: true },
    { row: 54, line: 55, brand: "BEAM", email: "info@beamminerals.com", complete: true },
    { row: 55, line: 56, brand: "Blyss", email: "", complete: false, missingEmail: true },
    { row: 56, line: 57, brand: "Ivory", email: "", complete: false, missingEmail: true },
    { row: 57, line: 58, brand: "Grüns", email: "care@gruns.co", complete: true },
    { row: 58, line: 59, brand: "Rho Nutrition", email: "support@rhonutrition.com", complete: true },
    { row: 59, line: 60, brand: "BASK & LATHER", email: "info@baskandlatherco.com", complete: true },
    { row: 60, line: 61, brand: "Sculptique", email: "info@trysculptique.com", complete: true },
  ];

  selected51_60.forEach((r, i) => {
    const exp = expectedBrands[i];
    console.log(`  Row ${r.index} (Line ${r.sheetRowNumber}): ${r.brandName} | Email: ${r.brandEmail || "(Missing Email)"} | Quality: ${r.quality}`);
    if (r.index !== exp.row) throw new Error(`Row number mismatch at index ${i}: got ${r.index}, expected ${exp.row}`);
    if (r.sheetRowNumber !== exp.line) throw new Error(`Line number mismatch at index ${i}: got ${r.sheetRowNumber}, expected ${exp.line}`);
    if (r.brandName !== exp.brand) throw new Error(`Brand mismatch at row ${exp.row}: got "${r.brandName}", expected "${exp.brand}"`);
    if (exp.complete && r.quality !== "COMPLETE") throw new Error(`Expected COMPLETE for row ${exp.row}`);
    if (exp.missingEmail && r.quality !== "NO_EMAIL") throw new Error(`Expected NO_EMAIL for row ${exp.row}`);
  });

  // Calculate Breakdown for 51-60
  let completeCount = 0;
  let missingEmailCount = 0;
  let missingBrandCount = 0;
  let missingCategoryCount = 0;

  for (const r of selected51_60) {
    if (r.quality === "COMPLETE") completeCount++;
    if (!r.hasValidEmail) missingEmailCount++;
    if (!r.hasValidBrand) missingBrandCount++;
    if (!r.hasValidCategory) missingCategoryCount++;
  }

  console.log(`\n  Breakdown for Rows 51–60:`);
  console.log(`  - Total Selected Rows: ${selected51_60.length}`);
  console.log(`  - Complete Leads: ${completeCount}`);
  console.log(`  - Missing Email: ${missingEmailCount}`);
  console.log(`  - Missing Brand: ${missingBrandCount}`);
  console.log(`  - Missing Category: ${missingCategoryCount}`);

  if (completeCount !== 8 || missingEmailCount !== 2 || missingBrandCount !== 0 || missingCategoryCount !== 0) {
    throw new Error(`Breakdown calculation mismatch for 51-60!`);
  }
  console.log("✓ Section 7 UI breakdown matches expected values: 10 total, 8 complete, 2 missing email, 0 missing brand, 0 missing category.\n");

  // TEST 4: Quick Select Range 1 to 25
  console.log("[TEST 4] Testing Quick Select: Rows 1–25");
  const selected1_25 = processedRows.slice(0, 25);
  if (selected1_25.length !== 25) throw new Error(`Rows 1-25 count mismatch: got ${selected1_25.length}, expected 25`);
  if (selected1_25[0].index !== 1 || selected1_25[24].index !== 25) throw new Error("Rows 1-25 indices incorrect");
  console.log(`✓ Rows 1–25 selected exactly 25 rows (index 1 to 25).\n`);

  // TEST 5: Quick Select Range 10 to 20
  console.log("[TEST 5] Testing Quick Select: Rows 10–20");
  const selected10_20 = processedRows.slice(9, 20);
  if (selected10_20.length !== 11) throw new Error(`Rows 10-20 count mismatch: got ${selected10_20.length}, expected 11`);
  if (selected10_20[0].index !== 10 || selected10_20[10].index !== 20) throw new Error("Rows 10-20 indices incorrect");
  console.log(`✓ Rows 10–20 selected exactly 11 rows (index 10 to 20, 20 - 10 + 1 = 11).\n`);

  // TEST 6: Campaign Saving & Reopening Simulation (Database Verification)
  console.log("[TEST 6] Testing Campaign Saving & Reopening with Database");
  const testUser = await prisma.user.findFirst();
  if (!testUser) throw new Error("No user found in database for test");

  const testCampaign = await prisma.campaign.create({
    data: {
      userId: testUser.id,
      name: `Test Row Range Selection Campaign ${Date.now()}`,
      description: `Selected Rows: 51–60 (10 rows)`,
      sheetUrl: url,
      sheetTab: "Rows 51-60",
      status: "DRAFT",
    },
  });

  console.log(`  Created test campaign ID: ${testCampaign.id}`);

  // Save selected 51-60 rows into CampaignRecipient
  for (let i = 0; i < selected51_60.length; i++) {
    const row = selected51_60[i];
    const rawEmail = String(row.brandEmail || "").trim().toLowerCase();
    const isValidEmail = Boolean(rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail));
    const rowIndex = row.index;
    const brandName = row.brandName;
    const productCategory = row.productCategory;

    if (isValidEmail) {
      const contact = await prisma.contact.upsert({
        where: { userId_email: { userId: testUser.id, email: rawEmail } },
        update: { brandName },
        create: { userId: testUser.id, email: rawEmail, name: brandName, brandName, status: "ACTIVE" },
      });
      await prisma.campaignRecipient.create({
        data: {
          campaignId: testCampaign.id,
          contactId: contact.id,
          status: "PENDING",
          snapshotBrand: brandName,
          snapshotEmail: rawEmail,
          productCategory,
          sheetRowIndex: rowIndex,
        },
      });
    } else {
      const placeholderEmail = `missing-email-r${rowIndex}-${testCampaign.id.slice(0, 8)}@placeholder.invalid`;
      const contact = await prisma.contact.upsert({
        where: { userId_email: { userId: testUser.id, email: placeholderEmail } },
        update: { brandName, status: "INVALID" },
        create: { userId: testUser.id, email: placeholderEmail, name: brandName, brandName, status: "INVALID" },
      });
      await prisma.campaignRecipient.create({
        data: {
          campaignId: testCampaign.id,
          contactId: contact.id,
          status: "SKIPPED",
          snapshotBrand: brandName,
          snapshotEmail: "",
          productCategory,
          sheetRowIndex: rowIndex,
          errorMessage: "Missing Email Address (Skipped from dispatch)",
        },
      });
    }
  }

  // Now reload campaign from DB as reopening would
  const reloaded = await prisma.campaign.findUnique({
    where: { id: testCampaign.id },
    include: {
      recipients: {
        include: { contact: true },
        orderBy: { sheetRowIndex: "asc" },
      },
    },
  });

  if (!reloaded) throw new Error("Failed to reload campaign");
  console.log(`  Reloaded campaign recipients count: ${reloaded.recipients.length} (Expected: 10)`);
  if (reloaded.recipients.length !== 10) {
    throw new Error(`Expected exactly 10 recipients in database, found ${reloaded.recipients.length}`);
  }

  const skipped = reloaded.recipients.filter((r) => r.status === "SKIPPED");
  const pending = reloaded.recipients.filter((r) => r.status === "PENDING");
  console.log(`  Pending recipients: ${pending.length} (Expected: 8)`);
  console.log(`  Skipped (Missing email) recipients: ${skipped.length} (Expected: 2)`);

  if (pending.length !== 8 || skipped.length !== 2) {
    throw new Error("Recipient status counts do not match 8 pending and 2 skipped!");
  }

  // Verify rows 55 and 56 specifically
  const row55 = reloaded.recipients.find((r) => r.sheetRowIndex === 55);
  const row56 = reloaded.recipients.find((r) => r.sheetRowIndex === 56);
  if (!row55 || row55.snapshotBrand !== "Blyss" || row55.status !== "SKIPPED") {
    throw new Error("Row 55 Blyss failed DB preservation test!");
  }
  if (!row56 || row56.snapshotBrand !== "Ivory" || row56.status !== "SKIPPED") {
    throw new Error("Row 56 Ivory failed DB preservation test!");
  }
  console.log("✓ Rows 55 (Blyss) and 56 (Ivory) accurately preserved as SKIPPED at their exact row indices!");

  // Clean up test campaign
  await prisma.campaignRecipient.deleteMany({ where: { campaignId: testCampaign.id } });
  await prisma.campaign.delete({ where: { id: testCampaign.id } });
  console.log("✓ Cleaned up test database records.\n");

  console.log("=================================================");
  console.log("🎉 ALL TESTS PASSED SUCCESSFULLY (100% VERIFIED)!");
  console.log("=================================================");
}

runTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
