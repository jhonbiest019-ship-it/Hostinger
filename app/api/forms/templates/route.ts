import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const templates = await prisma.formTemplate.findMany({
      where: { userId, status: "ACTIVE" },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ templates });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to load form templates." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    const body = await request.json();
    const { name, description, fields, isDefault } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Template name is required." }, { status: 400 });
    }

    if (isDefault) {
      await prisma.formTemplate.updateMany({
        where: { userId, status: "ACTIVE" },
        data: { isDefault: false },
      });
    }

    const template = await prisma.formTemplate.create({
      data: {
        userId,
        name: name.trim(),
        description: description?.trim() || null,
        fieldsJson: typeof fields === "string" ? fields : JSON.stringify(fields || {}),
        isDefault: Boolean(isDefault),
        status: "ACTIVE",
      },
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Unable to create form template." }, { status: 500 });
  }
}
