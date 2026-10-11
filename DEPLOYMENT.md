# Deployment Preparation

This project is prepared for a split deployment. Deployment is not performed by this repository.

## Runtime Split

### Vercel web application

Deploy the Next.js application and user-facing routes to Vercel:

- authentication pages and APIs
- contacts and CSV APIs
- templates and campaign management APIs
- mailbox CRUD and user-triggered connection tests
- composer and email-log pages
- authenticated dashboard and UI routes

The web application must receive the production environment variables through Vercel's server-only environment configuration. Do not expose secrets with `NEXT_PUBLIC_` variables.

### Persistent worker host

Run the standalone Node worker on a VPS or another persistent Node.js host:

```text
npm run worker
```

The worker directly calls `processDueJobs()` and `syncAllMailboxes()`. It does not call Vercel to perform queue work. It uses the existing database leases, claim tokens, retry policy, follow-up cancellation, and ambiguous-delivery safeguards.

The worker command uses `tsx`, which is a production dependency because the standalone worker must remain runnable when the worker host installs production dependencies only. Use `npm ci` on the worker host; do not use `npm ci --omit=dev` unless the worker is replaced by a separately compiled artifact.

For a scheduler that starts a short-lived process, use:

```text
WORKER_RUN_ONCE=true npm run worker:once
```

Use only one intentional scheduler strategy. Multiple schedulers are safe against duplicate claims through database leases, but they increase contention and operational complexity.

## Vercel Boundary

These routes are not suitable as the only persistent worker:

- `POST /api/worker/process`
- `POST /api/worker/inbox-sync`

They remain protected manual/integration endpoints, but Vercel execution duration, concurrency, and scheduling behavior depend on the Vercel plan. Long SMTP/IMAP operations must run in the standalone worker for reliable 24/7 processing.

Manual single-email sending and mailbox connection tests are request-based and remain subject to the deployed function timeout. Bulk/scheduled processing belongs to the standalone worker.

## Environment Separation

### Vercel web runtime

Required server-only variables:

- `DATABASE_URL`
- `APP_URL` using HTTPS
- `ENCRYPTION_KEY`
- `AUTH_SESSION_SECRET`
- `WORKER_TOKEN`
- `EMAIL_TEST_MODE=false`

### Worker host

Use the same database and security secrets as the web runtime, plus:

- `QUEUE_MAX_JOBS_PER_RUN`
- `QUEUE_MAX_ATTEMPTS`
- `QUEUE_DELAY_MS`
- `QUEUE_LEASE_MS`
- `WORKER_INTERVAL_MS` for persistent mode
- `WORKER_RUN_ONCE` for scheduler mode
- `WORKER_SKIP_INBOX_SYNC=false`

The worker host must not expose these variables to client-side code.

## Database Migration Procedure

1. Create a separate staging MySQL database.
2. Back it up before migration.
3. Configure staging `DATABASE_URL` only.
4. Run `npx prisma migrate deploy`.
5. Run `npx prisma validate` and `npx prisma generate`.
6. Run the safe queue and Phase 1-7 tests.
7. Test a staging backup restore.
8. Review the migration result and application smoke tests.
9. Back up production immediately before the approved production migration.
10. Run `npx prisma migrate deploy` against production.

Never use `prisma migrate reset` or destructive database commands.

## VPS Process Supervision

Use the host's process supervisor to keep `npm run worker` alive, restart it after failures, and capture stdout/stderr in a protected log destination. Configure graceful `SIGTERM` shutdown and ensure only one intended worker schedule is active.

The supervisor must not print environment values. Rotate logs and alert on repeated worker failures, database connection failures, and inbox-sync failures.

## Database and Network Requirements

Before deployment, verify the hosting provider supports:

- persistent MySQL connections from both runtimes
- MySQL TLS and least-privilege database users
- outbound SMTP and IMAP connections from the worker host
- HTTPS and secure cookies for the web runtime
- scheduled execution or a persistent process supervisor
- encrypted backups and tested restore procedures

Hoster-specific port limits, request duration, cron frequency, resource limits, and acceptable-use/email policies must be verified for the actual plan. This repository cannot verify an account-specific plan.

## GitHub Safety

The repository must remain private. Never commit `.env.local`, secrets, database dumps, local MySQL directories, private keys, or logs. Review `git diff --cached` before any future commit and push.

No GitHub repository, Vercel project, DNS record, or deployment is created by this preparation.
