import {
  SIGNATURE_STYLES,
  DEFAULT_SIGNATURE_DATA,
  parseAndRenderSignatureHtml,
  appendSignatureToBody,
} from "../lib/email/signatures";
import { formatEmailBodyToHtml, renderTemplate } from "../lib/email/template";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

async function run() {
  console.log("=== 1. VERIFYING 10 PROFESSIONAL SIGNATURE STYLES ===");
  assert(SIGNATURE_STYLES.length === 10, "Exactly 10 professional signature styles are defined");

  for (let i = 0; i < SIGNATURE_STYLES.length; i++) {
    const style = SIGNATURE_STYLES[i];
    console.log(`\nTesting Style #${i + 1}: ${style.name} (${style.id})`);
    
    // Generate text
    const text = style.generateText(DEFAULT_SIGNATURE_DATA);
    assert(text.includes(DEFAULT_SIGNATURE_DATA.fullName), `Style ${style.id} text contains Full Name`);
    assert(text.toLowerCase().includes(DEFAULT_SIGNATURE_DATA.companyName.toLowerCase()), `Style ${style.id} text contains Company Name`);
    assert(text.includes(DEFAULT_SIGNATURE_DATA.phone), `Style ${style.id} text contains Phone`);
    assert(text.includes(DEFAULT_SIGNATURE_DATA.email), `Style ${style.id} text contains Email`);

    // Render HTML directly
    const directHtml = style.renderHtml(DEFAULT_SIGNATURE_DATA);
    assert(directHtml.includes(DEFAULT_SIGNATURE_DATA.fullName), `Direct HTML for ${style.id} has name`);
    assert(directHtml.includes(DEFAULT_SIGNATURE_DATA.email), `Direct HTML for ${style.id} has email`);

    // Parse text back into HTML via parseAndRenderSignatureHtml
    const parsedHtml = parseAndRenderSignatureHtml(text);
    assert(parsedHtml.includes(DEFAULT_SIGNATURE_DATA.fullName), `Parsed HTML for ${style.id} has name`);
    assert(parsedHtml.length > 50, `Parsed HTML for ${style.id} is non-trivial`);
  }

  console.log("\n=== 2. VERIFYING appendSignatureToBody FUNCTION ===");
  const emailWithClosing = "Hi {{brandName}} Team,\n\nWe love your products.\n\nKind regards,";
  const sigText = SIGNATURE_STYLES[0].generateText(DEFAULT_SIGNATURE_DATA);
  const combined = appendSignatureToBody(emailWithClosing, sigText);

  assert(combined.includes("Kind regards,"), "Preserves Kind regards,");
  assert(combined.includes(DEFAULT_SIGNATURE_DATA.fullName), "Appends signature text");
  assert(!combined.includes("Best regards,\n\nKind regards,"), "Does not duplicate closing");

  const emailWithoutClosing = "Hi Team,\n\nCheck this out.";
  const combinedNoClosing = appendSignatureToBody(emailWithoutClosing, sigText);
  assert(combinedNoClosing.includes("Best regards,"), "Auto-inserts Best regards, when missing");
  assert(combinedNoClosing.includes(DEFAULT_SIGNATURE_DATA.fullName), "Appends signature text");

  console.log("\n=== 3. VERIFYING formatEmailBodyToHtml RENDERING ===");
  const formattedHtml = formatEmailBodyToHtml(combined);
  assert(formattedHtml.includes("<table") || formattedHtml.includes("<div"), "Contains structured HTML layout");
  assert(formattedHtml.includes("David Lucas"), "Formatted email HTML contains Name");
  assert(formattedHtml.includes("david@faranigroup.com"), "Formatted email HTML contains Email Link");
  assert(formattedHtml.includes("Kind regards"), "Formatted email HTML contains Kind regards");

  console.log("\n=== 4. VERIFYING TEMPLATE PERSONALIZATION WITH SIGNATURE ===");
  const recipient = {
    brandName: "Hydro Flask",
    productCategory: "Drinkware",
    email: "partner@hydroflask.com",
  };
  const personalized = renderTemplate(combined, recipient);
  assert(personalized.includes("Hi Hydro Flask Team,"), "Auto-greeting rendered with Brand Name");
  assert(personalized.includes("David Lucas"), "Signature intact after template variable replacement");

  console.log("\n🎉 ALL 10 SIGNATURE STYLES AND TEMPLATE TESTS PASSED PERFECTLY!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
