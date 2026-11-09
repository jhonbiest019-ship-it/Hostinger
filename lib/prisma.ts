import { PrismaClient } from "@prisma/client";
import { createFallbackModel } from "./fallback-db";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; rawPrisma?: PrismaClient };

const rawPrisma = globalForPrisma.rawPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.rawPrisma = rawPrisma;

function isConnectionError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err.code || err);
  return (
    msg.includes("P1001") ||
    msg.includes("P1000") ||
    msg.includes("Can't reach database") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("connect") ||
    msg.includes("Environment variable not found") ||
    msg.includes("Authentication failed") ||
    msg.includes("database server") ||
    msg.includes("not connected")
  );
}

const fallbackModels: Record<string, any> = {};

function getFallbackModel(prop: string) {
  if (!fallbackModels[prop]) {
    fallbackModels[prop] = createFallbackModel(prop);
  }
  return fallbackModels[prop];
}

export const prisma = new Proxy(rawPrisma as any, {
  get(target, prop, receiver) {
    if (typeof prop !== "string") {
      return Reflect.get(target, prop, receiver);
    }

    if (prop === "$transaction") {
      return async function (arg: any) {
        try {
          return await target.$transaction(arg);
        } catch (err) {
          if (isConnectionError(err)) {
            if (Array.isArray(arg)) {
              return Promise.all(arg);
            }
            if (typeof arg === "function") {
              return await arg(prisma);
            }
          }
          throw err;
        }
      };
    }

    if (prop === "$connect") {
      return async () => {
        try {
          return await target.$connect();
        } catch {}
      };
    }

    if (prop === "$disconnect") {
      return async () => {
        try {
          return await target.$disconnect();
        } catch {}
      };
    }

    const originalProp = Reflect.get(target, prop, receiver);

    // If accessing a model property (e.g. user, contact, mailbox, campaign, etc.)
    if (originalProp && typeof originalProp === "object") {
      const fallback = getFallbackModel(prop);
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
            try {
              return await originalMethod.apply(modelTarget, args);
            } catch (err) {
              if (isConnectionError(err)) {
                const fallbackMethod = fallback[method];
                if (typeof fallbackMethod === "function") {
                  return await fallbackMethod.apply(fallback, args);
                }
              }
              throw err;
            }
          };
        },
      });
    }

    // Direct fallback for models not yet instantiated on rawPrisma
    if (!originalProp && typeof prop === "string" && !prop.startsWith("$") && !prop.startsWith("_")) {
      return getFallbackModel(prop);
    }

    return originalProp;
  },
}) as PrismaClient;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
