import nodemailer from "nodemailer";
import { captureTestEmail } from "@/lib/email/test-transport";

export type MailConnectionConfig = { host: string; port: number; security: string; username: string; password: string };

export async function verifySmtp(config: MailConnectionConfig) {
  if (process.env.EMAIL_TEST_MODE === "true") return;
  const secure = config.security === "TLS";
  const transporter = nodemailer.createTransport({ host: config.host, port: config.port, secure, requireTLS: config.security === "STARTTLS", auth: { user: config.username, pass: config.password }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000 });
  try { await transporter.verify(); } finally { transporter.close(); }
}

export async function sendSmtp(config: MailConnectionConfig, data: { from: string; to: string; subject: string; text: string }) {
  if (process.env.EMAIL_TEST_MODE === "true") {
    if (process.env.EMAIL_TEST_FAILURE === "temporary") { const error = new Error("Test transport timeout.") as Error & { code: string }; error.code = "ETIMEDOUT"; throw error; }
    if (process.env.EMAIL_TEST_FAILURE === "permanent") { const error = new Error("Test transport permanent rejection.") as Error & { code: string }; error.code = "EAUTH"; throw error; }
    return captureTestEmail({ from: data.from, to: data.to, subject: data.subject, body: data.text });
  }
  const secure = config.security === "TLS";
  const transporter = nodemailer.createTransport({ host: config.host, port: config.port, secure, requireTLS: config.security === "STARTTLS", auth: { user: config.username, pass: config.password }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
  try { return await transporter.sendMail({ from: data.from, to: data.to, subject: data.subject, text: data.text }); } finally { transporter.close(); }
}
