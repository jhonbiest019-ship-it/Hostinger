import zlib from "node:zlib";
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

function getVaultSecret(): string {
  return process.env.AUTH_SESSION_SECRET || "shotinger-session-secret-fallback-key-2026";
}

export interface VaultState {
  users?: Array<{
    id: string;
    email: string;
    name?: string | null;
    passwordHash?: string;
    emailVerified?: boolean;
    tokenVersion?: number;
    createdAt?: string | Date;
    updatedAt?: string | Date;
  }>;
  mailboxes?: Array<{
    id: string;
    userId?: string;
    displayName?: string | null;
    emailAddress: string;
    username?: string | null;
    encryptedCredentials?: string | null;
    smtpHost: string;
    smtpPort: number;
    smtpSecurity: string;
    imapHost?: string | null;
    imapPort?: number | null;
    imapSecurity?: string | null;
    status: string;
    smtpStatus: string;
    imapStatus: string;
    lastError?: string | null;
    lastCheckedAt?: string | Date | null;
    lastSuccessfulAt?: string | Date | null;
    createdAt?: string | Date;
    updatedAt?: string | Date;
  }>;
  templates?: Array<{
    id: string;
    userId?: string;
    name: string;
    subject: string;
    body: string;
    status: string;
    isDefault?: boolean;
    createdAt?: string | Date;
    updatedAt?: string | Date;
  }>;
  activeMailboxId?: string | null;
  timestamp?: number;
}

export function serializeVault(state: VaultState): string {
  try {
    const compact: VaultState = {
      users: (state.users || []).slice(0, 20).map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        passwordHash: u.passwordHash,
        emailVerified: u.emailVerified ?? true,
        tokenVersion: u.tokenVersion ?? 1,
      })),
      mailboxes: (state.mailboxes || []).slice(0, 20).map((m) => ({
        id: m.id,
        userId: m.userId,
        displayName: m.displayName,
        emailAddress: m.emailAddress,
        username: m.username,
        encryptedCredentials: m.encryptedCredentials,
        smtpHost: m.smtpHost,
        smtpPort: m.smtpPort,
        smtpSecurity: m.smtpSecurity,
        imapHost: m.imapHost,
        imapPort: m.imapPort,
        imapSecurity: m.imapSecurity,
        status: m.status,
        smtpStatus: m.smtpStatus,
        imapStatus: m.imapStatus,
        lastError: m.lastError ? m.lastError.slice(0, 120) : null,
      })),
      templates: (state.templates || []).slice(0, 20).map((t) => ({
        id: t.id,
        userId: t.userId,
        name: t.name,
        subject: t.subject,
        body: t.body,
        status: t.status,
        isDefault: t.isDefault,
      })),
      activeMailboxId: state.activeMailboxId || null,
      timestamp: Date.now(),
    };

    const json = JSON.stringify(compact);
    const compressed = zlib.deflateSync(Buffer.from(json, "utf8")).toString("base64url");
    const signature = crypto
      .createHmac("sha256", getVaultSecret())
      .update(compressed)
      .digest("base64url");

    return `${compressed}.${signature}`;
  } catch (err) {
    console.warn("Failed to serialize vault:", err);
    return "";
  }
}

export function deserializeVault(token: string | undefined | null): VaultState | null {
  if (!token || typeof token !== "string") return null;
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const compressed = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  if (!compressed || !signature) return null;

  try {
    const expectedSig = crypto
      .createHmac("sha256", getVaultSecret())
      .update(compressed)
      .digest("base64url");

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const decompressed = zlib.inflateSync(Buffer.from(compressed, "base64url")).toString("utf8");
    return JSON.parse(decompressed) as VaultState;
  } catch (err) {
    return null;
  }
}

export const VAULT_COOKIE_NAME = "_shotinger_vault";

export function extractVaultFromRequest(request: NextRequest): VaultState | null {
  const cookieVal = request.cookies.get(VAULT_COOKIE_NAME)?.value;
  if (cookieVal) {
    const fromCookie = deserializeVault(cookieVal);
    if (fromCookie) return fromCookie;
  }

  const headerVal = request.headers.get("x-shotinger-vault");
  if (headerVal) {
    return deserializeVault(headerVal);
  }

  return null;
}

export function attachVaultToResponse(response: NextResponse, state: VaultState) {
  const token = serializeVault(state);
  if (!token) return;

  response.cookies.set(VAULT_COOKIE_NAME, token, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
}
