import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const { id } = body;

    if (!id) return NextResponse.json({ error: "Message id required." }, { status: 400 });

    const updated = await prisma.emailMessage.updateMany({
      where: { id, userId, errorMessage: "TRASH" },
      data: { errorMessage: null },
    });

    if (!updated.count) {
      return NextResponse.json({ error: "Message not found in trash." }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Message restored to inbox." });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to restore message." }, { status: 500 });
  }
}
