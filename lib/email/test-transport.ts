export type CapturedEmail = { from: string; to: string; subject: string; body: string; messageId: string; timestamp: string };

const captured: CapturedEmail[] = [];

export function captureTestEmail(email: Omit<CapturedEmail, "messageId" | "timestamp">) {
  const messageId = `<test-${Date.now()}-${Math.random().toString(36).slice(2)}@outreach-studio.test>`;
  const result = { ...email, messageId, timestamp: new Date().toISOString() };
  captured.push(result);
  return { messageId };
}

export function getCapturedTestEmails() { return [...captured]; }
export function clearCapturedTestEmails() { captured.length = 0; }
