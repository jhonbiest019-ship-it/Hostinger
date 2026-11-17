/**
 * Intelligent Sheet Header & Column Detector for Hostinger ERP (Shotinger)
 * 
 * Works uniformly across:
 * - Google Sheets Importer (server & client)
 * - File Uploads (Excel .xlsx, .xls, and CSV .csv)
 * - Manual Paste & Bulk Entries
 * - Pre-Send Campaign Creation & Queue Dispatch
 * 
 * Guarantees that Email, Brand Name, and Product Category are accurately identified
 * from any sheet structure and dynamically substituted when emails are sent.
 */

export interface ExtractedRowData {
  index: number;
  sheetNum: number;
  brandEmail: string;
  isValidEmail: boolean;
  brandName: string;
  rawBrand: string;
  hasBrand: boolean;
  productCategory: string;
  rawCategory: string;
  hasCategory: boolean;
  asin: string;
  amazonLink: string;
  website: string;
  quality: "COMPLETE" | "NO_EMAIL" | "NO_BRAND" | "NO_CATEGORY" | "INCOMPLETE";
  missingFields: string[];
  raw: Record<string, any>;
}

export interface DetectedColumns {
  emailKey: string | null;
  brandKey: string | null;
  categoryKey: string | null;
  asinKey: string | null;
  amazonLinkKey: string | null;
  websiteKey: string | null;
  numKey: string | null;
  allColumns: string[];
}

const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "zoho.com",
  "proton.me",
  "protonmail.com",
  "mail.com",
  "gmx.com",
  "yandex.com",
  "live.com",
  "msn.com",
]);

/**
 * Strips email mailto: prefix and extracts the first valid email address.
 */
