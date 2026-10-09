const attempts = new Map<string, { count: number; resetAt: number }>();

export function connectionRateLimit(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + 60_000 }); return true; }
  if (current.count >= 5) return false;
  current.count += 1;
  return true;
}
