import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { controlCampaign } from "@/lib/campaign-controls";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const userId = await requireUser(request); const { id } = await context.params; return NextResponse.json(await controlCampaign(userId, id, "cancel")); }
  catch (error) { if (error instanceof Response) return error; return NextResponse.json({ error: "Unable to cancel campaign." }, { status: 409 }); }
}
