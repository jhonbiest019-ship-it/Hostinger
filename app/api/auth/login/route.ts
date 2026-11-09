import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  createSessionToken,
  getClientIp,
  logSecurityEvent,
  resetRateLimit,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";
import { z } from "zod";

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
});

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase();
    const rateLimitKey = `login:${ip}:${email}`;
    const rateCheck = checkRateLimit(rateLimitKey, 5, 15 * 60 * 1000);

    if (!rateCheck.allowed) {
      await logSecurityEvent("LOGIN_RATE_LIMITED", null, { email, retryAfter: rateCheck.retryAfterSeconds }, request);
      return NextResponse.json(
        { error: `Too many login attempts. Please wait ${rateCheck.retryAfterSeconds} seconds before trying again.` },
        { status: 429 }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      await logSecurityEvent("LOGIN_FAILED", user?.id ?? null, { email }, request);
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }

    resetRateLimit(rateLimitKey);
    await logSecurityEvent("LOGIN_SUCCESS", user.id, { email }, request);

    const token = createSessionToken(user.id, user.tokenVersion);
    const response = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified },
    });
    response.cookies.set("outreach_session", token, sessionCookieOptions());
    return response;
  } catch (error) {
    console.error("Login error:", error);
    const msg = error instanceof Error ? error.message : "Unable to sign in.";
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("Can't reach database") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("connect")
    ) {
      return NextResponse.json(
        {
          error:
            "Database not connected on Vercel. Please add your cloud DATABASE_URL in Vercel Environment Variables.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: "Unable to sign in." }, { status: 500 });
  }
}
