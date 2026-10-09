import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) { try { const userId = await requireUser(request); const messages = await prisma.emailMessage.findMany({ where: { userId, direction: "INBOUND" }, include: { mailbox: { select: { emailAddress: true } }, campaign: { select: { id: true, name: true } }, contact: { select: { name: true, fullName: true, email: true } } }, orderBy: { receivedAt: "desc" }, take: 100 }); return NextResponse.json({ messages }); } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to load inbox." }, { status: 500 }); } }
