import { prisma } from "../lib/prisma";
import { acquireWorkerLease, releaseWorkerLease } from "../lib/queue/lease";
import { claimDueJob, recoverExpiredJobs } from "../lib/queue/worker";
import { assertSafeTestDatabase } from "./test-safety";

function past() { return new Date(Date.now() - 10_000); }
function check(name: string, condition: boolean) { if (!condition) throw new Error(`${name} failed.`); }

async function main() {
  assertSafeTestDatabase();
  const user = await prisma.user.create({ data: { email: `queue-safety-${Date.now()}@example.test`, name: "Queue Safety Test" } });
  const safeJob = await prisma.scheduledJob.create({ data: { userId: user.id, runAt: past(), status: "PROCESSING", deliveryState: "NOT_STARTED", leaseToken: "stale-safe-token", leaseExpiresAt: past() } });
  const ambiguousJob = await prisma.scheduledJob.create({ data: { userId: user.id, runAt: past(), status: "PROCESSING", deliveryState: "IN_FLIGHT", leaseToken: "stale-ambiguous-token", leaseExpiresAt: past() } });
  const recovery = await recoverExpiredJobs(); const recoveredSafe = await prisma.scheduledJob.findUnique({ where: { id: safeJob.id } }); const recoveredAmbiguous = await prisma.scheduledJob.findUnique({ where: { id: ambiguousJob.id } });
  check("safe stale job requeued", recoveredSafe?.status === "PENDING" && recoveredSafe.deliveryState === "NOT_STARTED"); check("ambiguous stale job not retried", recoveredAmbiguous?.status === "FAILED" && recoveredAmbiguous.deliveryState === "UNKNOWN"); check("recovery counted jobs", recovery.requeued >= 1 && recovery.ambiguous >= 1);
  const claimJob = await prisma.scheduledJob.create({ data: { userId: user.id, runAt: past(), status: "PENDING" } }); const claims = await Promise.all([claimDueJob(claimJob.id), claimDueJob(claimJob.id)]); check("concurrent claim has one winner", claims.filter(Boolean).length === 1); const winner = claims.find(Boolean); check("claim token persisted", Boolean(winner && (await prisma.scheduledJob.findUnique({ where: { id: claimJob.id }, select: { leaseToken: true } }))?.leaseToken === winner));
  const leaseName = `queue-safety-${Date.now()}`; const owner = await acquireWorkerLease(leaseName, 60_000); const blocked = await acquireWorkerLease(leaseName, 60_000); check("worker lease exclusive", Boolean(owner) && blocked === null); if (!owner) throw new Error("lease owner missing"); await releaseWorkerLease(leaseName, "wrong-owner"); check("wrong owner cannot release", Boolean((await prisma.workerLease.findUnique({ where: { name: leaseName } }))?.ownerToken === owner)); await releaseWorkerLease(leaseName, owner); check("owner can release", (await prisma.workerLease.findUnique({ where: { name: leaseName } }))?.expiresAt.getTime()! <= Date.now());
  console.log(JSON.stringify({ status: "PASS", checks: ["stale-safe-recovery", "ambiguous-delivery-no-retry", "concurrent-claim", "lease-ownership"] }));
}

main().catch((error) => { console.error(JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : "queue safety test failed" })); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
