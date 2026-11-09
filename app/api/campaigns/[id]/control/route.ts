import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { controlCampaign } from "@/lib/campaign-controls";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser(request); const { id } = await context.params;
    const { action } = await request.json();
    if (!["pause", "resume", "cancel"].includes(action)) return NextResponse.json({ error: "Choose pause, resume or cancel." }, { status: 400 });
    return NextResponse.json(await controlCampaign(userId, id, action));
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to change campaign state. Refresh and check its current status." }, { status: 409 });
  }
}
