import { PrismaClient } from "@prisma/client";
import { createFallbackModel } from "./fallback-db";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; rawPrisma?: PrismaClient | null };

let rawPrisma: PrismaClient | null = null;
try {
  rawPrisma = globalForPrisma.rawPrisma ?? new PrismaClient();
  if (process.env.NODE_ENV !== "production") globalForPrisma.rawPrisma = rawPrisma;
} catch (e) {
  console.warn("PrismaClient initialization skipped:", e);
}

let fallbackActive = Boolean(
  !rawPrisma ||
  !process.env.DATABASE_URL ||
  (process.env.VERCEL && (process.env.DATABASE_URL.includes("localhost") || process.env.DATABASE_URL.includes("127.0.0.1")))
);

const fallbackModels: Record<string, any> = {};

function getFallbackModel(prop: string) {
  if (!fallbackModels[prop]) {
    fallbackModels[prop] = createFallbackModel(prop);
  }
  return fallbackModels[prop];
}

export const prisma = new Proxy((rawPrisma ?? {}) as any, {
  get(target, prop, receiver) {
    if (typeof prop !== "string") {
      return Reflect.get(target, prop, receiver);
    }

    if (prop === "$transaction") {
      return async function (arg: any) {
        if (fallbackActive || !rawPrisma) {
          if (Array.isArray(arg)) {
            return Promise.all(arg);
          }
          if (typeof arg === "function") {
            return await arg(prisma);
          }
        }
        try {
          return await target.$transaction(arg);
        } catch (err: any) {
          console.warn("Prisma transaction failed, falling back:", err?.message || err);
          fallbackActive = true;
          if (Array.isArray(arg)) {
            return Promise.all(arg);
          }
          if (typeof arg === "function") {
            return await arg(prisma);
          }
          throw err;
        }
      };
    }

    if (prop === "$connect") {
      return async () => {
        if (fallbackActive || !rawPrisma) return;
        try {
          return await target.$connect();
        } catch {}
      };
    }

    if (prop === "$disconnect") {
      return async () => {
        if (fallbackActive || !rawPrisma) return;
        try {
          return await target.$disconnect();
        } catch {}
      };
    }

    const fallback = getFallbackModel(prop);

    if (fallbackActive || !rawPrisma) {
      return fallback;
    }

    const originalProp = Reflect.get(target, prop, receiver);

    // If accessing a model property (e.g. user, contact, mailbox, campaign, etc.)
    if (originalProp && typeof originalProp === "object") {
      return new Proxy(originalProp, {
        get(modelTarget, method, methodReceiver) {
          if (typeof method !== "string") {
            return Reflect.get(modelTarget, method, methodReceiver);
          }

          const originalMethod = Reflect.get(modelTarget, method, methodReceiver);
          if (typeof originalMethod !== "function") {
            return originalMethod;
          }

          return async function (...args: any[]) {
            if (fallbackActive) {
              const fallbackMethod = fallback[method];
              if (typeof fallbackMethod === "function") {
                return await fallbackMethod.apply(fallback, args);
              }
            }

            try {
              return await originalMethod.apply(modelTarget, args);
            } catch (err: any) {
              console.warn(
                `Prisma query failed on ${prop}.${method}, falling back to resilient store:`,
                err?.message || err
              );
              fallbackActive = true;
              const fallbackMethod = fallback[method];
              if (typeof fallbackMethod === "function") {
                return await fallbackMethod.apply(fallback, args);
              }
              throw err;
            }
          };
        },
      });
    }

    // Direct fallback for models not yet instantiated on rawPrisma
    if (typeof prop === "string" && !prop.startsWith("$") && !prop.startsWith("_")) {
      return fallback;
    }

    return originalProp;
  },
}) as PrismaClient;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
