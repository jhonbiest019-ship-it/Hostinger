"use client";

import { FormEvent, Fragment, useEffect, useState } from "react";
import { Badge, EmptyState } from "@/components/ui";

type Mailbox = {
  id: string;
  displayName: string | null;
  emailAddress: string;
  username: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  status: string;
  smtpStatus: string;
  imapStatus: string;
  lastCheckedAt: string | null;
  createdAt: string;
  lastError: string | null;
};

type FormValues = {
  displayName: string;
  emailAddress: string;
  username: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
};

type Provider = "hostinger" | "webmail" | "titan" | "cpanel" | "custom";

const defaultHostingerForm: FormValues = {
  displayName: "",
  emailAddress: "",
  username: "",
  password: "",
  smtpHost: "smtp.hostinger.com",
  smtpPort: 465,
  smtpSecurity: "TLS",
  imapHost: "imap.hostinger.com",
  imapPort: 993,
  imapSecurity: "TLS",
};

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value)
      )
    : "Never";
}

function tone(status: string): "neutral" | "green" | "amber" {
  return status === "ACTIVE" || status === "CONNECTED"
    ? "green"
    : status === "ERROR" || status === "FAILED"
    ? "amber"
    : "neutral";
}

export function MailboxWorkspace() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [form, setForm] = useState<FormValues>(defaultHostingerForm);
  const [provider, setProvider] = useState<Provider>("hostinger");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testCompletedId, setTestCompletedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeMailboxId, setActiveMailboxId] = useState<string>("");
  const [message, setMessage] = useState<{ kind: "success" | "error" | "notice"; text: string } | null>(
    null
  );

  async function request(path: string, options?: RequestInit) {
    const response = await fetch(path, {
      ...options,
      credentials: "include",
      headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const fields = body.fields
        ? Object.entries(body.fields)
            .flatMap(([field, errors]) =>
              Array.isArray(errors) ? errors.map((error) => `${field}: ${error}`) : []
            )
            .join(" ")
        : "";
      throw new Error([body.error ?? "Request failed.", fields].filter(Boolean).join(" "));
    }
    return body;
  }

  async function load() {
    try {
      const body = await request("/api/mailboxes");
      const list = body.mailboxes || [];
      setMailboxes(list);

      // Fetch active mailbox
      try {
        const activeRes = await request("/api/mailboxes/active");
        if (activeRes.activeMailboxId) {
          setActiveMailboxId(activeRes.activeMailboxId);
          if (typeof window !== "undefined") {
            localStorage.setItem("active_sender_mailbox_id", activeRes.activeMailboxId);
          }
        } else if (list.length > 0) {
          const saved = typeof window !== "undefined" ? localStorage.getItem("active_sender_mailbox_id") : null;
          setActiveMailboxId(saved || list[0].id);
        }
      } catch {
        if (list.length > 0) setActiveMailboxId(list[0].id);
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mailboxes-updated"));
      }

      setEditing((currentEditing) => {
        if (currentEditing && !list.some((m: Mailbox) => m.id === currentEditing)) {
          setProvider("hostinger");
          setForm(defaultHostingerForm);
          return null;
        }
        return currentEditing;
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Unable to load mailboxes.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function makeActiveSender(id: string) {
    setBusy(id);
    try {
      await request("/api/mailboxes/active", {
        method: "POST",
        body: JSON.stringify({ mailboxId: id }),
      });
      setActiveMailboxId(id);
      if (typeof window !== "undefined") {
        localStorage.setItem("active_sender_mailbox_id", id);
        window.dispatchEvent(new CustomEvent("sender-mailbox-changed", { detail: { mailboxId: id } }));
        window.dispatchEvent(new CustomEvent("mailboxes-updated"));
      }
      const mb = mailboxes.find((m) => m.id === id);
      setMessage({
        kind: "success",
        text: `✓ Real-time active sender set to: ${mb?.displayName ? `[${mb.displayName}] ` : ""}${mb?.emailAddress}. All real-time emails & campaigns will dispatch from this mailbox.`,
      });
    } catch (err: any) {
      setMessage({
        kind: "error",
        text: err.message || "Failed to set active sender.",
      });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function change(name: keyof FormValues, value: string) {
    setForm((current) => {
      const updated = {
        ...current,
        [name]: name === "smtpPort" || name === "imapPort" ? Number(value) : value,
      };
      // Auto-fill username with email if username is empty or matches previous email
      if (name === "emailAddress") {
        if (!current.username || current.username === current.emailAddress) {
          updated.username = value;
        }
        // If webmail/cpanel is selected or using mail.domain.com, auto-update hosts with new domain
        if ((provider === "webmail" || provider === "cpanel" || current.smtpHost.startsWith("mail.")) && value.includes("@")) {
          const domain = value.split("@")[1]?.trim();
          if (domain) {
            updated.smtpHost = `mail.${domain}`;
            updated.imapHost = `mail.${domain}`;
          }
        }
      }
      return updated;
    });
  }

  function selectProvider(value: Provider) {
    setProvider(value);
    if (value === "hostinger") {
      setForm((current) => ({
        ...current,
        smtpHost: "smtp.hostinger.com",
        smtpPort: 465,
        smtpSecurity: "TLS",
        imapHost: "imap.hostinger.com",
        imapPort: 993,
        imapSecurity: "TLS",
      }));
    } else if (value === "webmail" || value === "cpanel") {
      const domain = form.emailAddress.includes("@") ? form.emailAddress.split("@")[1].trim() : "yourdomain.com";
      setForm((current) => ({
        ...current,
        smtpHost: `mail.${domain}`,
        smtpPort: 465,
        smtpSecurity: "TLS",
        imapHost: `mail.${domain}`,
        imapPort: 993,
        imapSecurity: "TLS",
      }));
    } else if (value === "titan") {
      setForm((current) => ({
        ...current,
        smtpHost: "smtp.titan.email",
        smtpPort: 465,
        smtpSecurity: "TLS",
        imapHost: "imap.titan.email",
        imapPort: 993,
        imapSecurity: "TLS",
      }));
    }
  }

  function edit(mailbox: Mailbox) {
    setEditing(mailbox.id);
    let detectedProvider: Provider = "custom";
    if (mailbox.smtpHost === "smtp.hostinger.com" && mailbox.imapHost === "imap.hostinger.com") {
      detectedProvider = "hostinger";
    } else if (mailbox.smtpHost.includes("titan.email")) {
      detectedProvider = "titan";
    } else if (mailbox.smtpHost.startsWith("mail.") || mailbox.smtpHost.includes(mailbox.emailAddress.split("@")[1] || "")) {
      detectedProvider = "webmail";
    }
    setProvider(detectedProvider);
    setForm({
      displayName: mailbox.displayName ?? "",
      emailAddress: mailbox.emailAddress,
      username: mailbox.username ?? mailbox.emailAddress,
      password: "",
      smtpHost: mailbox.smtpHost || "smtp.hostinger.com",
      smtpPort: mailbox.smtpPort || 465,
      smtpSecurity: mailbox.smtpSecurity || "TLS",
      imapHost: mailbox.imapHost || "imap.hostinger.com",
      imapPort: mailbox.imapPort || 993,
      imapSecurity: mailbox.imapSecurity || "TLS",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setEditing(null);
    setProvider("hostinger");
    setForm(defaultHostingerForm);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setMessage(null);
    try {
      // Auto-fill Hostinger hosts if left empty
      const smtpHost = form.smtpHost.trim() || "smtp.hostinger.com";
      const imapHost = form.imapHost.trim() || "imap.hostinger.com";
      const smtpPort = form.smtpPort || 465;
      const imapPort = form.imapPort || 993;
      const smtpSecurity = form.smtpSecurity || "TLS";
      const imapSecurity = form.imapSecurity || "TLS";

      // For Hostinger email, username must be the full email address
      let username = form.username.trim() || form.emailAddress.trim();
      if (smtpHost.includes("hostinger.com") && !username.includes("@")) {
        username = form.emailAddress.trim();
      }

      const payload = {
        ...form,
        smtpHost,
        imapHost,
        smtpPort,
        imapPort,
        smtpSecurity,
        imapSecurity,
        username,
        ...(editing && !form.password ? { password: undefined } : {}),
      };

      let responseData: any = null;
      try {
        responseData = await request(editing ? `/api/mailboxes/${editing}` : "/api/mailboxes", {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        });
      } catch (err: any) {
        // If the mailbox ID being edited was deleted or not found (404)
        if (editing && (String(err?.message || "").toLowerCase().includes("not found") || err?.status === 404)) {
          if (payload.password) {
            responseData = await request("/api/mailboxes", {
              method: "POST",
              body: JSON.stringify(payload),
            });
            reset();
            await load();
          } else {
            reset();
            throw new Error("This mailbox was disconnected or removed. The form has been reset to 'Add a Mailbox'. Please enter your password to connect it fresh.");
          }
        } else {
          throw err;
        }
      }

      if (responseData?.connectionStatus === "ACTIVE" || responseData?.mailbox?.status === "ACTIVE") {
        const isHst = payload.smtpHost?.includes("hostinger.com");
        setMessage({
          kind: "success",
          text: `✓ Real-time connection verified! Connected successfully to ${payload.emailAddress}${isHst ? " on Hostinger" : " on Webmail / cPanel"}.`,
        });
      } else if (responseData?.lastError || responseData?.mailbox?.lastError) {
        setMessage({
          kind: "error",
          text: `⚠️ Saved, but connection verification failed: ${responseData.lastError || responseData.mailbox?.lastError}`,
        });
      } else {
        setMessage({
          kind: "success",
          text: editing ? "Mailbox updated securely." : "Mailbox added securely.",
        });
      }

      reset();
      await load();
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Unable to save mailbox.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function test(id: string) {
    setBusy(id);
    setTestCompletedId(null);
    setMessage(null);
    try {
      const body = await request(`/api/mailboxes/${id}/test`, { method: "POST", body: "{}" });
      if (body.testMode) {
        setMessage({
          kind: "notice",
          text: body.message,
        });
      } else if (body.success) {
        setMessage({
          kind: "success",
          text: `✓ Connection Verified! SMTP and IMAP connected successfully. Mailbox is Active.`,
        });
      } else {
        setMessage({
          kind: "error",
          text: `❌ Connection Failed: ${body.lastError || body.message || body.smtpError || "Authentication failed. Check your password."}`,
        });
      }
      setTestCompletedId(id);
      await load();
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Connection test failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Disconnect this mailbox? Existing campaigns and contacts will not be deleted."))
      return;
    setBusy(id);
    try {
      await request(`/api/mailboxes/${id}`, { method: "DELETE", body: "{}" });
      setMessage({ kind: "success", text: "Mailbox disconnected." });
      if (editing === id) {
        reset();
      }
      await load();
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Unable to disconnect mailbox.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">{editing ? "Edit mailbox" : "Add a mailbox"}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Credentials are encrypted server-side with AES-256-GCM.
            </p>
          </div>
          {editing && (
            <button className="btn-secondary" type="button" onClick={reset}>
              Cancel edit
            </button>
          )}
        </div>

        <form onSubmit={save} noValidate>
          <label className="mb-5 block text-sm font-medium text-slate-600">
            Provider
            <select
              value={provider}
              onChange={(event) => selectProvider(event.target.value as Provider)}
              className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm"
            >
              <option value="hostinger">Hostinger Business Email (smtp.hostinger.com / imap.hostinger.com)</option>
              <option value="webmail">Webmail / cPanel (mail.yourdomain.com - Port 465 / 993)</option>
              <option value="titan">Titan Email (smtp.titan.email / imap.titan.email)</option>
              <option value="custom">Custom SMTP / IMAP</option>
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-medium text-slate-600">
              Company / Display Name
              <input
                name="displayName"
                type="text"
                placeholder="e.g. Swift Orbits"
                value={form.displayName}
                onChange={(event) => change("displayName", event.target.value)}
                className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 text-sm font-semibold outline-none focus:border-ink"
              />
              <span className="mt-1 block text-[11px] font-medium text-[#673DE6]">
                ⭐ Receiver will see this Company Name in <strong>BOLD</strong> in their inbox.
              </span>
            </label>

            <label className="text-sm font-medium text-slate-600">
              Email Address
              <input
                required
                name="emailAddress"
                type="email"
                placeholder="info@swiftorbits.com"
                value={form.emailAddress}
                onChange={(event) => change("emailAddress", event.target.value)}
                className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-ink"
              />
            </label>

            <label className="text-sm font-medium text-slate-600">
              Username
              <input
                required
                name="username"
                type="text"
                placeholder="info@swiftorbits.com"
                value={form.username}
                onChange={(event) => change("username", event.target.value)}
                className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-ink"
              />
              <span className="mt-1 block text-[11px] text-slate-400">
                Hostinger username must be your full email address
              </span>
            </label>

            <label className="text-sm font-medium text-slate-600">
              Password
              {editing && <span className="ml-1 text-xs font-normal text-slate-400">(leave blank to keep)</span>}
              <input
                required={!editing}
                name="password"
                type="password"
                placeholder="Mailbox password"
                value={form.password}
                onChange={(event) => change("password", event.target.value)}
                className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-ink"
              />
            </label>

            <label className="text-sm font-medium text-slate-600">
              SMTP Host
              <input
                required
                name="smtpHost"
                type="text"
                placeholder="smtp.hostinger.com"
                value={form.smtpHost}
                onChange={(event) => change("smtpHost", event.target.value)}
                className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-ink"
              />
            </label>

            <label className="text-sm font-medium text-slate-600">
              SMTP Port
              <input
                required
                name="smtpPort"
                type="number"
                placeholder="465"
                value={form.smtpPort}
                onChange={(event) => change("smtpPort", event.target.value)}
                className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-ink"
              />
            </label>

            <label className="text-sm font-medium text-slate-600">
              SMTP Security
              <select
                value={form.smtpSecurity}
                onChange={(event) => change("smtpSecurity", event.target.value)}
                className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm"
              >
                <option value="TLS">TLS (Port 465)</option>
                <option value="STARTTLS">STARTTLS (Port 587)</option>
                <option value="NONE">NONE</option>
              </select>
            </label>

            <label className="text-sm font-medium text-slate-600">
              IMAP Host
              <input
                required
                name="imapHost"
                type="text"
                placeholder="imap.hostinger.com"
                value={form.imapHost}
                onChange={(event) => change("imapHost", event.target.value)}
                className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-ink"
              />
            </label>

            <label className="text-sm font-medium text-slate-600">
              IMAP Port
              <input
                required
                name="imapPort"
                type="number"
                placeholder="993"
                value={form.imapPort}
                onChange={(event) => change("imapPort", event.target.value)}
                className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-ink"
              />
            </label>

            <label className="text-sm font-medium text-slate-600">
              IMAP Security
              <select
                value={form.imapSecurity}
                onChange={(event) => change("imapSecurity", event.target.value)}
                className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm"
              >
                <option value="TLS">TLS (Port 993)</option>
                <option value="STARTTLS">STARTTLS</option>
                <option value="NONE">NONE</option>
              </select>
            </label>
          </div>

          <div className="mt-5 flex gap-3">
            <button
              className="rounded-xl bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-purple-500/25 hover:shadow-lg hover:shadow-purple-500/35 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer disabled:opacity-50"
              type="submit"
              disabled={busy === "save"}
            >
              {busy === "save" ? "Saving..." : editing ? "Update mailbox" : "Save mailbox"}
            </button>
            {editing && (
              <button
                className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-700 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
                type="button"
                onClick={reset}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            message.kind === "success"
              ? "bg-mint text-emerald-800"
              : message.kind === "notice"
              ? "bg-cloud text-slate-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="card p-10 text-center text-sm text-slate-500">Loading mailboxes...</div>
      ) : mailboxes.length === 0 ? (
        <EmptyState
          title="No mailboxes connected"
          description="Add your Hostinger or Webmail mailbox above and click Test to verify the connection."
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-line bg-cloud/60">
              <tr>
                {["Display Name", "Email", "SMTP", "IMAP", "Overall", "Last Tested", "Created", "Actions"].map(
                  (heading) => (
                    <th
                      key={heading}
                      className="whitespace-nowrap px-5 py-4 text-xs font-bold uppercase tracking-wide text-slate-400"
                    >
                      {heading}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {mailboxes.map((mailbox) => (
                <Fragment key={mailbox.id}>
                  <tr className="border-b border-line last:border-0">
                    <td className="px-5 py-4">
                      <span className="font-bold text-slate-900 text-sm">
                        {mailbox.displayName || "Swift Orbits"}
                      </span>
                      <span className="block text-[10px] text-purple-600 font-medium">
                        (Inbox bold sender)
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs">{mailbox.emailAddress}</td>
                    <td className="px-5 py-4">
                      <Badge tone={tone(mailbox.smtpStatus)}>{mailbox.smtpStatus}</Badge>
                    </td>
                    <td className="px-5 py-4">
                      <Badge tone={tone(mailbox.imapStatus)}>{mailbox.imapStatus}</Badge>
                    </td>
                    <td className="px-5 py-4">
                      <Badge tone={tone(mailbox.status)}>{mailbox.status}</Badge>
                    </td>
                    <td className="px-5 py-4 text-slate-500">{formatDate(mailbox.lastCheckedAt)}</td>
                    <td className="px-5 py-4 text-slate-500">{formatDate(mailbox.createdAt)}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        {mailbox.id === activeMailboxId ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-800 border border-emerald-300 shadow-2xs">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            Active Sender
                          </span>
                        ) : (
                          <button
                            className="px-3 py-1.5 text-xs font-bold text-[#673DE6] bg-purple-50 hover:bg-purple-100 rounded-xl border border-purple-200 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer disabled:opacity-40"
                            type="button"
                            disabled={busy === mailbox.id || mailbox.smtpStatus !== "CONNECTED"}
                            onClick={() => void makeActiveSender(mailbox.id)}
                            title="Set as the active sender for real-time outreach & campaigns"
                          >
                            {busy === mailbox.id ? "Setting..." : "Set as Active"}
                          </button>
                        )}
                        <button
                          className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 rounded-xl border border-gray-200 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer shadow-2xs"
                          type="button"
                          disabled={busy === mailbox.id}
                          onClick={() => void test(mailbox.id)}
                        >
                          {busy === mailbox.id
                            ? "Testing..."
                            : testCompletedId === mailbox.id
                            ? "Test complete"
                            : "Test"}
                        </button>
                        <button
                          className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 rounded-xl border border-gray-200 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer shadow-2xs"
                          type="button"
                          onClick={() => edit(mailbox)}
                        >
                          Edit
                        </button>
                        <button
                          className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-xl border border-red-200 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
                          type="button"
                          onClick={() => void remove(mailbox.id)}
                        >
                          Disconnect
                        </button>
                      </div>
                    </td>
                  </tr>

                  {Boolean(
                    (mailbox.smtpStatus !== "CONNECTED" || mailbox.imapStatus !== "CONNECTED" || mailbox.status === "ERROR") &&
                    (mailbox.lastError || mailbox.status === "ERROR" || mailbox.smtpStatus === "FAILED" || mailbox.imapStatus === "FAILED")
                  ) && (
                    <tr className="bg-amber-50/40 border-b border-line">
                      <td colSpan={8} className="px-5 py-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950 bg-amber-50 p-3.5 rounded-2xl border border-amber-200/90 shadow-2xs">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span className="text-xl leading-none shrink-0 mt-0.5">⚠️</span>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-amber-900 text-xs">
                                  Connection Issue ({mailbox.emailAddress}):
                                </span>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                  {mailbox.smtpHost?.includes("hostinger.com")
                                    ? "Hostinger Auth Error"
                                    : "Webmail / Server Auth Error"}
                                </span>
                              </div>
                              <p className="text-amber-800 font-medium text-xs mt-1">
                                {mailbox.lastError ||
                                  (mailbox.smtpHost?.includes("hostinger.com")
                                    ? "Hostinger Password Rejected: Invalid password or username. The password entered does not match your Hostinger mailbox password."
                                    : `Webmail Password Rejected: Invalid password or username for ${mailbox.emailAddress}. The password entered does not match your cPanel / Webmail email account.`)}
                              </p>
                              <p className="text-[11px] text-amber-700 mt-1">
                                {mailbox.smtpHost?.includes("hostinger.com") ? (
                                  <>
                                    💡 <b>How to fix:</b> Hostinger hPanel me <b>Emails</b> &rarr; <b>Email Accounts</b> me jayein, <code>{mailbox.emailAddress}</code> ka password verify ya reset karein, phir yahan <b>&quot;Fix Password & Re-test&quot;</b> par click karke correct password enter karein.
                                  </>
                                ) : (
                                  <>
                                    💡 <b>How to fix:</b> cPanel / Webmail portal me ja kar <code>{mailbox.emailAddress}</code> ka password verify karein, aur Outgoing server <code>mail.{mailbox.emailAddress.split("@")[1] || "yourdomain.com"}</code> (Port 465 SSL) verify karein. Phir yahan <b>&quot;Fix Password & Re-test&quot;</b> par click karein.
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => edit(mailbox)}
                            className="shrink-0 self-start sm:self-center px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-extrabold rounded-xl text-xs shadow-xs hover:scale-105 active:scale-95 transition cursor-pointer flex items-center gap-1.5"
                          >
                            <span>✏️</span>
                            <span>Fix Password & Re-test</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
