import { inferBrandName } from "@/lib/sheet-detect";
import { parseAndRenderSignatureHtml } from "@/lib/email/signatures";

export const TEMPLATE_VARIABLES = [
  "brandName",
  "productCategory",
  "email",
  "asin",
  "amazonLink",
  "num",
  "firstName",
  "lastName",
  "fullName",
  "companyName",
  "category",
  "website",
  "phone",
  "formUrl",
] as const;

export type TemplateContact = Record<string, any>;

/**
 * Ensures outreach greetings automatically include {{brandName}} before "Team".
 * e.g. "Dear Team," -> "Dear {{brandName}} Team,"
 * e.g. "Hi Team," -> "Hi {{brandName}} Team,"
 */
export function autoFormatGreetingWithBrand(body: string): string {
  if (!body) return "";
  return body
    .replace(/\b(Dear|Hi|Hello|Hey)\s+(?!\{\{\s*brandName\s*\}\}|\[Brand Name\])Team\b/gi, (_, prefix: string) => `${prefix} {{brandName}} Team`)
    .replace(/^Team,/gim, "{{brandName}} Team,");
}

/**
 * Resolves Spintax patterns like {Hi|Hello|Dear} or {I hope you are well|Hope all is well}.
 * If nested or simple spintax is present, it randomly chooses one branch to guarantee
 * unique content fingerprinting per email, bypassing spam filter cluster algorithms.
 */
export function resolveSpintax(text: string): string {
  if (!text) return "";
  let current = text;
  // Match {option1|option2|...} but ignore template placeholders like {{brandName}}
  const spintaxRegex = /\{([^{}|]+(?:\|[^{}|]+)+)\}/g;
  let loops = 0;
  while (spintaxRegex.test(current) && loops < 10) {
    current = current.replace(spintaxRegex, (_, optionsStr: string) => {
      const options = optionsStr.split("|");
      return options[Math.floor(Math.random() * options.length)].trim();
    });
    loops++;
  }
  return current;
}

