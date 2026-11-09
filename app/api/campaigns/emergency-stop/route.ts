import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { emergencyStopAll } from "@/lib/campaign-controls";

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    let action: "pause" | "cancel" = "pause";
    try {
      const body = await request.json();
      if (body.action === "cancel") action = "cancel";
    } catch {
      // default to pause
    }
    const result = await emergencyStopAll(userId, action);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("emergency_stop_failed", error);
    return NextResponse.json(
      { error: "Failed to trigger emergency stop. Check database connectivity." },
      { status: 500 }
    );
  }
}
