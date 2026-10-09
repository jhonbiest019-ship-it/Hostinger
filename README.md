# Outreach Studio

Phase 7 foundation for a professional outreach and follow-up SaaS. This project includes secure account sessions, contact/brand management, CSV import, mailbox SMTP/IMAP verification, templates, manual email sending, delivery logs, controlled campaigns, a server-side queue worker, follow-up sequences, and conservative IMAP reply detection.

## Setup

1. Install Node.js 20+ and MySQL.
2. Copy `.env.example` to `.env.local` and provide `DATABASE_URL`, `APP_URL`, a strong `ENCRYPTION_KEY`, and `AUTH_SESSION_SECRET`.
3. Run `npm install`.
4. Run `npm run prisma:generate` and `npm run prisma:validate`.
5. Run `npm run dev`.

All mailbox/contact/campaign records include a `userId` ownership boundary. Mailbox passwords are encrypted with AES-256-GCM before storage and are never returned to clients. Mailbox APIs require an authenticated, signed `outreach_session` cookie from the application authentication layer.

## Contacts and CSV

Contacts are scoped to the signed-in user. CSV files are limited to 5 MB and 1,000 rows in the UI and server import endpoint. Common headers such as `Brand Name`, `Company`, `Email`, `Form URL`, and `Website` are mapped automatically. Invalid email rows are shown in the preview and excluded by server validation. Duplicate emails are skipped by default or can update the current user's existing contact.

## Manual email test

1. Create or sign in to an account.
2. Add the actual Hostinger mailbox and verify its SMTP/IMAP connection.
3. Create a contact using a safe test recipient address.
4. Create a template, using variables such as `{{firstName}}` or `{{brandName}}`.
5. Open `/compose`, select the verified mailbox, contact, and template, then review the preview.
6. Use **Send Test Email** first, or confirm **Send email** for one reviewed message.
7. Confirm delivery at the recipient and review `/email-logs` for the `SENT` record.

Email sending is server-side only. SMTP credentials remain encrypted and are never returned to the browser. The selected mailbox must have passed Phase 2 verification, and `DO_NOT_CONTACT` contacts are blocked server-side.

## Campaign workflow

Create a campaign with a verified mailbox and owned template, open its details page, filter/search contacts, select valid recipients, and save the recipient list. `DO_NOT_CONTACT` and `INVALID` contacts are excluded server-side. The review action validates the mailbox, template, and at least one valid recipient before changing the campaign to `READY`. Queue processing and follow-up sending run server-side.

## Database migration note

Phase 4 through Phase 7 add email sender/contact/provider/thread fields, inbound/outbound direction, follow-up settings/rules, recipient reply fields, follow-up job types, and scheduled job lifecycle fields to the Prisma schema. No reset, drop, or destructive database operation is performed automatically. Apply a reviewed migration named `phase7_followups_reply_detection` against the configured MySQL database before using production data. If `DATABASE_URL` is not configured, only schema validation/generation and build checks can run.

## Scheduled queue worker

The campaign detail page supports **Send Now (queue)** or an explicit date, time, and IANA timezone. The API stores UTC `runAt` plus the selected timezone and creates one `ScheduledJob` per recipient; it does not send inside the browser request. `POST /api/worker/process` calls `processDueJobs()` and is protected by `WORKER_TOKEN`. Trigger it from a cron job, VPS scheduled task, or an external scheduler at a suitable interval. Hostinger scheduler availability and limits must be verified for the specific hosting product before relying on it.

The worker claims jobs with a conditional `PENDING -> PROCESSING` update, processes a configurable batch, delays between sends, retries temporary SMTP/network failures, and marks permanent failures. It rechecks ownership, mailbox verification, template availability, campaign cancellation, contact status, and recipient status at send time. SMTP cannot guarantee exactly-once delivery if a process crashes after the provider accepts a message but before the database update; provider IDs and recipient/job state reduce, but cannot eliminate, that limitation.

### Standalone worker

For a persistent Node.js host such as a VPS, run the queue and inbox worker directly instead of routing work through Vercel functions:

```text
npm run worker
```

The worker reuses `processDueJobs()` and `syncAllMailboxes()`, and relies on database leases to prevent overlapping work. It handles `SIGINT`/`SIGTERM` after the current cycle finishes. A one-shot scheduler can use `WORKER_RUN_ONCE=true npm run worker:once`; do not run multiple independent schedulers unless the deployment intentionally relies on the database leases. `WORKER_SKIP_INBOX_SYNC=true` is test-only and must remain false in production.

Example protected trigger:

```text
POST /api/worker/process
Authorization: Bearer $WORKER_TOKEN
```

## Follow-ups and replies

Configure follow-up steps at `/follow-ups` with owned templates, delay amounts/units, and an explicit IANA timezone. After an initial job is sent, the worker creates only the next enabled follow-up. Before every follow-up send it rechecks campaign state, contact policy, mailbox verification, template ownership, previous successful steps, and reply state.

Use `POST /api/inbox/sync` while signed in to synchronize a user's verified IMAP mailbox, or trigger `POST /api/worker/inbox-sync` with the server-only worker token. Inbound messages are deduplicated by Message-ID and matched using `In-Reply-To`, `References`, known thread IDs, or sender plus normalized subject evidence. A sender-only match is not treated as a reply. A confident match marks the recipient `REPLIED` and cancels pending future follow-up jobs.

Production schedulers should periodically trigger both worker routes server-side. Verify the capabilities and limits of the actual Hostinger hosting product before selecting its scheduler.

## Hostinger manual verification

Use the actual mailbox address, mailbox username, mailbox password, SMTP host/port/security, and IMAP host/port/security from the Hostinger email configuration for that mailbox. Do not use hPanel login credentials. Hostinger values can vary by account/region, so obtain and verify the exact server values in Hostinger's official email configuration documentation before entering them. The **Test Connection** action verifies SMTP authentication and IMAP access only; it does not send or download mail.