export function renderTemplate(value: string, contact: TemplateContact) {
  if (!value) return "";
  if (!contact) return resolveSpintax(value);

  const rawCandidateBrand = String(
    contact.brandName ||
    contact.snapshotBrand ||
    contact.companyName ||
    contact.name ||
    ""
  ).trim();

  const email = String(contact.email || contact.snapshotEmail || contact.brandEmail || "").trim();
  const website = String(contact.website || contact.amazonLink || "").trim();

  // Guarantees clean Brand Name is always resolved (with smart fallback if missing)
  const brand = inferBrandName(rawCandidateBrand, email, website);

  // Guarantees clean Category is resolved
  let cat = String(contact.productCategory || contact.category || "").trim();
  if ((!cat || cat.toLowerCase() === "general") && contact.notes && typeof contact.notes === "string" && contact.notes.trim()) {
    cat = contact.notes.trim();
  }
  if (!cat || cat.toLowerCase() === "missing category") {
    cat = "Products";
  }

  const asin = String(contact.asin || contact.formUrl || "").trim();
  const amazonLink = String(contact.amazonLink || contact.website || "").trim();
  const sheetNum = String(contact.sheetNum || contact.num || contact.index || "").trim();

  let prepared = value;

  // 1. Auto-format greeting to always include the detected brand name
  if (brand) {
    prepared = prepared
      .replace(/\b(Dear|Hi|Hello|Hey)\s+(?:Team|Brand|Partner)\b/gi, (_, prefix: string) => `${prefix} ${brand} Team`)
      .replace(/\b(Dear|Hi|Hello|Hey)\s+\[\s*brand(?:\s*name)?\s*\]\s*(?:Team)?\b/gi, (_, prefix: string) => `${prefix} ${brand} Team`)
      .replace(/\b(Dear|Hi|Hello|Hey)\s+\{\{\s*brand(?:\s*name)?\s*\}\}\s*(?:Team)?\b/gi, (_, prefix: string) => `${prefix} ${brand} Team`)
      .replace(/^Team,/gim, `${brand} Team,`);
  }

  // 2. Comprehensive Bracket Replacement: [Brand Name], [Category], [Email], [ASIN], etc.
  prepared = prepared
    .replace(/\[\s*(?:brand(?:\s*name)?|company(?:\s*name)?|store(?:\s*name)?)\s*\]/gi, brand)
    .replace(/\[\s*(?:(?:product\s*)?category(?:\s*name)?|niche|industry)\s*\]/gi, cat)
    .replace(/\[\s*(?:(?:brand\s*)?email(?:\s*address)?)\s*\]/gi, email)
    .replace(/\[\s*(?:asin|product\s*id)\s*\]/gi, asin)
    .replace(/\[\s*(?:amazon(?:\s*link)?|listing(?:\s*url)?)\s*\]/gi, amazonLink)
    .replace(/\[\s*(?:website|url|domain)\s*\]/gi, website || amazonLink)
    .replace(/\[\s*(?:num|sheet\s*num|#|sr(?:\s*no)?)\s*\]/gi, sheetNum);

  // 3. Double Curly Braces Replacement: {{ brandName }}, {{ productCategory }}, etc.
  const rendered = prepared.replace(/{{\s*([^}]+)\s*}}/g, (_, rawVariable: string) => {
    const raw = rawVariable.trim();

    // Direct key match on contact
    if (contact[raw] !== undefined && contact[raw] !== null && String(contact[raw]).trim() !== "") {
      return String(contact[raw]);
    }

    // Direct key match on raw sheet row data if present
    if (contact.raw && typeof contact.raw === "object" && contact.raw[raw] !== undefined && contact.raw[raw] !== null) {
      return String(contact.raw[raw]);
    }

    // Normalized key match (lowercase, stripped spaces/underscores)
    const norm = raw.toLowerCase().replace(/[\s_-]+/g, "");

    for (const [k, v] of Object.entries(contact)) {
      if (v !== null && v !== undefined && k.toLowerCase().replace(/[\s_-]+/g, "") === norm) {
        return String(v);
      }
    }

    if (contact.raw && typeof contact.raw === "object") {
      for (const [k, v] of Object.entries(contact.raw)) {
        if (v !== null && v !== undefined && k.toLowerCase().replace(/[\s_-]+/g, "") === norm) {
          return String(v);
        }
      }
    }

    // Common Outreach domain aliases
    if (
      norm === "brand" ||
      norm === "brandname" ||
      norm === "snapshotbrand" ||
      norm === "company" ||
      norm === "companyname" ||
      norm === "store" ||
      norm === "storename" ||
      norm === "vendor" ||
      norm === "merchant"
    ) {
      return brand;
    }

    if (
      norm === "category" ||
      norm === "productcategory" ||
      norm === "categoryname" ||
      norm === "niche" ||
      norm === "industry" ||
      norm === "sector" ||
      norm === "product"
    ) {
      return cat;
    }

    if (
      norm === "email" ||
      norm === "brandemail" ||
      norm === "snapshotemail" ||
      norm === "contactemail" ||
      norm === "mail"
    ) {
      return email;
    }

    if (norm === "asin" || norm === "productid" || norm === "sku") {
      return asin;
    }

    if (
      norm === "amazonlink" ||
      norm === "amzlink" ||
      norm === "amz" ||
      norm === "listinglink" ||
      norm === "productlink"
    ) {
      return amazonLink;
    }

    if (norm === "website" || norm === "domain" || norm === "url" || norm === "site") {
      return website || amazonLink;
    }

    if (
      norm === "num" ||
      norm === "sheetnum" ||
      norm === "number" ||
      norm === "sr" ||
      norm === "srno" ||
      norm === "index"
    ) {
      return sheetNum;
    }

    // Unknown variable: clean fallback
    return "";
  });

  return resolveSpintax(rendered);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatBodyText(text: string): string {
  let safe = escapeHtml(text);
  // Convert markdown **bold** into <strong style="font-weight: 700; color: #000000;">bold</strong>
  safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight: 700; color: #000000;">$1</strong>');
  return safe;
}

export function renderParagraphsHtml(text: string): string {
  if (!text) return "";
  const paragraphs = text.split(/\n\s*\n/);
  return paragraphs
    .map((para) => {
      const trimmed = para.trim();
      if (!trimmed) return "";
      const lines = trimmed.split("\n").map((line) => formatBodyText(line));
      return `<p style="margin: 0 0 14px 0; line-height: 1.6; font-size: 15px; color: #111827;">${lines.join("<br />")}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

export function formatEmailBodyToHtml(text: string): string {
  if (!text) return "";
  if (/<(html|table)\b/i.test(text.trim())) {
    return text;
  }

  // Check for standard signature delimiter '--'
  const sigMatch = text.match(/(^|\n)--\s*\n([\s\S]+)$/);
  if (!sigMatch) {
    return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; color: #111827; line-height: 1.6;">${renderParagraphsHtml(text)}</div>`;
  }

  const mainPart = text.slice(0, sigMatch.index).trimEnd();
  const sigPart = sigMatch[2].trim();

  // Render signature using the professional 10-style business engine
  const renderedSigHtml = parseAndRenderSignatureHtml(sigPart);

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; color: #111827; line-height: 1.6;">
    ${renderParagraphsHtml(mainPart)}
    <div style="margin-top: 22px; color: #6B7280; font-size: 14px;">--</div>
    ${renderedSigHtml}
  </div>`;
}
