# Hostinger ERP - Stable Production Configuration Runbook

> **Tag:** `v1.0-stable-production`  
> **Backup Branch:** `stable-backup`  
> **Commit Hash:** `fc98d1d`  
> **Production URL:** `https://hostinger-tau.vercel.app`  
> **Verified Date:** November 16, 2026

---

## 🛡️ Critical Architecture & Protection Rules

These rules **MUST NEVER** be reverted or broken in future updates:

### 1. Database & Cloud Serverless Resilience (`lib/config.ts` & `lib/prisma.ts`)
- **NEVER** set `process.env.DATABASE_URL = "mysql://...127.0.0.1:3307/..."` in cloud / Vercel environments.
- On Vercel / AWS Lambda, localhost does not exist. Injecting a localhost URL fools Prisma into attempting connection to `127.0.0.1:3307`, crashing all routes with `PrismaClientInitializationError: Can't reach database server`.
- When `DATABASE_URL` is unset on Vercel, `lib/prisma.ts` automatically and seamlessly delegates all Prisma model calls to `lib/fallback-db.ts` (the JSON resilient in-memory storage engine).
- **Rule in `lib/config.ts`:**
  ```ts
  const isCloud = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL_ENV);
  if (!isCloud && process.env.NODE_ENV !== "production" && !process.env.DATABASE_URL?.trim()) {
    process.env.DATABASE_URL = "mysql://shotinger_test_user:local-test-db-password@127.0.0.1:3307/shotinger_test";
  }
  ```

### 2. Prisma Promise & Transaction Integrity (`lib/prisma.ts`)
- Prisma `$transaction([ ... ])` strictly requires elements of the array to be **`PrismaPromise`** instances.
- **NEVER** wrap Prisma model methods in custom `async function (...args) { return await ... }` proxies. Wrapping turns `PrismaPromise` into a standard JavaScript `Promise`, causing `$transaction` to throw:
  `"All elements of the array need to be Prisma Client promises"`.
- Keep `originalProp` directly returned when `raw` Prisma is available.

### 3. Mailbox Real-Time Connection & Diagnostics (`app/api/mailboxes/route.ts`)
- `testMailboxConnections` verifies Hostinger SMTP (`smtp.hostinger.com:465`, TLS) and IMAP (`imap.hostinger.com:993`, TLS).
- If credentials fail (e.g. Code 535), the mailbox is saved with `status: "ERROR"` and a descriptive message:
  `Hostinger Password Rejected (Code 535): Invalid password or username for <email>. Check Hostinger hPanel -> Emails.`
- `lastError` is safely truncated to 490 characters to avoid MySQL `@db.VarChar(500)` truncation errors.
- Duplicate entries are caught cleanly with HTTP 409:
  `"A mailbox with this email address already exists."`

---

## 🔄 Emergency Restore Instructions

If anyone modifies code or accidentally breaks settings, restore this exact verified state with:

```bash
# Option A: Reset to the permanent stable tag
git fetch origin --tags
git checkout -B main v1.0-stable-production
git push origin main --force

# Option B: Reset to the stable backup branch
git checkout -B main origin/stable-backup
git push origin main --force
```

Vercel will immediately redeploy the clean, tested build `fc98d1d`.
