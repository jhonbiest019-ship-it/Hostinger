# Run Hostinger by Farani locally

## Start

From PowerShell:

```powershell
cd D:\Shotinger
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1
```

Open http://127.0.0.1:3000. The launcher starts the existing local MySQL database if needed, the web preview, and the standalone worker in background processes. It uses installed Node.js (or the bundled local runtime on this computer), so npm does not need to be on PATH.

Keep the computer awake and running. You may close the browser and the launcher terminal. A shutdown, sleep, or stopped worker delays execution until it starts again; overdue jobs run on the next worker cycle. Logs are in the ignored `.local-run` directory. Scheduled shows the last recorded queue activity.

## Stop or restart after changing configuration

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-local.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1
```

Stop waits for the worker's current cycle before stopping the web preview. MySQL is left running to preserve other local database connections.

## Daily workflow

1. In Settings, save your name and default timezone (Asia/Karachi by default). Optionally change your password.
2. Add a mailbox and test SMTP and IMAP. Test mode deliberately does not validate real credentials.
3. Add/import contacts and create templates.
4. Create a campaign, save its mailbox/template and recipients, and configure follow-up steps before scheduling.
5. Review and mark ready, then choose Send now or a date/time/timezone.
6. Use Pause/Resume/Cancel on the campaign and monitor Scheduled, Email Logs and Inbox.

Follow-up delays are elapsed minutes, hours or 24-hour days after the previous successful email. Replies cancel future follow-ups for the matched campaign recipient. A message already submitted to SMTP may finish after pause/cancel/reply. An uncertain SMTP delivery is never retried automatically; check the mailbox first. Confirmed failures can be retried from Scheduled. Resuming a campaign releases overdue jobs on the next worker cycle.

Campaign recipients/content and follow-up definitions are locked after scheduling. Duplicate a campaign to prepare a changed sequence; the copy retains valid recipients and follow-up rules.

## Test mode and real mail

The current local configuration uses `EMAIL_TEST_MODE=true`. Email sends are simulated, and SMTP/IMAP network operations are skipped. The application displays a visible test-mode banner. Simulated SENT records do not prove live delivery.

For real use, stop the local app/worker, set `EMAIL_TEST_MODE=false` in your private `.env.local`, and restart. Verify a real mailbox and send one test email to an address you control before scheduling campaigns. Real delivery, actual provider connectivity, and reply synchronization still need this check. Existing test records remain in the local test database; use your own account to keep daily data separate.

## Other development commands

With Node/npm on PATH:

```text
npm run typecheck
npm run build
npm run test:safe
npm run worker
npm run worker:once
```

The safe test runner loads `.env.local` and refuses databases other than localhost:3307/shotinger_test with EMAIL_TEST_MODE=true. Run tests with the background worker stopped so it cannot consume test fixtures concurrently.

The additive `20261016090000_user_timezone` migration has been applied to this computer's local test database after a backup in ignored `backups/`. Apply reviewed migrations to any separate database before using this version. No production hosting or DNS changes were made.
