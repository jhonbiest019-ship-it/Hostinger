import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, sessionCookieOptions, verifyPassword } from "@/lib/auth";
import { z } from "zod";

const schema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(128) });

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user?.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } });
    response.cookies.set("outreach_session", createSessionToken(user.id), sessionCookieOptions());
    return response;
  } catch { return NextResponse.json({ error: "Unable to sign in." }, { status: 500 }); }
}
