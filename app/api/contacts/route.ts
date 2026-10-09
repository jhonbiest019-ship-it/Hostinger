import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { contactData, contactSchema } from "@/lib/contact";

const select = { id: true, firstName: true, lastName: true, fullName: true, name: true, companyName: true, brandName: true, email: true, phone: true, website: true, formUrl: true, notes: true, status: true, createdAt: true, updatedAt: true } as const;
function safeContact(contact: Record<string, unknown>) { return contact; }

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request); const params = request.nextUrl.searchParams; const search = params.get("search")?.trim() ?? ""; const status = params.get("status"); const page = Math.max(Number(params.get("page") ?? 1) || 1, 1); const pageSize = Math.min(Math.max(Number(params.get("pageSize") ?? 25) || 25, 1), 100);
    const where = { userId, ...(status && ["ACTIVE", "CONTACTED", "REPLIED", "DO_NOT_CONTACT", "INVALID", "ARCHIVED"].includes(status) ? { status: status as never } : {}), ...(search ? { OR: [{ name: { contains: search } }, { fullName: { contains: search } }, { companyName: { contains: search } }, { brandName: { contains: search } }, { email: { contains: search } }, { phone: { contains: search } }] } : {}) };
    const [contacts, total] = await prisma.$transaction([prisma.contact.findMany({ where, select, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), prisma.contact.count({ where })]);
    return NextResponse.json({ contacts: contacts.map(safeContact), total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to load contacts." }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request); const parsed = contactSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid contact details.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
    const contact = await prisma.contact.create({ data: { userId, ...contactData(parsed.data) }, select });
    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) { if (error instanceof Response) return error; if (error instanceof Error && error.message.includes("Unique constraint")) return NextResponse.json({ error: "A contact with this email already exists." }, { status: 409 }); return NextResponse.json({ error: "Unable to create contact." }, { status: 500 }); }
}
