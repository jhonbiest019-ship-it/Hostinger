"use client";

import { useEffect, useState } from "react";
import { renderTemplate, TEMPLATE_VARIABLES } from "@/lib/email/template";

type Mailbox = { id: string; emailAddress: string; status: string; smtpStatus: string; displayName?: string | null };
type Contact = {
  id: string;
  name: string;
  fullName: string | null;
  email: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  brandName: string | null;
  companyName: string | null;
  phone: string | null;
  website: string | null;
  formUrl: string | null;
};
type Template = { id: string; name: string; subject: string; body: string; isDefault?: boolean };

const sample = {
  firstName: "John",
  lastName: "Smith",
  fullName: "John Smith",
  brandName: "ABC Brand",
  companyName: "ABC Brand",
  email: "john@example.com",
  phone: "+1 555 0100",
  website: "https://example.com",
  formUrl: "https://example.com/contact",
};

export function EmailComposer() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [mailboxId, setMailboxId] = useState("");
  const [contactId, setContactId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function request(path: string, options?: RequestInit) {
    const response = await fetch(path, {
      ...options,
      credentials: "include",
      headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Request failed.");
    return data;
  }

  useEffect(() => {
    Promise.all([request("/api/mailboxes"), request("/api/contacts?pageSize=100"), request("/api/templates")])
      .then(([m, c, t]) => {
        const active = (m.mailboxes || []).filter(
          (item: Mailbox) => item.status === "ACTIVE" && item.smtpStatus === "CONNECTED"
        );
        const list = active.length ? active : m.mailboxes || [];
        setMailboxes(list);
        if (list.length > 0) {
          setMailboxId(list[0].id);
        }
        setContacts(c.contacts || []);
        const loadedTemplates: Template[] = t.templates || [];
        setTemplates(loadedTemplates);
        const activeTpl = loadedTemplates.find((item) => item.isDefault) || loadedTemplates[0];
        if (activeTpl) {
          setTemplateId(activeTpl.id);
          setSubject(activeTpl.subject);
          setBody(activeTpl.body);
        }
      })
      .catch((error) => setNotice(error.message));
  }, []);

  const mailbox = mailboxes.find((item) => item.id === mailboxId);
  const contact = contacts.find((item) => item.id === contactId);
  const template = templates.find((item) => item.id === templateId);

  const variables = contact
    ? {
        firstName: contact.firstName,
        lastName: contact.lastName,
        fullName: contact.fullName ?? contact.name,
        brandName: contact.brandName,
        companyName: contact.companyName,
        email: contact.email,
        phone: contact.phone,
        website: contact.website,
        formUrl: contact.formUrl,
      }
    : sample;

  function chooseTemplate(id: string) {
    setTemplateId(id);
    const selected = templates.find((item) => item.id === id);
    if (selected) {
      setSubject(renderTemplate(selected.subject, variables));
      setBody(renderTemplate(selected.body, variables));
    }
  }

  async function send() {
    if (!mailbox || !contact || !subject.trim() || !body.trim()) {
      return setNotice("Select a verified mailbox and contact, then complete subject and body.");
    }
    if (contact.status === "DO_NOT_CONTACT") {
      return setNotice("This contact is marked DO_NOT_CONTACT.");
    }
    if (!window.confirm(`You are about to send this email from ${mailbox.emailAddress} to ${contact.email}. Continue?`)) {
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await request("/api/email/send", {
        method: "POST",
        body: JSON.stringify({ mailboxId, contactId, templateId: templateId || undefined, subject, body }),
      });
      setNotice(`✓ Email sent successfully from ${mailbox.emailAddress} to ${contact.email} and logged.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to send email.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!mailbox || !testRecipient) {
      return setNotice("Select a mailbox and enter a test recipient.");
    }
    setBusy(true);
    setNotice("");
    try {
      await request("/api/email/test", {
        method: "POST",
        body: JSON.stringify({
          mailboxId,
          recipient: testRecipient,
          subject: "Hostinger by Farani test email",
          body: "This is a test email from Hostinger by Farani.",
        }),
      });
      setNotice(`✓ Test email sent successfully from ${mailbox.emailAddress} to ${testRecipient}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to send test email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <section className="card p-6 space-y-5">
        {/* Easy Sender Hostinger Mailbox Selector */}
        <div className="rounded-xl border border-purple-100 bg-purple-50/40 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-purple-100 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                <span>✉️</span> Sender Mailbox (From Address)
              </span>
              <span className="text-[10px] font-bold text-[#673DE6] bg-purple-100 px-2.5 py-0.5 rounded-full">
                {mailboxes.length} {mailboxes.length === 1 ? "Mailbox" : "Mailboxes"} Available
              </span>
            </div>
            {mailbox && (
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Active Sender: <strong className="font-mono text-gray-900">{mailbox.emailAddress}</strong>
              </span>
            )}
          </div>

          <p className="text-xs text-gray-500">
            Click any Hostinger account to switch the sending email address immediately:
          </p>

          {mailboxes.length === 0 ? (
            <div className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
              ⚠️ No connected Hostinger mailboxes found. Please configure a mailbox in the Mailboxes tab.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {mailboxes.map((item) => {
                const isSelected = item.id === mailboxId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMailboxId(item.id)}
                    className={`rounded-xl p-3 border-2 transition text-left cursor-pointer flex flex-col justify-between gap-2 ${
                      isSelected
                        ? "border-[#673DE6] bg-white shadow-md ring-2 ring-[#673DE6]/20"
                        : "border-gray-200 bg-white/90 hover:border-purple-300 hover:bg-purple-50/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0 font-bold ${
                            isSelected
                              ? "bg-[#673DE6] text-white"
                              : "bg-purple-50 text-[#673DE6] border border-purple-100"
                          }`}
                        >
                          ✉️
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-gray-900 truncate font-mono">
                            {item.emailAddress}
                          </p>
                          <p className="text-[10px] text-gray-400">Hostinger SMTP</p>
                        </div>
                      </div>

                      <span
                        className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isSelected
                            ? "bg-[#673DE6] text-white"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        }`}
                      >
                        {isSelected ? "✓ Active" : "Use"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-gray-500 pt-1 border-t border-gray-100">
                      <span className="flex items-center gap-1 text-emerald-600 font-medium text-[10px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {item.smtpStatus === "CONNECTED" ? "Verified" : item.status}
                      </span>
                      <span className="text-[10px] font-semibold text-gray-600">
                        {isSelected ? "Selected" : "Click to select"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Contact and Template selectors */}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-600">
            Recipient Contact
            <select
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
              className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm focus:border-[#673DE6] focus:outline-none"
            >
              <option value="">Select a contact</option>
              {contacts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} - {item.email}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-medium text-slate-600">
            Email Template (Optional)
            <select
              value={templateId}
              onChange={(event) => chooseTemplate(event.target.value)}
              className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm focus:border-[#673DE6] focus:outline-none"
            >
              <option value="">Write without a template</option>
              {templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Sender and Recipient Preview Strip */}
        <div className="rounded-xl bg-purple-50/60 border border-purple-100 px-4 py-3 text-xs sm:text-sm">
          <p>
            <strong className="text-gray-900">From:</strong>{" "}
            <span className="font-mono text-[#673DE6] font-semibold">
              {mailbox?.emailAddress ?? "Select a mailbox above"}
            </span>
          </p>
          <p className="mt-1">
            <strong className="text-gray-900">To:</strong>{" "}
            <span className="font-mono text-gray-700">
              {contact?.email ?? "Select a contact above"}
            </span>
          </p>
        </div>

        {/* Subject and Body */}
        <div className="space-y-4">
          <label className="block text-sm font-medium text-slate-600">
            Subject
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="e.g. Partnership Proposal for {{brandName}}"
              className="mt-2 w-full rounded-lg border border-line px-3.5 py-2.5 text-sm outline-none focus:border-[#673DE6]"
            />
          </label>

          <label className="block text-sm font-medium text-slate-600">
            Body
            <textarea
              rows={12}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write your email message here. Use {{brandName}} or {{fullName}} for dynamic tags."
              className="mt-2 w-full rounded-lg border border-line px-3.5 py-2.5 text-sm leading-6 outline-none focus:border-[#673DE6]"
            />
          </label>
        </div>

        {/* Send Action */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            className="btn-primary"
            disabled={busy || !mailboxId || !contactId}
            onClick={() => void send()}
          >
            {busy ? "Sending..." : "Send Email"}
          </button>
          {notice && (
            <p className="rounded-lg bg-cloud px-4 py-2.5 text-xs sm:text-sm text-slate-700 font-medium" role="status">
              {notice}
            </p>
          )}
        </div>
      </section>

      {/* Sidebar preview & test */}
      <aside className="space-y-6">
        <section className="card p-5">
          <h2 className="font-semibold text-gray-900">Available Variables</h2>
          <p className="mt-1.5 text-xs leading-5 text-slate-500">
            Variables are replaced with the selected contact&apos;s details before sending.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.map((variable) => (
              <code key={variable} className="rounded bg-purple-50 text-[#673DE6] px-2 py-0.5 text-xs font-mono">
                {`{{${variable}}}`}
              </code>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold text-gray-900">Real-Time Preview</h2>
          <p className="mt-2 text-xs font-bold text-gray-900">{renderTemplate(subject || "Subject preview", variables)}</p>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">
            {renderTemplate(body || "Body preview will appear here...", variables)}
          </p>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold text-gray-900">Send Test Email</h2>
          <p className="mt-1.5 text-xs text-slate-500">
            Verify Hostinger SMTP sending from{" "}
            <strong className="text-purple-700">{mailbox?.emailAddress || "selected mailbox"}</strong>.
          </p>
          <input
            type="email"
            value={testRecipient}
            onChange={(event) => setTestRecipient(event.target.value)}
            placeholder="test@example.com"
            className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-xs outline-none focus:border-[#673DE6]"
          />
          <button
            className="btn-secondary mt-3 w-full text-xs font-semibold"
            disabled={busy || !mailboxId}
            onClick={() => void sendTest()}
          >
            Send Test Email
          </button>
        </section>
      </aside>
    </div>
  );
}
