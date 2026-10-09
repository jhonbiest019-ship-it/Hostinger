"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge, EmptyState } from "@/components/ui";

type Contact = { id: string; name: string; fullName: string | null; brandName: string | null; companyName: string | null; email: string; status: string };
type Recipient = { id: string; contactId: string; status: string; contact: Contact };
type Campaign = { id: string; name: string; description: string | null; status: string; mailbox: { emailAddress: string; displayName: string | null } | null; template: { name: string; subject: string; body: string } | null; recipients: Recipient[]; followUpRules: { stepNumber: number; delayAmount: number; delayUnit: string; template: { name: string } | null }[]; scheduledJobs: { followUpStep: number | null; status: string; runAt: string; timezone: string; lastError: string | null }[]; counters: { total: number; pending: number; sending: number; sent: number; failed: number; skipped: number }; createdAt: string; updatedAt: string };

function nameOf(contact: Contact) { return contact.fullName || contact.name; }

export function CampaignDetail({ id }: { id: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [brand, setBrand] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [timezone, setTimezone] = useState(() => typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC");

  async function request(path: string, options?: RequestInit) {
    const response = await fetch(path, { ...options, credentials: "include", headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Request failed.");
    return body;
  }

  async function load() {
    try {
      const [campaignData, contactData] = await Promise.all([request(`/api/campaigns/${id}`), request("/api/contacts?pageSize=1000")]);
      setCampaign(campaignData.campaign);
      setSelected(campaignData.campaign.recipients.map((item: Recipient) => item.contactId));
      setContacts(contactData.contacts);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load campaign."); }
  }

  useEffect(() => { void load(); }, [id]);
  const visible = useMemo(() => contacts.filter((contact) => contact.status !== "DO_NOT_CONTACT" && contact.status !== "INVALID" && (!search || `${nameOf(contact)} ${contact.email} ${contact.brandName ?? ""} ${contact.companyName ?? ""}`.toLowerCase().includes(search.toLowerCase())) && (!status || contact.status === status) && (!brand || (contact.brandName ?? contact.companyName ?? "").toLowerCase().includes(brand.toLowerCase()))), [contacts, search, status, brand]);
  const excluded = contacts.filter((contact) => contact.status === "DO_NOT_CONTACT" || contact.status === "INVALID");

  function toggle(contactId: string) { setSelected((current) => current.includes(contactId) ? current.filter((value) => value !== contactId) : [...current, contactId]); }
  function toggleVisible() { const ids = visible.map((contact) => contact.id); const allSelected = ids.every((contactId) => selected.includes(contactId)); setSelected((current) => allSelected ? current.filter((value) => !ids.includes(value)) : [...new Set([...current, ...ids])]); }
  async function saveRecipients() { setBusy(true); try { const body = await request(`/api/campaigns/${id}/recipients`, { method: "PUT", body: JSON.stringify({ contactIds: selected }) }); setMessage(body.message); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save recipients."); } finally { setBusy(false); } }
  async function ready() { setBusy(true); try { const body = await request(`/api/campaigns/${id}/ready`, { method: "POST", body: "{}" }); setMessage(`Campaign is ${body.status}.`); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Campaign is not ready."); } finally { setBusy(false); } }
  async function queue(mode: "sendNow" | "schedule") { setBusy(true); try { const body = await request(`/api/campaigns/${id}/schedule`, { method: "POST", body: JSON.stringify(mode === "sendNow" ? { mode } : { mode, date: scheduleDate, time: scheduleTime, timezone }) }); setMessage(`${body.queued} recipient jobs queued.`); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to queue campaign."); } finally { setBusy(false); } }
  async function cancel() { if (!window.confirm("Cancel this campaign? Pending jobs will not send.")) return; try { await request(`/api/campaigns/${id}/cancel`, { method: "POST", body: "{}" }); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to cancel campaign."); } }

  if (!campaign) return <div className="card p-10 text-center text-sm text-slate-500">{message || "Loading campaign..."}</div>;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><Link className="text-sm font-semibold text-slate-500 hover:text-ink" href="/campaigns">Back to campaigns</Link><h2 className="mt-3 text-2xl font-bold">{campaign.name}</h2><p className="mt-2 text-sm text-slate-500">{campaign.description || "No campaign notes."}</p></div><Badge tone={campaign.status === "READY" ? "green" : campaign.status === "CANCELLED" ? "amber" : "neutral"}>{campaign.status}</Badge></div>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div className="card p-5"><p className="text-xs uppercase text-slate-400">From</p><p className="mt-2 font-semibold">{campaign.mailbox?.emailAddress ?? "Not selected"}</p></div><div className="card p-5"><p className="text-xs uppercase text-slate-400">Template</p><p className="mt-2 font-semibold">{campaign.template?.name ?? "Not selected"}</p></div><div className="card p-5"><p className="text-xs uppercase text-slate-400">Recipients</p><p className="mt-2 text-2xl font-bold">{campaign.counters.total}</p></div><div className="card p-5"><p className="text-xs uppercase text-slate-400">Pending / Sending / Sent / Failed</p><p className="mt-2 font-semibold">{campaign.counters.pending} / {campaign.counters.sending} / {campaign.counters.sent} / {campaign.counters.failed}</p></div></section>
    <section className="card p-6"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contacts" className="flex-1 rounded-lg border border-line px-4 py-2.5 text-sm" /><input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Filter brand/company" className="rounded-lg border border-line px-4 py-2.5 text-sm" /><select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm"><option value="">All selectable statuses</option><option>ACTIVE</option><option>CONTACTED</option><option>REPLIED</option></select><button className="btn-secondary" type="button" onClick={toggleVisible}>Select all visible</button></div><div className="mt-5 flex items-center justify-between"><p className="text-sm font-semibold">Selected recipients: {selected.length}</p><p className="text-sm text-slate-500">{excluded.length} excluded</p></div>{visible.length === 0 ? <div className="mt-5"><EmptyState title="No selectable contacts" description="Adjust filters or add valid contacts first." /></div> : <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-line bg-cloud/60"><tr>{["Select", "Name", "Brand", "Email", "Status"].map((heading) => <th key={heading} className="px-4 py-3 text-xs uppercase text-slate-400">{heading}</th>)}</tr></thead><tbody>{visible.map((contact) => <tr className="border-b border-line last:border-0" key={contact.id}><td className="px-4 py-3"><input type="checkbox" checked={selected.includes(contact.id)} onChange={() => toggle(contact.id)} /></td><td className="px-4 py-3 font-medium">{nameOf(contact)}</td><td className="px-4 py-3">{contact.brandName || contact.companyName || "-"}</td><td className="px-4 py-3 text-slate-500">{contact.email}</td><td className="px-4 py-3"><Badge>{contact.status}</Badge></td></tr>)}</tbody></table></div>}
      <div className="mt-5 flex flex-wrap gap-3"><button className="btn-primary" disabled={busy} onClick={() => void saveRecipients()}>{busy ? "Saving..." : "Save recipients"}</button><button className="btn-secondary" disabled={busy || selected.length === 0} onClick={() => void ready()}>Review and mark READY</button><button className="btn-secondary" onClick={() => void cancel()}>Cancel campaign</button></div>
      {campaign.status === "READY" && <div className="mt-5 rounded-xl border border-line bg-cloud p-5"><h3 className="font-semibold">Send mode</h3><p className="mt-1 text-sm text-slate-500">The server queue sends emails; the browser does not need to stay open.</p><div className="mt-4 grid gap-3 sm:grid-cols-3"><button className="btn-primary" disabled={busy} onClick={() => void queue("sendNow")}>Send Now (queue)</button><input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} className="rounded-lg border border-line px-3 py-2.5 text-sm" /><input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} className="rounded-lg border border-line px-3 py-2.5 text-sm" /></div><div className="mt-3 flex flex-wrap gap-3"><select value={timezone} onChange={(event) => setTimezone(event.target.value)} className="rounded-lg border border-line bg-white px-3 py-2.5 text-sm"><option>Asia/Karachi</option><option>UTC</option><option>America/New_York</option><option>Europe/London</option></select><button className="btn-secondary" disabled={busy} onClick={() => void queue("schedule")}>Schedule campaign</button></div></div>}
      {message && <p className="mt-4 rounded-lg bg-cloud px-4 py-3 text-sm text-slate-600" role="status">{message}</p>}
    </section>
    <section className="card p-6"><h2 className="font-semibold">Follow-ups</h2><div className="mt-4 space-y-3">{campaign.followUpRules.length === 0 ? <p className="text-sm text-slate-500">No follow-up steps configured.</p> : campaign.followUpRules.map((rule) => { const job = campaign.scheduledJobs.find((item) => item.followUpStep === rule.stepNumber); return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-cloud px-4 py-3 text-sm" key={rule.stepNumber}><span><strong>Follow-up #{rule.stepNumber}</strong> · {rule.template?.name ?? "Template removed"} · after {rule.delayAmount} {rule.delayUnit.toLowerCase()}</span><Badge tone={job?.status === "COMPLETED" ? "green" : job?.status === "CANCELLED" ? "amber" : "neutral"}>{job?.status ?? "NOT SCHEDULED"}</Badge></div>; })}</div></section><section className="card p-6"><h2 className="font-semibold">Campaign review</h2><div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><p>Campaign: <strong>{campaign.name}</strong></p><p>From: <strong>{campaign.mailbox?.emailAddress ?? "Not selected"}</strong></p><p>Template: <strong>{campaign.template?.name ?? "Not selected"}</strong></p><p>Total selected: <strong>{selected.length}</strong></p></div><p className="mt-4 text-sm text-slate-500">Scheduling creates server-side jobs and does not send directly from this page.</p></section>
  </div>;
}
