/**
 * Form Discovery Engine
 * Identifies wholesale, retailer, and contact forms for brand contacts.
 */

export interface FormDiscoveryResult {
  targetFormUrl: string | null;
  isAvailable: boolean;
  missingInfo?: string;
  source: "EXPLICIT_FORM_URL" | "DERIVED_WHOLESALE" | "DERIVED_CONTACT" | "MISSING_WEBSITE";
  reason?: string;
}

export function cleanUrl(url?: string | null): string {
  if (!url) return "";
  let clean = String(url).trim();
  if (!clean || /^(n\/a|none|null|undefined|-)$/i.test(clean)) return "";
  if (!/^https?:\/\//i.test(clean)) {
    clean = `https://${clean}`;
  }
  return clean.replace(/\/+$/, "");
}

export function discoverBrandFormUrl(
  brandWebsite?: string | null,
  explicitFormUrl?: string | null,
  brandName?: string | null
): FormDiscoveryResult {
  // 1. Check explicit formUrl if provided in spreadsheet / contact
  const cleanExplicit = cleanUrl(explicitFormUrl);
  if (cleanExplicit && !cleanExplicit.includes("amazon.com")) {
    return {
      targetFormUrl: cleanExplicit,
      isAvailable: true,
      source: "EXPLICIT_FORM_URL",
    };
  }

  // 2. Check brand website
  const cleanWeb = cleanUrl(brandWebsite);
  if (!cleanWeb) {
    return {
      targetFormUrl: null,
      isAvailable: false,
      missingInfo: "Missing brand website URL. Please provide website or direct form URL.",
      source: "MISSING_WEBSITE",
      reason: "No website URL provided for this brand.",
    };
  }

  // If website already points directly to a form or contact page
  if (/\/(wholesale|retailer|contact|pages\/contact|partner|apply)/i.test(cleanWeb)) {
    return {
      targetFormUrl: cleanWeb,
      isAvailable: true,
      source: "DERIVED_WHOLESALE",
    };
  }

  // Default to primary wholesale or contact form on brand website
  const derivedWholesaleUrl = `${cleanWeb}/wholesale`;
  return {
    targetFormUrl: derivedWholesaleUrl,
    isAvailable: true,
    source: "DERIVED_WHOLESALE",
  };
}
