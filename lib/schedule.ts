import { z } from "zod";

export const scheduleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("sendNow") }),
  z.object({ mode: z.literal("schedule"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/), timezone: z.string().min(1).max(100) }),
]);

export function isValidTimezone(timezone: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); return true; } catch { return false; }
}

export function localDateTimeToUtc(date: string, time: string, timezone: string) {
  if (!isValidTimezone(timezone)) throw new Error("Invalid timezone.");
  const candidate = new Date(`${date}T${time}:00.000Z`);
  if (Number.isNaN(candidate.getTime())) throw new Error("Invalid scheduled date or time.");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(candidate);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const displayedAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
  const result = new Date(candidate.getTime() - (displayedAsUtc - candidate.getTime()));
  const check = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(result);
  const checked = Object.fromEntries(check.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  if (`${checked.year}-${checked.month}-${checked.day}` !== date || `${checked.hour}:${checked.minute}` !== time) throw new Error("This local time does not exist in the selected timezone.");
  return result;
}

export function queueConfig() { return { maxJobs: Math.min(Math.max(Number(process.env.QUEUE_MAX_JOBS_PER_RUN ?? 10) || 10, 1), 100), maxAttempts: Math.min(Math.max(Number(process.env.QUEUE_MAX_ATTEMPTS ?? 3) || 3, 1), 10), delayMs: Math.min(Math.max(Number(process.env.QUEUE_DELAY_MS ?? 1500) || 1500, 0), 60_000), leaseMs: Math.min(Math.max(Number(process.env.QUEUE_LEASE_MS ?? 120_000) || 120_000, 10_000), 900_000) }; }
