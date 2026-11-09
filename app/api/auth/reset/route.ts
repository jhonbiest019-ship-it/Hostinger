import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  createSessionToken,
  generateVerificationCode,
  getClientIp,
  hashPassword,
  logSecurityEvent,
  resetRateLimit,
  sessionCookieOptions,
} from "@/lib/auth";
import { z } from "zod";

const requestSchema = z.object({
  email: z.string().trim().email().max(255),
});

const confirmSchema = z.object({
  email: z.string().trim().email().max(255),
  code: z.string().trim().min(4).max(10),
  password: z.string().min(6).max(128),
});

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();

    // Mode 1: Confirm reset with verification code
    if (body.code) {
      const parsed = confirmSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Provide a valid email, verification code, and new password of at least 6 characters." },
          { status: 400 }
        );
      }

      const rateLimitKey = `reset-verify:${ip}:${email}`;
      const rateCheck = checkRateLimit(rateLimitKey, 5, 15 * 60 * 1000);
      if (!rateCheck.allowed) {
        await logSecurityEvent("PASSWORD_RESET_RATE_LIMITED", null, { email }, request);
        return NextResponse.json(
          { error: `Too many attempts. Please wait ${rateCheck.retryAfterSeconds} seconds before trying again.` },
          { status: 429 }
        );
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.resetCode || !user.resetExpires || user.resetExpires < new Date()) {
        await logSecurityEvent("PASSWORD_RESET_INVALID_CODE", user?.id ?? null, { email }, request);
        return NextResponse.json(
          { error: "The verification code is invalid or has expired. Please request a new code." },
          { status: 400 }
        );
      }

      if (user.resetCode !== parsed.data.code.trim()) {
        await logSecurityEvent("PASSWORD_RESET_WRONG_CODE", user.id, { email }, request);
        return NextResponse.json({ error: "Invalid verification code. Please check and try again." }, { status: 400 });
      }

      const passwordHash = await hashPassword(parsed.data.password);
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          resetCode: null,
          resetExpires: null,
          tokenVersion: { increment: 1 }, // Revoke all other active sessions server-wide
        },
        select: { id: true, name: true, email: true, tokenVersion: true },
      });

      resetRateLimit(rateLimitKey);
      await logSecurityEvent("PASSWORD_RESET_SUCCESS", updatedUser.id, { email }, request);

      const response = NextResponse.json({
        success: true,
        user: { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email },
        message: "Password reset successfully. All existing sessions have been secured.",
      });
      response.cookies.set(
        "outreach_session",
        createSessionToken(updatedUser.id, updatedUser.tokenVersion),
        sessionCookieOptions()
      );
      return response;
    }

    // Mode 2: Request verification code
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    const rateLimitKey = `reset-req:${ip}`;
    const rateCheck = checkRateLimit(rateLimitKey, 5, 15 * 60 * 1000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Too many password reset requests. Please wait ${rateCheck.retryAfterSeconds} seconds.` },
        { status: 429 }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Safe response to prevent user enumeration
      return NextResponse.json({
        success: true,
        requiresCode: true,
        message: "If an account exists with this email, a verification code has been generated.",
      });
    }

    const code = generateVerificationCode(6);
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await prisma.user.update({
      where: { id: user.id },
      data: { resetCode: code, resetExpires: expires },
    });

    await logSecurityEvent("PASSWORD_RESET_REQUESTED", user.id, { email }, request);

    return NextResponse.json({
      success: true,
      requiresCode: true,
      verificationCode: process.env.NODE_ENV !== "production" ? code : undefined,
      message: `Verification code generated for ${email}. Enter the code and your new password.`,
    });
  } catch (error) {
    console.error("Password reset error:", error);
    return NextResponse.json({ error: "Unable to process password reset." }, { status: 500 });
  }
}
