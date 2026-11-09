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

export function renderTemplate(value: string, contact: TemplateContact) {
  if (!value) return "";
  if (!contact) return value;

  const brand = String(
    contact.brandName ||
    contact.snapshotBrand ||
    contact.companyName ||
    contact.name ||
    ""
  ).trim();

  // If a template has "Dear Team," or "Hi Team," without {{brandName}}, auto-insert brand from sheet detail
  let prepared = value;
  if (brand) {
    prepared = prepared
      .replace(/\b(Dear|Hi|Hello|Hey)\s+Team\b/gi, (_, prefix: string) => `${prefix} ${brand} Team`)
      .replace(/^Team,/gim, `${brand} Team,`)
      .replace(/\[\s*brand\s*name\s*\]/gi, brand);
  }
  const cat = String(contact.productCategory || contact.category || contact.notes || "").trim();
  if (cat) {
    prepared = prepared.replace(/\[\s*category\s*name\s*\]/gi, cat);
  }

  return prepared.replace(/{{\s*([^}]+)\s*}}/g, (_, rawVariable: string) => {
    const raw = rawVariable.trim();
    // 1. Direct key match
    if (contact[raw] !== undefined && contact[raw] !== null) {
      return String(contact[raw]);
    }
    // 2. Normalized key match (lowercase, stripped spaces/underscores)
    const norm = raw.toLowerCase().replace(/[\s_-]+/g, "");
    for (const [k, v] of Object.entries(contact)) {
      if (v !== null && v !== undefined && k.toLowerCase().replace(/[\s_-]+/g, "") === norm) {
        return String(v);
      }
    }
    // 3. Common domain aliases for Outreach
    if (norm === "brand" || norm === "brandname" || norm === "snapshotbrand") {
      return String(contact.brandName || contact.snapshotBrand || contact.companyName || contact.name || "");
    }
    if (norm === "category" || norm === "productcategory" || norm === "product") {
      return String(contact.productCategory || contact.category || contact.notes || "");
    }
    if (norm === "email" || norm === "brandemail" || norm === "snapshotemail") {
      return String(contact.email || contact.snapshotEmail || "");
    }
    if (norm === "asin" || norm === "productid") {
      return String(contact.asin || contact.formUrl || "");
    }
    if (norm === "amazonlink" || norm === "amzlink" || norm === "amz" || norm === "listinglink") {
      return String(contact.amazonLink || contact.website || "");
    }
    if (norm === "num" || norm === "sheetnum" || norm === "number") {
      return String(contact.sheetNum || contact.num || contact.index || "");
    }
    return "";
  });
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

export function formatEmailBodyToHtml(text: string): string {
  if (!text) return "";
  if (/<(html|table)\b/i.test(text.trim())) {
    return text;
  }

  // Check for standard signature delimiter '--'
  const sigMatch = text.match(/(^|\n)--\s*\n([\s\S]+)$/);
  if (!sigMatch) {
    return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; color: #111827; line-height: 1.6; white-space: pre-wrap;">${formatBodyText(text)}</div>`;
  }

  const mainPart = text.slice(0, sigMatch.index).trimEnd();
  const sigPart = sigMatch[2].trim();

  // Check if signature has 2-column format with '|'
  const sigLines = sigPart.split("\n").map((l) => l.trim()).filter(Boolean);
  const hasPipe = sigLines.length >= 2 && sigLines.some((l) => l.includes("|"));

  if (!hasPipe) {
    return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; color: #111827; line-height: 1.6; white-space: pre-wrap;">${formatBodyText(text)}</div>`;
  }

  // Parse rows with pipe '|'
  const rows = sigLines.map((line) => {
    const parts = line.split("|");
    return {
      left: parts[0]?.trim() || "",
      right: parts.slice(1).join("|")?.trim() || "",
    };
  });

  const leftName = rows[0]?.left || "";
  const leftTitle = rows[1]?.left || "";
  const leftCompany = rows[2]?.left || "";

  const rightRowsHtml = rows
    .filter((r) => r.right)
    .map((r, idx) => {
      let rawText = r.right.trim();

      const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
      const phoneRegex = /([0-9+() -]{7,})/;
      const hasEmail = emailRegex.test(rawText);
      const hasPhone = !hasEmail && phoneRegex.test(rawText);
      const hasAddress =
        !hasEmail &&
        !hasPhone &&
        (rawText.toLowerCase().includes("road") ||
          rawText.toLowerCase().includes("street") ||
          rawText.toLowerCase().includes("fl") ||
          rawText.toLowerCase().includes("orlando") ||
          idx >= 2);

      let icon = "";
      if (hasPhone || /^(📞|☎️|📱)/.test(rawText)) {
        icon = "📞";
      } else if (hasEmail || /^(✉️|✉|📧)/.test(rawText)) {
        icon = "✉️";
      } else if (hasAddress || /^(📍|📌)/.test(rawText)) {
        icon = "📍";
      }

      // Clean away any existing emojis or leading symbols to avoid duplicates
      rawText = rawText
        .replace(/^[\u{1F4DE}\u{260E}\u{260F}\u{1F4F1}\u{2709}\u{1F4E7}\u{1F4E8}\u{1F4CD}\u{1F4CC}\u{FE0F}\u{FFFD}📞☎️📱✉️✉📧📍📌?\s]+/u, "")
        .trim();

      let content = escapeHtml(rawText);
      if (hasEmail) {
        const m = rawText.match(emailRegex);
        if (m) {
          content = content.replace(
            m[1],
            `<a href="mailto:${m[1]}" style="color: #111827; text-decoration: none;">${m[1]}</a>`
          );
        }
      } else if (hasPhone) {
        const m = rawText.match(phoneRegex);
        if (m) {
          const rawNum = m[1].replace(/[^0-9+]/g, "");
          content = content.replace(
            m[1].trim(),
            `<a href="tel:${rawNum}" style="color: #111827; text-decoration: none; font-weight: 500;">${m[1].trim()}</a>`
          );
        }
      }

      const iconHtml = icon
        ? `<span style="display: inline-block; margin-right: 7px; font-size: 13.5px; vertical-align: middle;">${icon}</span>`
        : "";

      return `<div style="font-size: 13.5px; color: #111827; margin-bottom: 5px; line-height: 1.4; white-space: nowrap;">${iconHtml}${content}</div>`;
    })
    .join("");

  const sigHtml = `
  <div style="margin-top: 24px; color: #6B7280; font-size: 14px;">--</div>
  <table cellpadding="0" cellspacing="0" border="0" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin-top: 10px; border-collapse: collapse;">
    <tr>
      <td style="padding-right: 22px; vertical-align: middle; white-space: nowrap;">
        <div style="font-size: 17px; font-weight: bold; color: #000000; line-height: 1.25;">${escapeHtml(leftName)}</div>
        ${leftTitle ? `<div style="font-size: 13.5px; color: #374151; margin-top: 3px; line-height: 1.3;">${escapeHtml(leftTitle)}</div>` : ""}
        ${leftCompany ? `<div style="font-size: 13.5px; font-weight: 700; color: #000000; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.3;">${escapeHtml(leftCompany)}</div>` : ""}
      </td>
      <td style="border-left: 2px solid #111827; padding-left: 22px; vertical-align: middle; white-space: nowrap;">
        ${rightRowsHtml}
      </td>
    </tr>
  </table>`;

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; color: #111827; line-height: 1.6;">
    <div style="white-space: pre-wrap;">${formatBodyText(mainPart)}</div>
    ${sigHtml}
  </div>`;
}
