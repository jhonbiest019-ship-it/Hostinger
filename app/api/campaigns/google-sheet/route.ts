import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseCsv } from "@/lib/csv";

export async function POST(request: NextRequest) {
  try {
    await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const { url } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "Google Sheet URL is required." },
        { status: 400 }
      );
    }

    const cleanUrl = url.trim();

    // Match standard Google Sheet URL: /spreadsheets/d/<SHEET_ID>
    const standardMatch = cleanUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    // Match published Google Sheet URL: /spreadsheets/d/e/<SHEET_ID>
    const pubMatch = cleanUrl.match(/\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);

    // Match gid (sheet tab)
    const gidMatch = cleanUrl.match(/[#&?]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : "0";

    let csvExportUrl = "";
    let fallbackExportUrl = "";

    if (pubMatch) {
      csvExportUrl = `https://docs.google.com/spreadsheets/d/e/${pubMatch[1]}/pub?output=csv${
        gid ? `&gid=${gid}` : ""
      }`;
    } else if (standardMatch) {
      const sheetId = standardMatch[1];
      csvExportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
      fallbackExportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
    } else {
      return NextResponse.json(
        {
          error:
            "Invalid Google Sheet link. Please paste a valid URL like: https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit#gid=0",
        },
        { status: 400 }
      );
    }

    let csvText = "";

    try {
      const res = await fetch(csvExportUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (res.ok) {
        const text = await res.text();
        // Check if response is HTML login / permission page
        if (
          !text.trim().startsWith("<!DOCTYPE") &&
          !text.includes("<html") &&
          !text.includes("accounts.google.com")
        ) {
          csvText = text;
        }
      }
    } catch {
      // try fallback below
    }

    // Try fallback URL if standard export didn't return CSV
    if (!csvText && fallbackExportUrl) {
      try {
        const resFallback = await fetch(fallbackExportUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        if (resFallback.ok) {
          const text = await resFallback.text();
          if (
            !text.trim().startsWith("<!DOCTYPE") &&
            !text.includes("<html") &&
            !text.includes("accounts.google.com")
          ) {
            csvText = text;
          }
        }
      } catch {
        // ignore
      }
    }

    if (!csvText) {
      return NextResponse.json(
        {
          error:
            "Unable to access this Google Sheet. Please make sure the sheet sharing is set to 'Anyone with the link can view' (Viewer access), then click Fetch again.",
        },
        { status: 403 }
      );
    }

    const rawRows = parseCsv(csvText);

    if (!rawRows.length) {
      return NextResponse.json(
        {
          error:
            "The Google Sheet was accessed successfully, but it appears to be empty or contains no data rows.",
        },
        { status: 400 }
      );
    }

    const columns = Object.keys(rawRows[0] || {});
    console.log('[GOOGLE_SHEET_DEBUG] URL:', cleanUrl);
    console.log('[GOOGLE_SHEET_DEBUG] Detected Columns:', columns);
    console.log('[GOOGLE_SHEET_DEBUG] First 2 Rows:', JSON.stringify(rawRows.slice(0, 2), null, 2));

    // Detect Num column (Column A in sheet: Num / No / Sr / #)
    const numKey =
      columns.find((k) =>
        /^(num|no|s\.?no|sr\.?(no)?|#|index|id|serial)$/i.test(k.trim().toLowerCase())
      ) ||
      columns.find((k) =>
        /^(num|no|sr)/i.test(k.trim().toLowerCase()) &&
        !/phone|mobile|tel|category|asin|name/i.test(k.trim().toLowerCase())
      ) ||
      columns[0];

    // Detect Asin column (Column B in sheet: Asin)
    const asinKey = columns.find((k) => /^asin$|^product\s*id/i.test(k.trim().toLowerCase()));

    // Detect Amazon Link column (Column C in sheet: Amazon LINK / Amz)
    const amazonLinkKey = columns.find((k) =>
      /amazon|amz|listing/i.test(k.trim().toLowerCase())
    );

    // Detect Brand Name column (Column D in sheet: Brand name)
    const brandKey =
      columns.find((k) => /^brand(\s*name)?$/i.test(k.trim().toLowerCase())) ||
      columns.find(
        (k) =>
          /brand|company|business|store|vendor|partner|client/i.test(k.toLowerCase()) &&
          !/email|mail|phone|web|site|asin|link|num/i.test(k.toLowerCase())
      );

    // Detect Email column (Column G in user's sheet: Emails / Email)
    const emailKey =
      columns.find((k) => /^emails?$/i.test(k.trim().toLowerCase())) ||
      columns.find(
        (k) => /email|mail|e-mail/i.test(k.toLowerCase()) && !/phone|tel|mobile/i.test(k.toLowerCase())
      );

    const processedRows: any[] = [];
    let sequentialCounter = 0;

    const emailRegexMatch = (val: any) => {
      if (!val) return null;
      const cleaned = String(val).trim().replace(/^mailto:\s*/i, "");
      const match = cleaned.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      return match ? match[0].toLowerCase() : null;
    };

    rawRows.forEach((row, idx) => {
      // 1. Check if row is completely blank
      const values = Object.values(row).map((v) => (v ? String(v).trim() : ""));
      const isBlank = values.every((v) => v === "");
      if (isBlank) return;

      // 2. Extract sheet Num (Column A: 1, 2, 3, 4, 5...)
      let sheetNum: number | null = null;
      if (numKey && row[numKey] !== undefined && String(row[numKey]).trim() !== "") {
        const parsed = parseInt(String(row[numKey]).trim(), 10);
        if (!isNaN(parsed) && parsed > 0) {
          sheetNum = parsed;
        }
      }

      // 3. Extract Asin & Amazon Link
      const asin = asinKey ? String(row[asinKey]).trim() : "";
      const amazonLink = amazonLinkKey ? String(row[amazonLinkKey]).trim() : "";

      // 4. Extract Brand Name
      const rawBrand = brandKey ? String(row[brandKey]).trim() : "";
      const hasBrand = Boolean(
        rawBrand &&
        !/^(undefined|null|none|n\/a|-)$/i.test(rawBrand)
      );

      // Maintain sequential continuous number starting from 1, 2, 3...
      sequentialCounter++;
      const itemNum = sheetNum !== null ? sheetNum : sequentialCounter;

      // 5. Extract Email specifically from any email-named column first, then deep search
      let foundEmail: string | null = null;
      const emailColKeys = columns.filter(
        (k) => /email|mail/i.test(k) && !/phone|tel|mobile/i.test(k)
      );
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

      // 6. Find Product Category
      const categoryKey = Object.keys(row).find(
        (k) =>
          /category|niche|product|industry|tag|segment|type/i.test(k.toLowerCase()) &&
          !/asin|link|num|brand|email/i.test(k.toLowerCase())
      );
      const rawCategory = categoryKey ? String(row[categoryKey]).trim() : "";
      const hasCategory = Boolean(
        rawCategory &&
        !/^(undefined|null|none|n\/a|-)$/i.test(rawCategory)
      );

      // 7. Find Website
      const webKey = Object.keys(row).find(
        (k) =>
          /web|site|url|domain/i.test(k.toLowerCase()) && !/amazon|amz/i.test(k.toLowerCase())
      );
      const website = webKey ? String(row[webKey]).trim() : (amazonLink || "");

      const brandName = hasBrand
        ? rawBrand
        : (asin ? `Brand (${asin})` : (rawEmail ? `Brand (${rawEmail.split("@")[0]})` : `Item #${itemNum}`));

      // 8. Lead Quality Classification (Preserves strict row order, never sorts or shifts)
      const hasValidEmail = Boolean(isValidEmail);
      const hasValidBrand = Boolean(hasBrand);
      const hasValidCategory = Boolean(hasCategory);

      let quality: "COMPLETE" | "NO_EMAIL" | "NO_BRAND" | "NO_CATEGORY" | "INCOMPLETE" = "COMPLETE";
      const missingFields: string[] = [];

      if (!hasValidEmail) {
        missingFields.push("Email Address");
      }
      if (!hasValidBrand) {
        missingFields.push("Brand Name");
      }
      if (!hasValidCategory) {
        missingFields.push("Product Category");
      }

      if (!hasValidEmail) {
        quality = "NO_EMAIL";
      } else if (!hasValidBrand) {
        quality = "NO_BRAND";
      } else if (!hasValidCategory) {
        quality = "NO_CATEGORY";
      } else if (missingFields.length > 0) {
        quality = "INCOMPLETE";
      } else {
        quality = "COMPLETE";
      }

      processedRows.push({
        index: sequentialCounter,
        sheetRowNumber: idx + 2, // spreadsheet line number (header is row 1)
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

    return NextResponse.json({
      success: true,
      sheetId: standardMatch ? standardMatch[1] : pubMatch ? pubMatch[1] : "sheet",
      gid,
      title: "Google Sheet",
      columns,
      totalRawRows: rawRows.length,
      totalRows: processedRows.length,
      completeCount: processedRows.filter((r) => r.quality === "COMPLETE").length,
      missingEmailCount: processedRows.filter((r) => !r.hasValidEmail).length,
      missingBrandCount: processedRows.filter((r) => !r.hasValidBrand).length,
      missingCategoryCount: processedRows.filter((r) => !r.hasValidCategory).length,
      incompleteCount: processedRows.filter((r) => r.quality !== "COMPLETE").length,
      rows: processedRows,
      skippedRows: [],
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: "Failed to process Google Sheet link." },
      { status: 500 }
    );
  }
}
