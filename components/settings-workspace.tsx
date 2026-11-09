"use client";
import { FormEvent, useEffect, useState } from "react";
import { DEFAULT_TIMEZONE, TIMEZONES } from "@/lib/preferences";

export function SettingsWorkspace() {
  const [settings, setSettings] = useState({ name: "", email: "", timezone: DEFAULT_TIMEZONE });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [testMode, setTestMode] = useState(false);
  useEffect(() => { fetch("/api/settings").then(async (response) => {
    const body = await response.json(); if (!response.ok) throw new Error(body.error);
    setSettings({ ...body.settings, name: body.settings.name ?? "" }); setTestMode(body.testMode); setLoaded(true);
  }).catch((err) => setError(err.message)); }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: settings.name, timezone: settings.timezone, ...(newPassword ? { currentPassword, newPassword } : {}) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setSettings(body.settings); setCurrentPassword(""); setNewPassword(""); setMessage("Settings saved. Your timezone will be used for new schedules.");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save settings."); } finally { setBusy(false); }
  }
  const inputClass = "mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm";
  return <form onSubmit={save} className="max-w-3xl space-y-5">
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-mint p-4 text-sm">{message}</p>}
    <section className="card space-y-5 p-6"><h2 className="font-semibold">Account and preferences</h2>
      <label className="block text-sm">Name<input required maxLength={100} value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} className={inputClass} /></label>
      <p className="text-sm text-slate-500">Sign-in email: {settings.email || "Loading…"}</p>
      <label className="block text-sm">Default timezone<select value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} className={inputClass}>{[...new Set([...TIMEZONES, settings.timezone])].map((zone) => <option key={zone}>{zone}</option>)}</select></label>
      <p className="text-sm text-slate-500">Existing schedules keep their selected timezone. Choose the mailbox, template and recipients in each campaign.</p>
    </section>
    <section className="card space-y-5 p-6"><h2 className="font-semibold">Change password</h2><p className="text-sm text-slate-500">Leave these fields blank to keep your password.</p>
      <label className="block text-sm">Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputClass} required={Boolean(newPassword)} /></label>
      <label className="block text-sm">New password<input type="password" autoComplete="new-password" minLength={10} maxLength={200} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputClass} /></label>
    </section>
    {loaded && <p className="text-sm text-slate-600">{testMode ? "Test mode is active: emails are simulated and no SMTP/IMAP network connections are made." : "Live mail mode is active. Verify your mailbox before sending."}</p>}
    <button className="btn-primary" disabled={!loaded || busy}>{busy ? "Saving…" : "Save settings"}</button>
  </form>;
}
