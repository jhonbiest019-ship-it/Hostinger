import nodemailer from "nodemailer";
import crypto from "crypto";
import { captureTestEmail } from "@/lib/email/test-transport";

export type MailConnectionConfig = {
  host: string;
  port: number;
  security: string;
  username: string;
  password: string;
};

export type SmtpSendData = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  messageId?: string;
  envelope?: nodemailer.SendMailOptions["envelope"];
  headers?: Record<string, string>;
};

export async function verifySmtp(config: MailConnectionConfig) {
  if (process.env.EMAIL_TEST_MODE === "true") return { testMode: true as const };
  const secure = config.security === "TLS";
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure,
    requireTLS: config.security === "STARTTLS",
    auth: { user: config.username, pass: config.password },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  try {
    await transporter.verify();
  } finally {
    transporter.close();
  }
}

export async function sendSmtp(config: MailConnectionConfig, data: SmtpSendData) {
  if (process.env.EMAIL_TEST_MODE === "true") {
    if (process.env.EMAIL_TEST_FAILURE === "temporary") {
      const error = new Error("Test transport timeout.") as Error & { code: string };
      error.code = "ETIMEDOUT";
      Object.assign(error, { command: "CONN" });
      throw error;
    }
    if (process.env.EMAIL_TEST_FAILURE === "permanent") {
      const error = new Error("Test transport permanent rejection.") as Error & { code: string };
      error.code = "EAUTH";
      throw error;
    }
    return captureTestEmail({ from: data.from, to: data.to, subject: data.subject, body: data.text });
  }

  const secure = config.security === "TLS";
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure,
    requireTLS: config.security === "STARTTLS",
    auth: { user: config.username, pass: config.password },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  // Extract pure email address from "from" header (e.g. '"Company" <sales@domain.com>' -> 'sales@domain.com')
  const emailRegex = /<([^>]+)>/;
  const match = data.from.match(emailRegex);
  const senderEmail = (match ? match[1] : (data.from.includes("@") ? data.from : config.username)).trim().toLowerCase();

  // Clean recipient email address for envelope
  const recipientMatch = data.to.match(emailRegex);
  const cleanRecipient = (recipientMatch ? recipientMatch[1] : data.to).trim().toLowerCase();

  // Generate authentic, domain-aligned RFC 2822 Message-ID or let nodemailer generate clean ID
  const cleanMessageId = data.messageId
    ? (data.messageId.startsWith("<") && data.messageId.endsWith(">") ? data.messageId : `<${data.messageId}>`)
    : undefined;

  const mailOptions: nodemailer.SendMailOptions = {
    from: data.from,
    to: data.to,
    subject: data.subject,
    text: data.text,
    html: data.html,
    replyTo: data.replyTo || senderEmail,
    ...(cleanMessageId ? { messageId: cleanMessageId } : {}),
    envelope: (data.envelope || {
      from: senderEmail,
      to: [cleanRecipient],
    }) as nodemailer.SendMailOptions["envelope"],
    date: new Date(),
    headers: {
      "X-Mailer": "Shotinger Mail",
      ...(data.headers || {}),
    },
  };

  try {
    return await transporter.sendMail(mailOptions);
  } finally {
    transporter.close();
  }
}
