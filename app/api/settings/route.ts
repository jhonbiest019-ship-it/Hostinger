import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, hashPassword, verifyPassword } from "@/lib/auth";
import { isValidTimezone } from "@/lib/schedule";
import { connectionRateLimit } from "@/lib/rate-limit";

const fields = { name: true, email: true, timezone: true } as const;
const schema = z.object({
  name: z.string().trim().min(1).max(100),
  timezone: z.string().max(100).refine(isValidTimezone, "Select a valid timezone."),
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(10).max(200).optional(),
});
export async function GET(request: NextRequest) {
  try {
    const id = await requireUser(request);
    const settings = await prisma.user.findUniqueOrThrow({ where: { id }, select: fields });
    return NextResponse.json({ settings, testMode: process.env.EMAIL_TEST_MODE === "true" });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to load settings. Check the database connection and migrations." }, { status: 500 });
  }
}
export async function PUT(request: NextRequest) {
  try {
    const id = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const { name, timezone, currentPassword, newPassword } = parsed.data;
    let passwordHash: string | undefined;
    if (newPassword) {
      if (!connectionRateLimit(`password:${id}`)) return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429 });
      const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: { passwordHash: true } });
      if (!currentPassword || !user.passwordHash || !await verifyPassword(currentPassword, user.passwordHash)) return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
      passwordHash = await hashPassword(newPassword);
    }
    const settings = await prisma.user.update({ where: { id }, data: { name, timezone, ...(passwordHash ? { passwordHash } : {}) }, select: fields });
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to save settings. Please try again." }, { status: 500 });
  }
}
