import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { autoFormatGreetingWithBrand } from "@/lib/email/template";
import { z } from "zod";

const schema = z.object({
  name: z.string().trim().min(1).max(150),
  subject: z.string().trim().min(1).max(998),
  body: z.string().trim().min(1).max(100_000),
  isDefault: z.boolean().optional(),
});

const select = {
  id: true,
  name: true,
  subject: true,
  body: true,
  status: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;
    const template = await prisma.template.findFirst({
      where: { id, userId, status: "ACTIVE" },
      select,
    });
    if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    return NextResponse.json({ template });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to load template." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;
    const existing = await prisma.template.findFirst({
      where: { id, userId, status: "ACTIVE" },
      select: { id: true, isDefault: true },
    });
    if (!existing) return NextResponse.json({ error: "Template not found." }, { status: 404 });

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Template name, subject, and body are required.", fields: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    if (parsed.data.isDefault === true) {
      await prisma.template.updateMany({
        where: { userId, status: "ACTIVE" },
        data: { isDefault: false },
      });
    }

    const template = await prisma.template.update({
      where: { id },
      data: {
        name: parsed.data.name,
        subject: parsed.data.subject,
        body: autoFormatGreetingWithBrand(parsed.data.body),
        ...(parsed.data.isDefault !== undefined ? { isDefault: parsed.data.isDefault } : {}),
      },
      select,
    });
    return NextResponse.json({ template });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to update template." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUser(request);
    const { id } = await context.params;

    const existing = await prisma.template.findFirst({
      where: { id, userId, status: "ACTIVE" },
      select: { id: true, isDefault: true },
    });

    if (!existing) return NextResponse.json({ error: "Template not found." }, { status: 404 });

    await prisma.template.update({
      where: { id },
      data: { status: "ARCHIVED", isDefault: false },
    });

    // If deleted template was default, activate next active template if one exists
    if (existing.isDefault) {
      const nextActive = await prisma.template.findFirst({
        where: { userId, status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
      });
      if (nextActive) {
        await prisma.template.update({
          where: { id: nextActive.id },
          data: { isDefault: true },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to delete template." }, { status: 500 });
  }
}
