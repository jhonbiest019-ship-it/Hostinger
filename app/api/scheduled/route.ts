import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) { try { const userId = await requireUser(request); const jobs = await prisma.scheduledJob.findMany({ where: { userId }, include: { campaign: { select: { id: true, name: true } }, campaignRecipient: { include: { contact: { select: { name: true, fullName: true, email: true } } } }, message: { select: { subject: true } } }, orderBy: { runAt: "asc" }, take: 200 }); return NextResponse.json({ jobs }); } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to load scheduled jobs." }, { status: 500 }); } }
