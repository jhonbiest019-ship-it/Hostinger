import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { syncAllMailboxes } from "@/lib/email/inbox-sync";

function authorized(request: NextRequest) { const configured = process.env.WORKER_TOKEN; const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-worker-token"); if (!configured || !received || configured.length !== received.length) return false; return crypto.timingSafeEqual(Buffer.from(configured), Buffer.from(received)); }
export async function POST(request: NextRequest) { if (!authorized(request)) return NextResponse.json({ error: "Worker authorization required." }, { status: 401 }); try { return NextResponse.json({ results: await syncAllMailboxes() }); } catch { return NextResponse.json({ error: "Inbox sync failed." }, { status: 502 }); } }
