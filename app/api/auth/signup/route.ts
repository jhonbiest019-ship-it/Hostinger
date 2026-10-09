import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, hashPassword, sessionCookieOptions } from "@/lib/auth";
import { z } from "zod";

const schema = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(255), password: z.string().min(10).max(128) });

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a name, valid email, and password of at least 10 characters." }, { status: 400 });
    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    const user = await prisma.user.create({ data: { name: parsed.data.name, email, passwordHash: await hashPassword(parsed.data.password) }, select: { id: true, name: true, email: true } });
    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set("outreach_session", createSessionToken(user.id), sessionCookieOptions());
    return response;
  } catch { return NextResponse.json({ error: "Unable to create account." }, { status: 500 }); }
}
