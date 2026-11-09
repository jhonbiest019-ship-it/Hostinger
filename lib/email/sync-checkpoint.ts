import fs from "node:fs";
import path from "node:path";

export interface MailboxSyncState {
  inboxUid?: number;
  sentUid?: number;
  lastSyncedAt?: string;
}

export interface AllSyncStates {
  [mailboxId: string]: MailboxSyncState;
}

const STATE_FILE_PATH = path.join(process.cwd(), ".local-run", "mailbox-sync-state.json");

function ensureDirectoryExists() {
  const dir = path.dirname(STATE_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getAllSyncStates(): AllSyncStates {
  try {
    ensureDirectoryExists();
    if (fs.existsSync(STATE_FILE_PATH)) {
      const content = fs.readFileSync(STATE_FILE_PATH, "utf-8");
      return JSON.parse(content) || {};
    }
  } catch (err) {
    console.warn("Could not read mailbox sync state file:", err);
  }
  return {};
}

export function getMailboxSyncState(mailboxId: string): MailboxSyncState {
  const all = getAllSyncStates();
  return all[mailboxId] || {};
}

export function updateMailboxSyncState(mailboxId: string, partial: Partial<MailboxSyncState>) {
  try {
    ensureDirectoryExists();
    const all = getAllSyncStates();
    const existing = all[mailboxId] || {};
    all[mailboxId] = {
      ...existing,
      ...partial,
      lastSyncedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(all, null, 2), "utf-8");
  } catch (err) {
    console.warn(`Could not update mailbox sync state for ${mailboxId}:`, err);
  }
}
