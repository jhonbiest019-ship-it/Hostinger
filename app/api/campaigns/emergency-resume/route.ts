import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { emergencyResumeAll } from "@/lib/campaign-controls";

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const result = await emergencyResumeAll(userId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("emergency_resume_failed", error);
    return NextResponse.json(
      { error: "Failed to resume paused campaigns." },
      { status: 500 }
    );
  }
}
