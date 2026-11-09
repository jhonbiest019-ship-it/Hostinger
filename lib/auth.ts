import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

function sessionSecret() {
  const value = process.env.AUTH_SESSION_SECRET;
  if (!value) throw new Error("AUTH_SESSION_SECRET is not configured.");
  return value;
}

function validSignature(value: string, signature: string) {
  const expected = crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = await new Promise<Buffer>((resolve, reject) => crypto.scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1 }, (error, result) => error ? reject(error) : resolve(result)));
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, expected] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const actual = await new Promise<Buffer>((resolve, reject) => crypto.scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1 }, (error, result) => error ? reject(error) : resolve(result)));
  const expectedBuffer = Buffer.from(expected, "base64url");
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(expectedBuffer, actual);
}

export function generateVerificationCode(length = 6): string {
  const digits = "0123456789";
  let code = "";
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += digits[randomBytes[i] % digits.length];
  }
  return code;
}

// In-memory sliding window rate limiter
type RateLimitRecord = { count: number; resetAt: number };
const rateLimitMap = new Map<string, RateLimitRecord>();

export function checkRateLimit(
  key: string,
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || record.resetAt <= now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1, retryAfterSeconds: 0 };
  }

  if (record.count >= maxAttempts) {
    const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  record.count += 1;
  return { allowed: true, remaining: maxAttempts - record.count, retryAfterSeconds: 0 };
}

export function resetRateLimit(key: string) {
  rateLimitMap.delete(key);
}

export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1"
  );
}

export async function logSecurityEvent(
  action: string,
  userId: string | null,
  details: Record<string, any>,
  request?: NextRequest
) {
  try {
    const ipAddress = request ? getClientIp(request) : null;
    const userAgent = request?.headers.get("user-agent") || null;
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        ipAddress,
        userAgent,
        details: JSON.stringify(details),
      },
    });
  } catch (err) {
    console.warn("Failed to write audit log:", err);
  }
}

export async function revokeUserSessions(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
}

export function createSessionToken(userId: string, tokenVersion = 1, maxAgeSeconds = 60 * 60 * 24 * 7) {
  const expiresAt = Date.now() + maxAgeSeconds * 1000;
  const value = `${userId}.${tokenVersion}.${expiresAt}`;
  return `${value}.${crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url")}`;
}

export function sessionCookieOptions(maxAge = 60 * 60 * 24 * 7) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}

export async function getAuthenticatedUserId(token: string | undefined) {
  if (!token) return null;
  const parts = token.split(".");

  // Modern versioned 4-part token: userId.tokenVersion.expiresAt.signature
  if (parts.length === 4) {
    const [userId, tokenVersion, expiresAt, signature] = parts;
    if (!userId || !tokenVersion || !expiresAt || !signature || Number(expiresAt) < Date.now()) return null;
    if (!validSignature(`${userId}.${tokenVersion}.${expiresAt}`, signature)) return null;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tokenVersion: true },
    });
    if (!user || user.tokenVersion !== Number(tokenVersion)) return null;
    return user.id;
  }

  // Backwards-compatible legacy 3-part token: userId.expiresAt.signature
  if (parts.length === 3) {
    const [userId, expiresAt, signature] = parts;
    if (!userId || !expiresAt || !signature || Number(expiresAt) < Date.now()) return null;
    if (!validSignature(`${userId}.${expiresAt}`, signature)) return null;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    return user?.id ?? null;
  }

  return null;
}

export async function requireUser(request: NextRequest) {
  const token = request.cookies.get("outreach_session")?.value;
  const userId = await getAuthenticatedUserId(token);
  if (!userId) throw new Response(JSON.stringify({ error: "Authentication required." }), { status: 401, headers: { "content-type": "application/json" } });
  return userId;
}

export function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "connection failed";
  if (message.includes("auth") || message.includes("password") || message.includes("credential")) return "Authentication failed. Check the mailbox username and password.";
  if (message.includes("timeout") || message.includes("timed out")) return "The mailbox server timed out. Check the host, port, and network.";
  if (message.includes("tls") || message.includes("ssl")) return "Secure connection failed. Check the selected security mode and port.";
  if (message.includes("encryption")) return "Mailbox security configuration is unavailable.";
  return "The mailbox connection could not be completed. Check the server settings and try again.";
}
