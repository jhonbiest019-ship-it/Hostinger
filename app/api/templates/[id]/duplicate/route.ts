import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) { try { const userId = await requireUser(request); const { id } = await context.params; const original = await prisma.template.findFirst({ where: { id, userId, status: "ACTIVE" } }); if (!original) return NextResponse.json({ error: "Template not found." }, { status: 404 }); const template = await prisma.template.create({ data: { userId, name: `${original.name} copy`, subject: original.subject, body: original.body }, select: { id: true, name: true, subject: true, body: true, status: true, createdAt: true, updatedAt: true } }); return NextResponse.json({ template }, { status: 201 }); } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to duplicate template." }, { status: 500 }); } }
