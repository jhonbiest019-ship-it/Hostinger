import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { z } from "zod";

const schema = z.object({ name: z.string().trim().min(1).max(150), subject: z.string().trim().min(1).max(998), body: z.string().trim().min(1).max(100_000) });
const select = { id: true, name: true, subject: true, body: true, status: true, createdAt: true, updatedAt: true } as const;

export async function GET(request: NextRequest) { try { const userId = await requireUser(request); const search = request.nextUrl.searchParams.get("search")?.trim() ?? ""; const templates = await prisma.template.findMany({ where: { userId, status: "ACTIVE", ...(search ? { OR: [{ name: { contains: search } }, { subject: { contains: search } }, { body: { contains: search } }] } : {}) }, select, orderBy: { updatedAt: "desc" } }); return NextResponse.json({ templates }); } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to load templates." }, { status: 500 }); } }

export async function POST(request: NextRequest) { try { const userId = await requireUser(request); const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Template name, subject, and body are required.", fields: parsed.error.flatten().fieldErrors }, { status: 400 }); const template = await prisma.template.create({ data: { userId, ...parsed.data }, select }); return NextResponse.json({ template }, { status: 201 }); } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to create template." }, { status: 500 }); } }
