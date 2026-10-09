import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { syncUserMailboxes } from "@/lib/email/inbox-sync";

export async function POST(request: NextRequest) { try { const userId = await requireUser(request); const body = await request.json().catch(() => ({})); return NextResponse.json({ results: await syncUserMailboxes(userId, typeof body.mailboxId === "string" ? body.mailboxId : undefined) }); } catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to sync inbox." }, { status: 502 }); } }
