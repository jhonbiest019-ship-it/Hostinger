import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatSentDateTime } from "@/lib/google-sheets-sync";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;

    const campaign = await prisma.campaign.findFirst({
      where: { id, userId },
      include: {
        recipients: {
          include: {
            contact: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    const headers = [
      "Sheet Row #",
      "Brand Name",
      "Email",
      "Category",
      "Email Status",
      "Sent Date",
      "Sent Time",
      "Google Sheet Sync",
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = campaign.recipients.map((r, idx) => {
      const brandName = r.snapshotBrand || r.contact.brandName || r.contact.name || "Brand";
      const email = r.snapshotEmail || r.contact.email;
      const category = r.productCategory || r.contact.notes || "General";
      const { dateStr, timeStr } = formatSentDateTime(r.sentAt);

      return [
        r.sheetRowIndex ?? idx + 1,
        brandName,
        email,
        category,
        r.status,
        dateStr || (r.status === "SENT" ? "Yes" : "-"),
        timeStr || "-",
        r.sheetSyncStatus || "PENDING",
      ]
        .map(escapeCsv)
        .join(",");
    });

    const csvContent = [headers.map(escapeCsv).join(","), ...rows].join("\r\n");

    const safeName = campaign.name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "_");

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName}_updated_brands.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: "Unable to export campaign sheet." },
      { status: 500 }
    );
  }
}
