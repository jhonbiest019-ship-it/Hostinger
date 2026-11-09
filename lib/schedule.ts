import { z } from "zod";

export const scheduleSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("sendNow"),
    delaySeconds: z.number().int().min(0).max(86400).optional(),
    mailboxId: z.string().optional(),
    templateId: z.string().optional(),
  }),
  z.object({
    mode: z.literal("schedule"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    timezone: z.string().min(1).max(100),
    delaySeconds: z.number().int().min(0).max(86400).optional(),
    mailboxId: z.string().optional(),
    templateId: z.string().optional(),
  }),
]);

export function isValidTimezone(timezone: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); return true; } catch { return false; }
}

export function localDateTimeToUtc(date: string, time: string, timezone: string) {
  if (!isValidTimezone(timezone)) throw new Error("Invalid timezone.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("Invalid scheduled date or time.");
  const candidate = new Date(`${date}T${time}:00.000Z`);
  if (Number.isNaN(candidate.getTime()) || candidate.toISOString().slice(0, 10) !== date) throw new Error("Invalid scheduled date or time.");
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const parts = (value: Date) => Object.fromEntries(formatter.formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = new Date(candidate.getTime() + hours * 3600000);
    const values = parts(sample);
    offsets.add(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute)) - sample.getTime());
  }
  const matches = [...offsets].map((offset) => new Date(candidate.getTime() - offset)).filter((value) => {
    const checked = parts(value);
    return `${checked.year}-${checked.month}-${checked.day}` === date && `${checked.hour}:${checked.minute}` === time;
  });
  if (!matches.length) throw new Error("This local time does not exist in the selected timezone. Choose a time after the clock change.");
  if (matches.length > 1) throw new Error("This local time occurs twice during a clock change. Choose another time or schedule in UTC.");
  return matches[0];
}

export function parseScheduledTimeToUtc(
  rawInput: string | Date | null | undefined,
  timezone: string = "Asia/Karachi"
): Date {
  if (!rawInput) return new Date();
  if (rawInput instanceof Date) return isNaN(rawInput.getTime()) ? new Date() : rawInput;

  const str = String(rawInput).trim();
  if (!str) return new Date();

  // If already full ISO with trailing Z or explicit offset (+05:00 / -05:00)
  if (/[Zz]$|[+-]\d{2}:\d{2}$/.test(str)) {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // Handle datetime-local or YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm (with optional :ss)
  const match = str.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  if (match) {
    const [, date, time] = match;
    try {
      return localDateTimeToUtc(date, time, timezone);
    } catch {
      // Fallback if localDateTimeToUtc throws edge-case error
      const fallback = new Date(`${date}T${time}:00`);
      return isNaN(fallback.getTime()) ? new Date() : fallback;
    }
  }

  const generic = new Date(str);
  return isNaN(generic.getTime()) ? new Date() : generic;
}

export function formatScheduledTime(
  value: Date | string | null | undefined,
  timezone: string = "Asia/Karachi"
): string {
  if (!value) return "—";
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone || "Asia/Karachi",
    }).format(d);
  } catch {
    return new Date(value).toLocaleString();
  }
}

export function queueConfig() { return { maxJobs: Math.min(Math.max(Number(process.env.QUEUE_MAX_JOBS_PER_RUN ?? 10) || 10, 1), 100), maxAttempts: Math.min(Math.max(Number(process.env.QUEUE_MAX_ATTEMPTS ?? 3) || 3, 1), 10), delayMs: Math.min(Math.max(Number(process.env.QUEUE_DELAY_MS ?? 1500), 0), 60_000), leaseMs: Math.min(Math.max(Number(process.env.QUEUE_LEASE_MS ?? 120_000) || 120_000, 10_000), 900_000) }; }
