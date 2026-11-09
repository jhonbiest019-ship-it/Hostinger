import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  createSessionToken,
  generateVerificationCode,
  getClientIp,
  hashPassword,
  logSecurityEvent,
  sessionCookieOptions,
} from "@/lib/auth";
import { z } from "zod";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(128),
});

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rateCheck = checkRateLimit(`signup:${ip}`, 10, 60 * 60 * 1000);
    if (!rateCheck.allowed) {
      await logSecurityEvent("SIGNUP_RATE_LIMITED", null, { ip }, request);
      return NextResponse.json(
        { error: `Too many sign up attempts from this network. Please try again later.` },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter a name, valid email, and password of at least 6 characters." },
        { status: 400 }
      );
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      await logSecurityEvent("SIGNUP_EMAIL_EXISTS", existing.id, { email }, request);
      return NextResponse.json(
        { error: "An account with this email already exists. Sign in or use Reset Password." },
        { status: 409 }
      );
    }

    const verificationCode = generateVerificationCode(6);
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const passwordHash = await hashPassword(parsed.data.password);

    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email,
        passwordHash,
        emailVerified: true, // Activated by default with verification code on record
        verificationCode,
        verificationExpires,
        tokenVersion: 1,
      },
      select: { id: true, name: true, email: true, tokenVersion: true, emailVerified: true },
    });

    // Provide default starter template for the new user's private workspace
    await prisma.template.create({
      data: {
        userId: user.id,
        name: "Default Partnership Outreach",
        subject: "Partnership Inquiry: Collaboration with {{brandName}}",
        body: "Hi {{brandName}} Team,\n\nWe love your brand and would love to discuss a partnership.\n\nBest regards,\nDavid Lucas",
        status: "ACTIVE",
        isDefault: true,
      },
    }).catch(() => undefined);

    await logSecurityEvent("SIGNUP_SUCCESS", user.id, { email, name: user.name }, request);

    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set("outreach_session", createSessionToken(user.id, user.tokenVersion), sessionCookieOptions());
    return response;
  } catch (error) {
    console.error("Signup error:", error);
    const msg = error instanceof Error ? error.message : "Unable to create account.";
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
    return NextResponse.json({ error: msg || "Unable to create account." }, { status: 500 });
  }
}
