import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseCsv } from "@/lib/csv";
import { detectColumnKeys, extractRowData } from "@/lib/sheet-detect";

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

    const detectedCols = detectColumnKeys(columns);
    const processedRows: any[] = [];

    rawRows.forEach((row, idx) => {
      const spreadsheetLineNumber = idx + 2; // spreadsheet line number (header is row 1)
      const values = Object.values(row).map((v) => (v ? String(v).trim() : ""));
      const isBlank = values.every((v) => v === "");

      const extracted = extractRowData(row, spreadsheetLineNumber, detectedCols);

      processedRows.push({
        index: spreadsheetLineNumber,
        sheetRowNumber: spreadsheetLineNumber,
        sheetNum: extracted.sheetNum || spreadsheetLineNumber,
        asin: extracted.asin,
        amazonLink: extracted.amazonLink,
        brandName: isBlank ? `Row #${spreadsheetLineNumber}` : extracted.brandName,
        brandEmail: extracted.brandEmail,
        productCategory: extracted.hasCategory ? extracted.productCategory : "Missing Category",
        website: extracted.website,
        hasValidEmail: extracted.isValidEmail,
        hasValidBrand: isBlank ? false : extracted.hasBrand,
        hasValidCategory: extracted.hasCategory,
        quality: isBlank ? "NO_EMAIL" : extracted.quality,
        missingFields: extracted.missingFields,
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
