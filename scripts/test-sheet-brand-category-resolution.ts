import { extractRowData, detectColumnKeys, inferBrandName } from "../lib/sheet-detect";
import { renderTemplate } from "../lib/email/template";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log("=== RUNNING SHEET & BRAND & CATEGORY EXTRACTION TESTS ===");

  // Test 1: Standard Sheet
  const sheet1Row = {
    Num: "1",
    "Brand Name": "Anker Innovations",
    Email: "support@anker.com",
    "Product Category": "Electronics & Power",
    ASIN: "B08N5WRWNW",
    "Amazon Link": "https://amazon.com/dp/B08N5WRWNW",
  };
  const ex1 = extractRowData(sheet1Row, 1);
  assert(ex1.brandEmail === "support@anker.com", "Sheet 1 extracts email");
  assert(ex1.brandName === "Anker Innovations", "Sheet 1 extracts brandName");
  assert(ex1.productCategory === "Electronics & Power", "Sheet 1 extracts productCategory");

  // Test 2: Alternate Headers (Company, Work Email, Niche)
  const sheet2Row = {
    "#": "42",
    "Company Name": "Hydro Flask",
    "Work Email": "outreach@hydroflask.com",
    Niche: "Sports & Outdoors",
  };
  const ex2 = extractRowData(sheet2Row, 42);
  assert(ex2.brandEmail === "outreach@hydroflask.com", "Sheet 2 extracts email from 'Work Email'");
  assert(ex2.brandName === "Hydro Flask", "Sheet 2 extracts brandName from 'Company Name'");
  assert(ex2.productCategory === "Sports & Outdoors", "Sheet 2 extracts category from 'Niche'");

  // Test 3: Unorthodox Headers (Store, Mail, Department with messy whitespace)
  const sheet3Row = {
    " Store ": "Bella Kitchen",
    " Mail Address ": "contact@bellakitchen.com",
    " Department ": "Home & Kitchen",
    " Item ASIN ": "B012345678",
  };
  const ex3 = extractRowData(sheet3Row, 3);
  assert(ex3.brandEmail === "contact@bellakitchen.com", "Sheet 3 extracts email from ' Mail Address '");
  assert(ex3.brandName === "Bella Kitchen", "Sheet 3 extracts brandName from ' Store '");
  assert(ex3.productCategory === "Home & Kitchen", "Sheet 3 extracts category from ' Department '");

  // Test 4: Missing Brand Name - Smart Domain Derivation
  const sheet4Row = {
    email: "partner@solostove.com",
    category: "Camping & Outdoor Living",
  };
  const ex4 = extractRowData(sheet4Row, 4);
  assert(ex4.brandEmail === "partner@solostove.com", "Sheet 4 extracts email");
  assert(ex4.brandName.toLowerCase().replace(/\s+/g, "") === "solostove", `Sheet 4 infers brandName from domain: got "${ex4.brandName}"`);
  assert(ex4.productCategory === "Camping & Outdoor Living", "Sheet 4 extracts category");

  // Test 5: Template Rendering - Greetings, {{brandName}}, [Brand Name], {{category}}, [Category]
  console.log("\n=== RUNNING TEMPLATE RENDERING DYNAMIC VARIABLE TESTS ===");
  const templateSubject = "Partnership with {{brandName}} - [Category Name]";
  const templateBody = `Dear Team,

We noticed your incredible collection in the {{category}} space. We would love to collaborate with [Brand Name] to promote your products.

Best regards,
Outreach Team`;

  const renderedSub = renderTemplate(templateSubject, ex1);
  const renderedBody = renderTemplate(templateBody, ex1);

  console.log("\n[Rendered Subject]:", renderedSub);
  console.log("[Rendered Body]:\n" + renderedBody);

  assert(renderedSub.includes("Anker Innovations"), "Subject contains brandName");
  assert(renderedSub.includes("Electronics & Power"), "Subject contains category");
  assert(renderedBody.includes("Dear Anker Innovations Team,"), "Greeting auto-formatted with Brand Name");
  assert(renderedBody.includes("Electronics & Power"), "Body contains {{category}} replacement");
  assert(renderedBody.includes("collaborate with Anker Innovations"), "Body contains [Brand Name] replacement");
  assert(!renderedBody.includes("{{"), "No unrendered curly braces remain");
  assert(!renderedBody.includes("[Brand Name]"), "No unrendered bracket variables remain");

  // Test 6: Inferred Brand in Template Rendering
  const renderedSub4 = renderTemplate("Question for {{brand}} regarding [Category]", ex4);
  const renderedBody4 = renderTemplate("Hi Team,\n\nWe love your {{productCategory}} line.\n\nCheers,\nOutreach", ex4);

  console.log("\n[Rendered Inferred Subject]:", renderedSub4);
  console.log("[Rendered Inferred Body]:\n" + renderedBody4);

  assert(renderedSub4.toLowerCase().includes("solostove"), "Inferred brand rendered in subject");
  assert(renderedSub4.includes("Camping & Outdoor Living"), "Inferred category rendered in subject");
  assert(renderedBody4.toLowerCase().includes("solostove team,"), "Greeting auto-formatted with inferred brand");

  console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY!");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
