import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try { const id = await requireUser(request); const user = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } }); return NextResponse.json({ user }); }
  catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to load session." }, { status: 500 }); }
}
