import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) { try { const userId = await requireUser(request); const params = request.nextUrl.searchParams; const status = params.get("status"); const search = params.get("search")?.trim() ?? ""; const logs = await prisma.emailLog.findMany({ where: { userId, ...(status ? { status: status as never } : {}), ...(search ? { OR: [{ recipient: { contains: search } }, { sender: { contains: search } }, { subject: { contains: search } }] } : {}) }, include: { mailbox: { select: { emailAddress: true, displayName: true } }, contact: { select: { id: true, name: true, fullName: true } } }, orderBy: { createdAt: "desc" }, take: 100 }); return NextResponse.json({ logs }); } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to load email logs." }, { status: 500 }); } }
