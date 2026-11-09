import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;

    const target = await prisma.template.findFirst({
      where: { id, userId, status: "ACTIVE" },
      select: { id: true, name: true, subject: true, body: true, status: true, isDefault: true },
    });

    if (!target) {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.template.updateMany({
        where: { userId, status: "ACTIVE" },
        data: { isDefault: false },
      }),
      prisma.template.update({
        where: { id },
        data: { isDefault: true },
      }),
      prisma.campaign.updateMany({
        where: { userId, status: { in: ["DRAFT", "READY", "SCHEDULED", "SENDING", "ACTIVE", "PAUSED"] } },
        data: { templateId: id },
      }),
    ]);

    return NextResponse.json({
      success: true,
      activeTemplateId: id,
      template: { ...target, isDefault: true },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to activate template." }, { status: 500 });
  }
}
