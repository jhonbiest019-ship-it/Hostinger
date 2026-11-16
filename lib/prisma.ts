import { PrismaClient } from "@prisma/client";
import { createFallbackModel } from "./fallback-db";

// Ensure .env.local is loaded if DATABASE_URL is not yet in process.env
if (!process.env.DATABASE_URL) {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const dotenv = require("dotenv");
    const envLocal = path.join(process.cwd(), ".env.local");
    if (fs.existsSync(envLocal)) {
      dotenv.config({ path: envLocal });
    }
    const envBase = path.join(process.cwd(), ".env");
    if (fs.existsSync(envBase)) {
      dotenv.config({ path: envBase });
    }
  } catch {}
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; rawPrisma?: PrismaClient | null };

function getRawPrisma(): PrismaClient | null {
  if (globalForPrisma.rawPrisma) return globalForPrisma.rawPrisma;
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) return null;

  // If in cloud serverless (Vercel, AWS Lambda) and the URL points to localhost or 127.0.0.1,
  // skip Prisma initialization — local server is unreachable in cloud containers.
  const isCloudServerless = Boolean(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT ||
    process.env.VERCEL_ENV
  );
  if (isCloudServerless && (dbUrl.includes("127.0.0.1") || dbUrl.includes("localhost"))) {
    console.warn("[PRISMA] Cloud serverless environment detected with localhost DATABASE_URL. Switching to resilient fallback storage.");
    return null;
  }

  try {
    const client = new PrismaClient();
    if (process.env.NODE_ENV !== "production") globalForPrisma.rawPrisma = client;
    return client;
  } catch (e) {
    console.warn("PrismaClient initialization skipped:", e);
    return null;
  }
}

const fallbackModels: Record<string, any> = {};

function getFallbackModel(prop: string) {
  if (!fallbackModels[prop]) {
    fallbackModels[prop] = createFallbackModel(prop);
  }
  return fallbackModels[prop];
}

export const prisma = new Proxy({} as any, {
  get(_target, prop, receiver) {
    if (typeof prop !== "string") {
      return Reflect.get({}, prop, receiver);
    }

    const raw = getRawPrisma();

    if (prop === "$transaction") {
      return async function (arg: any) {
        if (!raw) {
          if (Array.isArray(arg)) return Promise.all(arg);
          if (typeof arg === "function") return await arg(prisma);
          throw new Error("No database connection available for transaction.");
        }
        return await raw.$transaction(arg);
      };
    }

    if (prop === "$connect") {
      return async () => {
        if (!raw) return;
        try { return await raw.$connect(); } catch {}
      };
    }

    if (prop === "$disconnect") {
      return async () => {
        if (!raw) return;
        try { return await raw.$disconnect(); } catch {}
      };
    }

    if (!raw) {
      return getFallbackModel(prop);
    }

    const originalProp = Reflect.get(raw, prop, receiver);

    // If accessing a model property (e.g. user, contact, mailbox, campaign, etc.)
    if (originalProp && typeof originalProp === "object") {
      return originalProp;
    }

    // Direct fallback for models not yet instantiated on rawPrisma
    if (typeof prop === "string" && !prop.startsWith("$") && !prop.startsWith("_")) {
      return getFallbackModel(prop);
    }

    return originalProp;
  },
}) as PrismaClient;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
