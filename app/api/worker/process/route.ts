import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { processDueJobs } from "@/lib/queue/worker";

function authorized(request: NextRequest) { const configured = process.env.WORKER_TOKEN; const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-worker-token"); if (!configured || !received || configured.length !== received.length) return false; return crypto.timingSafeEqual(Buffer.from(configured), Buffer.from(received)); }
export async function POST(request: NextRequest) { if (!authorized(request)) return NextResponse.json({ error: "Worker authorization required." }, { status: 401 }); try { return NextResponse.json(await processDueJobs()); } catch { return NextResponse.json({ error: "Worker run failed." }, { status: 500 }); } }
