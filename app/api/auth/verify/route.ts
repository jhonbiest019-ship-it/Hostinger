import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUserId, logSecurityEvent } from "@/lib/auth";
import { z } from "zod";

const schema = z.object({
  code: z.string().trim().min(4).max(10),
});

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get("outreach_session")?.value;
    const userId = await getAuthenticatedUserId(token);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Please enter a valid verification code." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    if (user.emailVerified) {
      return NextResponse.json({ success: true, message: "Email is already verified." });
    }

    if (!user.verificationCode || !user.verificationExpires || user.verificationExpires < new Date()) {
      return NextResponse.json(
        { error: "Verification code has expired or is invalid. Please request a new code." },
        { status: 400 }
      );
    }

    if (user.verificationCode !== parsed.data.code.trim()) {
      await logSecurityEvent("EMAIL_VERIFY_WRONG_CODE", user.id, {}, request);
      return NextResponse.json({ error: "Incorrect verification code. Please check and try again." }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verificationCode: null,
        verificationExpires: null,
      },
    });

    await logSecurityEvent("EMAIL_VERIFY_SUCCESS", user.id, { email: user.email }, request);

    return NextResponse.json({ success: true, message: "Email verified successfully!" });
  } catch (error) {
    console.error("Verification error:", error);
    return NextResponse.json({ error: "Unable to verify email." }, { status: 500 });
  }
}
