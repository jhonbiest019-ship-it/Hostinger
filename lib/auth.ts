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

export function createSessionToken(userId: string, maxAgeSeconds = 60 * 60 * 24 * 7) {
  const expiresAt = Date.now() + maxAgeSeconds * 1000;
  const value = `${userId}.${expiresAt}`;
  return `${value}.${crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url")}`;
}

export function sessionCookieOptions(maxAge = 60 * 60 * 24 * 7) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}

export async function getAuthenticatedUserId(token: string | undefined) {
  if (!token) return null;
  const [userId, expiresAt, signature] = token.split(".");
  if (!userId || !expiresAt || !signature || Number(expiresAt) < Date.now() || !validSignature(`${userId}.${expiresAt}`, signature)) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user?.id ?? null;
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
