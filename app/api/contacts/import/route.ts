import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { contactData, contactSchema } from "@/lib/contact";

const select = { id: true, firstName: true, lastName: true, fullName: true, name: true, companyName: true, brandName: true, email: true, phone: true, website: true, formUrl: true, notes: true, status: true, createdAt: true, updatedAt: true } as const;
export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request); const body = await request.json(); const rows = Array.isArray(body.rows) ? body.rows : []; const strategy = body.strategy === "update" ? "update" : "skip";
    if (rows.length > 1000) return NextResponse.json({ error: "CSV imports are limited to 1,000 rows." }, { status: 400 });
    const valid: ReturnType<typeof contactData>[] = []; const errors: { row: number; email?: string; reason: string }[] = [];
    rows.forEach((row: unknown, index: number) => { const parsed = contactSchema.safeParse(row); if (!parsed.success) errors.push({ row: index + 2, email: typeof row === "object" && row && "email" in row ? String(row.email) : undefined, reason: parsed.error.issues[0]?.message ?? "Invalid row" }); else valid.push(contactData(parsed.data)); });
    const emails = [...new Set(valid.map((item) => item.email))]; const existing = await prisma.contact.findMany({ where: { userId, email: { in: emails } }, select: { id: true, email: true } }); const existingMap = new Map(existing.map((item) => [item.email, item.id])); const duplicates = valid.filter((item) => existingMap.has(item.email)); const fresh = valid.filter((item) => !existingMap.has(item.email));
    if (strategy === "update") { for (const item of duplicates) await prisma.contact.update({ where: { id: existingMap.get(item.email) }, data: item }); }
    if (fresh.length) await prisma.contact.createMany({ data: fresh.map((item) => ({ userId, ...item })), skipDuplicates: true });
    return NextResponse.json({ imported: fresh.length, updated: strategy === "update" ? duplicates.length : 0, duplicates: strategy === "skip" ? duplicates.length : 0, invalid: errors.length, errors });
  } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to import contacts." }, { status: 500 }); }
}
