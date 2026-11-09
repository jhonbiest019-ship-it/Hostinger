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

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";

    let templates = await prisma.template.findMany({
      where: {
        userId,
        status: "ACTIVE",
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { subject: { contains: search } },
                { body: { contains: search } },
              ],
            }
          : {}),
      },
      select,
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });

    // Auto-designate first template as active if none is currently active
    if (templates.length > 0 && !templates.some((t) => t.isDefault)) {
      const firstId = templates[0].id;
      await prisma.template.update({
        where: { id: firstId },
        data: { isDefault: true },
      });
      templates = templates.map((t, idx) => (idx === 0 ? { ...t, isDefault: true } : t));
    }

    return NextResponse.json({ templates });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to load templates." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Template name, subject, and body are required.", fields: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const existingCount = await prisma.template.count({
      where: { userId, status: "ACTIVE" },
    });

    const shouldBeDefault = parsed.data.isDefault || existingCount === 0;

    if (shouldBeDefault) {
      await prisma.template.updateMany({
        where: { userId, status: "ACTIVE" },
        data: { isDefault: false },
      });
    }

    const template = await prisma.template.create({
      data: {
        userId,
        name: parsed.data.name,
        subject: parsed.data.subject,
        body: autoFormatGreetingWithBrand(parsed.data.body),
        isDefault: shouldBeDefault,
      },
      select,
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to create template." }, { status: 500 });
  }
}
