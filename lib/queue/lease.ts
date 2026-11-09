import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

export async function acquireWorkerLease(name: string, durationMs: number) {
  const ownerToken = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + durationMs);
  const existing = await prisma.workerLease.findUnique({ where: { name }, select: { ownerToken: true, expiresAt: true } });
  if (!existing) {
    try { await prisma.workerLease.create({ data: { name, ownerToken, expiresAt } }); return ownerToken; } catch { /* Another worker created it; retry through the conditional update. */ }
  }
  const claimed = await prisma.workerLease.updateMany({ where: { name, expiresAt: { lte: new Date() } }, data: { ownerToken, expiresAt } });
  return claimed.count === 1 ? ownerToken : null;
}

export async function releaseWorkerLease(name: string, ownerToken: string) {
  await prisma.workerLease.updateMany({ where: { name, ownerToken }, data: { expiresAt: new Date() } });
}

export async function withWorkerLease<T>(name: string, durationMs: number, work: (ownerToken: string) => Promise<T>) {
  const ownerToken = await acquireWorkerLease(name, durationMs);
  if (!ownerToken) return { acquired: false as const };
  const heartbeat = setInterval(() => {
    void prisma.workerLease.updateMany({ where: { name, ownerToken }, data: { expiresAt: new Date(Date.now() + durationMs) } }).catch(() => undefined);
  }, Math.max(1000, Math.floor(durationMs / 3)));
  try { return { acquired: true as const, value: await work(ownerToken) }; } finally { clearInterval(heartbeat); await releaseWorkerLease(name, ownerToken); }
}
