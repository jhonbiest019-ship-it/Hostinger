"use client";

import { FormEvent, useState } from "react";

const fields = [
  ["Email Address", "emailAddress", "email", "you@company.com"],
  ["Display Name", "displayName", "text", "Your name or brand"],
  ["SMTP Host", "smtpHost", "text", "smtp.example.com"],
  ["SMTP Port", "smtpPort", "number", "587"],
  ["IMAP Host", "imapHost", "text", "imap.example.com"],
  ["IMAP Port", "imapPort", "number", "993"],
  ["Username", "username", "text", "Mailbox username"],
  ["Password", "password", "password", "Stored encrypted in Phase 2"],
] as const;

export function MailboxForm() {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    if (!String(form.get("emailAddress")).includes("@")) return setError("Enter a valid email address.");
    if (!form.get("smtpHost") || !form.get("imapHost") || !form.get("username") || !form.get("password")) return setError("Complete the required connection fields before continuing.");
    setNotice("Mailbox form is ready. Secure connection and credential storage will be enabled in Phase 2.");
  }
  return <section className="card mb-6 p-6"><div className="mb-5"><h2 className="font-semibold">Add a mailbox</h2><p className="mt-1 text-sm text-slate-500">This form prepares the connection details. It does not connect or save credentials in Phase 1.</p></div><form onSubmit={submit} noValidate><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{fields.map(([label, name, type, placeholder]) => <label key={name} className="text-sm font-medium text-slate-600">{label}{name === "password" && <span className="ml-1 text-xs font-normal text-slate-400">(future encrypted field)</span>}<input required={name !== "displayName"} name={name} type={type} placeholder={placeholder} className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-ink focus:ring-1 focus:ring-ink" /></label>)}</div>{error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">{error}</p>}{notice && <p className="mt-4 rounded-lg bg-mint px-3 py-2.5 text-sm text-emerald-800" role="status">{notice}</p>}<div className="mt-5 flex flex-wrap gap-3"><button className="btn-primary" type="submit">Save mailbox details</button><button className="btn-secondary" type="button" onClick={() => setNotice("Connection testing will be implemented in Phase 2.")}>Test Connection <span className="ml-2 text-xs text-slate-400">Phase 2</span></button></div></form></section>;
}