export function extractValidEmail(val: any): string | null {
  if (!val) return null;
  const cleaned = String(val).trim().replace(/^mailto:\s*/i, "");
  // If comma-separated, check each token
  const tokens = cleaned.split(/[,;\s]+/);
  for (const token of tokens) {
    const match = token.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (match) {
      const email = match[0].toLowerCase();
      if (!/^(n\/a|none|undefined|null|-|test@test\.com)$/i.test(email)) {
        return email;
      }
    }
  }
  const match = cleaned.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Converts a string to Title Case (e.g. "hydro flask" -> "Hydro Flask").
 */
export function toTitleCase(str: string): string {
  if (!str) return "";
  return str
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Intelligently derives a human-friendly brand name from an email address or website domain
 * if brand name was missing in the sheet row.
 */
export function inferBrandName(rawCandidate?: string | null, email?: string | null, website?: string | null): string {
  const cleanCandidate = String(rawCandidate || "").trim();
  if (
    cleanCandidate &&
    !/^(undefined|null|none|n\/a|-|item\s*#?\d+|lead\s*#?\d+|missing\s*brand)$/i.test(cleanCandidate)
  ) {
    return cleanCandidate;
  }

  // Try from website domain
  if (website) {
    try {
      const urlStr = website.startsWith("http") ? website : `https://${website}`;
      const hostname = new URL(urlStr).hostname.replace(/^www\./i, "");
      const domainPart = hostname.split(".")[0];
      if (domainPart && domainPart.length > 2 && !/amazon|amz|google|bitly/i.test(domainPart)) {
        return toTitleCase(domainPart);
      }
    } catch {}
  }

  // Try from email domain or handle
  if (email && email.includes("@")) {
    const [handle, domain] = email.split("@");
    const domainLower = (domain || "").toLowerCase();
    if (domainLower && !GENERIC_EMAIL_DOMAINS.has(domainLower)) {
      const brandPart = domainLower.split(".")[0];
      if (brandPart && brandPart.length > 1) {
        return toTitleCase(brandPart);
      }
    }
    if (handle) {
      const cleanHandle = handle.replace(/[0-9._-]+/g, " ").trim();
      if (cleanHandle.length > 2) {
        return toTitleCase(cleanHandle);
      }
      return handle;
    }
  }

  return cleanCandidate || "Brand";
}

/**
 * Detects the purpose of each column header in a sheet.
 */
export function detectColumnKeys(columns: string[]): DetectedColumns {
  const cols = columns.map((c) => ({ original: c, clean: c.trim().toLowerCase() }));

  // 1. Email Key
  const emailCol =
    cols.find((c) => /^(e-?mail(\s*address)?|brand\s*e-?mail|contact\s*e-?mail|primary\s*e-?mail|work\s*e-?mail|mail)$/i.test(c.clean)) ||
    cols.find((c) => /emails?|e-mail/i.test(c.clean) && !/phone|tel|mobile/i.test(c.clean)) ||
    cols.find((c) => /mail/i.test(c.clean) && !/phone|tel|mobile|street|address|link/i.test(c.clean));

  // 2. Brand Name Key
  const brandCol =
    cols.find((c) => /^(brand(\s*name)?|brand_name|brandname|brands)$/i.test(c.clean)) ||
    cols.find((c) => /^(company(\s*name)?|company_name|companyname)$/i.test(c.clean)) ||
    cols.find((c) => /^(store(\s*name)?|business(\s*name)?|vendor(\s*name)?|merchant(\s*name)?|seller(\s*name)?|shop(\s*name)?)$/i.test(c.clean)) ||
    cols.find((c) => /^(client(\s*name)?|account(\s*name)?|lead(\s*name)?|organization(\s*name)?)$/i.test(c.clean)) ||
    cols.find((c) =>
      /brand|company|business|store|vendor|merchant|seller|shop|client/i.test(c.clean) &&
      !/email|mail|phone|web|site|url|asin|link|num|category|niche/i.test(c.clean)
    ) ||
    cols.find((c) => /^(name|full\s*name|contact\s*name|title)$/i.test(c.clean));

  // 3. Category Key
  const categoryCol =
    cols.find((c) => /^(product\s*)?category(\s*name)?$/i.test(c.clean)) ||
    cols.find((c) => /^(categories|category_name|productcategory|product_category)$/i.test(c.clean)) ||
    cols.find((c) => /^(sub[-_\s]?category|main[-_\s]?category)$/i.test(c.clean)) ||
    cols.find((c) => /^(niche|industry|sector|department|product[-_\s]?type|item[-_\s]?type|classification|segment|vertical)$/i.test(c.clean)) ||
    cols.find((c) =>
      /category|niche|industry|sector|department|classification/i.test(c.clean) &&
      !/asin|link|url|num|id|brand|email|mail|phone|web|site/i.test(c.clean)
    );

  // 4. Asin Key
  const asinCol = cols.find((c) => /^(asin|product\s*id|item\s*id|sku|amazon\s*asin)$/i.test(c.clean));

  // 5. Amazon Link Key
  const amazonLinkCol = cols.find((c) => /amazon|amz|listing/i.test(c.clean));

  // 6. Website Key
  const websiteCol =
    cols.find((c) => /^(website|web|site|url|domain|homepage|store\s*url|brand\s*website)$/i.test(c.clean)) ||
    cols.find((c) => /web|site|url|domain/i.test(c.clean) && !/amazon|amz|listing/i.test(c.clean));

  // 7. Num Key (Column A in most sheets: Num, No, Sr, #, Sr. No)
  const numCol =
    cols.find((c) => /^(num|no|s\.?no|sr\.?(no)?|#|index|id|serial)$/i.test(c.clean)) ||
    cols.find((c) => /^(num|no|sr)/i.test(c.clean) && !/phone|mobile|tel|category|asin|name/i.test(c.clean));

  return {
    emailKey: emailCol ? emailCol.original : null,
    brandKey: brandCol ? brandCol.original : null,
    categoryKey: categoryCol ? categoryCol.original : null,
    asinKey: asinCol ? asinCol.original : null,
    amazonLinkKey: amazonLinkCol ? amazonLinkCol.original : null,
    websiteKey: websiteCol ? websiteCol.original : null,
    numKey: numCol ? numCol.original : null,
    allColumns: columns,
  };
}

/**
 * Extracts and normalizes data from a single row, no matter what header variation was used.
 */
export function extractRowData(
  row: Record<string, any>,
  fallbackIndex = 1,
  detectedCols?: DetectedColumns
): ExtractedRowData {
  if (!row || typeof row !== "object") {
    return {
      index: fallbackIndex,
      sheetNum: fallbackIndex,
      brandEmail: "",
      isValidEmail: false,
      brandName: `Lead #${fallbackIndex}`,
      rawBrand: "",
      hasBrand: false,
      productCategory: "General",
      rawCategory: "",
      hasCategory: false,
      asin: "",
      amazonLink: "",
      website: "",
      quality: "NO_EMAIL",
      missingFields: ["Email Address"],
      raw: {},
    };
  }

  const columns = Object.keys(row);
  const detected = detectedCols || detectColumnKeys(columns);

  // 1. Extract Sheet Num
  let sheetNum = fallbackIndex;
  if (row.sheetNum !== undefined && row.sheetNum !== null && String(row.sheetNum).trim() !== "") {
    const parsed = parseInt(String(row.sheetNum).trim(), 10);
    if (!isNaN(parsed) && parsed > 0) sheetNum = parsed;
  } else if (detected.numKey && row[detected.numKey] !== undefined && String(row[detected.numKey]).trim() !== "") {
    const parsed = parseInt(String(row[detected.numKey]).trim(), 10);
    if (!isNaN(parsed) && parsed > 0) sheetNum = parsed;
  }

  // 2. Extract ASIN
  let asin = "";
  if (row.asin !== undefined && row.asin !== null) {
    asin = String(row.asin).trim();
  } else if (detected.asinKey && row[detected.asinKey] !== undefined) {
    asin = String(row[detected.asinKey]).trim();
  } else {
    // Scan values for 10-char Amazon ASIN pattern (e.g. B08N5WRWNW)
    for (const val of Object.values(row)) {
      if (typeof val === "string" && /^B0[A-Z0-9]{8}$/i.test(val.trim())) {
        asin = val.trim().toUpperCase();
        break;
      }
    }
  }

  // 3. Extract Amazon Link
  let amazonLink = "";
  if (row.amazonLink !== undefined && row.amazonLink !== null) {
    amazonLink = String(row.amazonLink).trim();
  } else if (detected.amazonLinkKey && row[detected.amazonLinkKey] !== undefined) {
    amazonLink = String(row[detected.amazonLinkKey]).trim();
  }

  // 4. Extract Website
  let website = "";
  if (row.website !== undefined && row.website !== null) {
    website = String(row.website).trim();
  } else if (detected.websiteKey && row[detected.websiteKey] !== undefined) {
    website = String(row[detected.websiteKey]).trim();
  } else if (amazonLink) {
    website = amazonLink;
  }

  // 5. Extract Email (Mandatory check)
  let foundEmail: string | null = null;
  // Check direct camelCase fields
  if (row.brandEmail) foundEmail = extractValidEmail(row.brandEmail);
  if (!foundEmail && row.email) foundEmail = extractValidEmail(row.email);

  // Check detected column
  if (!foundEmail && detected.emailKey && row[detected.emailKey] !== undefined) {
    foundEmail = extractValidEmail(row[detected.emailKey]);
  }

  // Check all email-named keys
  if (!foundEmail) {
    for (const [k, v] of Object.entries(row)) {
      if (/email|mail/i.test(k) && !/phone|tel|mobile/i.test(k)) {
        const candidate = extractValidEmail(v);
        if (candidate) {
          foundEmail = candidate;
          break;
        }
      }
    }
  }

  // Deep search all string values as fallback
  if (!foundEmail) {
    for (const [k, v] of Object.entries(row)) {
      if (k === detected.numKey || k === detected.asinKey || k === detected.amazonLinkKey) continue;
      const candidate = extractValidEmail(v);
      if (candidate) {
        foundEmail = candidate;
        break;
      }
    }
  }

  const isValidEmail = Boolean(foundEmail);
  const brandEmail = foundEmail || "";

  // 6. Extract Brand Name
  let rawBrand = "";
  if (row.brandName !== undefined && row.brandName !== null) {
    rawBrand = String(row.brandName).trim();
  } else if (row.brand !== undefined && row.brand !== null) {
    rawBrand = String(row.brand).trim();
  } else if (row.companyName !== undefined && row.companyName !== null) {
    rawBrand = String(row.companyName).trim();
  } else if (row.company !== undefined && row.company !== null) {
    rawBrand = String(row.company).trim();
  } else if (detected.brandKey && row[detected.brandKey] !== undefined) {
    rawBrand = String(row[detected.brandKey]).trim();
  }

  const hasBrand = Boolean(
    rawBrand &&
    !/^(undefined|null|none|n\/a|-|item\s*#?\d+|lead\s*#?\d+|missing\s*brand)$/i.test(rawBrand)
  );

  const brandName = hasBrand
    ? rawBrand
    : inferBrandName(rawBrand, brandEmail, website || amazonLink);

  // 7. Extract Product Category
  let rawCategory = "";
  if (row.productCategory !== undefined && row.productCategory !== null) {
    rawCategory = String(row.productCategory).trim();
  } else if (row.category !== undefined && row.category !== null) {
    rawCategory = String(row.category).trim();
  } else if (row.niche !== undefined && row.niche !== null) {
    rawCategory = String(row.niche).trim();
  } else if (detected.categoryKey && row[detected.categoryKey] !== undefined) {
    rawCategory = String(row[detected.categoryKey]).trim();
  }

  const hasCategory = Boolean(
    rawCategory &&
    !/^(undefined|null|none|n\/a|-|general|missing\s*category)$/i.test(rawCategory)
  );

  const productCategory = hasCategory ? rawCategory : "General";

  // 8. Quality classification
  const missingFields: string[] = [];
  if (!isValidEmail) missingFields.push("Email Address");
  if (!hasBrand) missingFields.push("Brand Name");
  if (!hasCategory) missingFields.push("Product Category");

  let quality: "COMPLETE" | "NO_EMAIL" | "NO_BRAND" | "NO_CATEGORY" | "INCOMPLETE" = "COMPLETE";
  if (!isValidEmail) {
    quality = "NO_EMAIL";
  } else if (!hasBrand) {
    quality = "NO_BRAND";
  } else if (!hasCategory) {
    quality = "NO_CATEGORY";
  } else if (missingFields.length > 0) {
    quality = "INCOMPLETE";
  }

  return {
    index: fallbackIndex,
    sheetNum,
    brandEmail,
    isValidEmail,
    brandName,
    rawBrand,
    hasBrand,
    productCategory,
    rawCategory,
    hasCategory,
    asin,
    amazonLink,
    website,
    quality,
    missingFields,
    raw: row,
  };
}

/**
 * Automatically inspects the first several rows of a sheet array to find the true header row
 * if the top row was a banner or blank row.
 */
export function findTrueHeaderIndex(rawRows: any[][]): number {
  if (!rawRows || rawRows.length === 0) return 0;

  const headerKeywords = [
    "email",
    "brand",
    "company",
    "store",
    "category",
    "niche",
    "product",
    "asin",
    "link",
    "website",
    "url",
    "phone",
    "name",
    "num",
    "no",
    "sr",
  ];

  let bestIndex = 0;
  let bestScore = -1;

  const maxScan = Math.min(rawRows.length, 5);
  for (let i = 0; i < maxScan; i++) {
    const row = rawRows[i];
    if (!Array.isArray(row)) continue;
    let score = 0;
    for (const cell of row) {
      const text = String(cell || "").toLowerCase().trim();
      if (!text) continue;
      for (const kw of headerKeywords) {
        if (text === kw || text.includes(kw)) {
          score += 2;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestScore >= 2 ? bestIndex : 0;
}
