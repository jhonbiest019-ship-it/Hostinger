"use client";

import { useEffect, useState, useMemo } from "react";
import { Badge, EmptyState } from "@/components/ui";
import { FollowUpBuilder } from "@/components/follow-up-builder";

type FollowUpItem = {
  id: string;
  jobId: string | null;
  messageId: string | null;
  recipientId: string;
  contactId: string;
  campaignId: string;
  campaignName: string;
  brandName: string;
  brandEmail: string;
  productCategory: string;
  stepNumber: number;
  delayAmount: number;
  delayUnit: string;
  templateId: string | null;
  templateName: string;
  subject: string;
  bodyPreview: string;
  runAt: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  status: "SCHEDULED" | "PROCESSING" | "SENT" | "REPLIED_STOPPED" | "CANCELLED" | "FAILED";
  lastError: string | null;
  stopReason: string | null;
};

type Stats = {
  total: number;
  scheduled: number;
  sent: number;
  replied: number;
  cancelled: number;
};

type Campaign = {
  id: string;
  name: string;
  followUpsEnabled: boolean;
};

export function FollowUpWorkspace() {
  const [activeTab, setActiveTab] = useState<"tracking" | "builder">("tracking");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedCampaign, setSelectedCampaign] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [items, setItems] = useState<FollowUpItem[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    scheduled: 0,
    sent: 0,
    replied: 0,
    cancelled: 0,
  });
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Preview Modal
  const [previewItem, setPreviewItem] = useState<FollowUpItem | null>(null);

  async function loadData() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedCampaign) params.set("campaignId", selectedCampaign);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/follow-ups?${params.toString()}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load follow-ups.");

      setItems(data.items || []);
      setStats(
        data.stats || {
          total: 0,
          scheduled: 0,
          sent: 0,
          replied: 0,
          cancelled: 0,
        }
      );
      setCampaigns(data.campaigns || []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading follow-ups.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [selectedCampaign, statusFilter]);

  async function syncInbox() {
    setSyncing(true);
    setNotice("");
    try {
      const res = await fetch("/api/inbox/sync", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inbox sync failed.");
      setNotice("Mailbox synced successfully. Any brand replies have been processed and matching follow-ups stopped.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync inbox.");
    } finally {
      setSyncing(false);
    }
  }

  async function markAsReplied(item: FollowUpItem) {
    if (!confirm(`Mark "${item.brandName || item.brandEmail}" as REPLIED?\n\nThis will immediately stop and cancel all future scheduled follow-up emails for this brand.`)) {
      return;
    }
    setActionBusy(item.id);
    setNotice("");
    setError("");
    try {
      const res = await fetch("/api/follow-ups/mark-replied", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipientId: item.recipientId,
          jobId: item.jobId,
          contactId: item.contactId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to mark as replied.");
      setNotice(data.message || `Brand marked as replied. Follow-ups stopped.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop follow-up.");
    } finally {
      setActionBusy(null);
    }
  }

  async function sendNow(item: FollowUpItem) {
    if (!item.jobId) return;
    if (!confirm(`Send follow-up email to "${item.brandName || item.brandEmail}" right now?`)) return;
    setActionBusy(item.id);
    setNotice("");
    setError("");
    try {
      const res = await fetch("/api/follow-ups/send-now", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: item.jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to expedite follow-up.");
      setNotice(data.message || "Follow-up queued for immediate delivery.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send follow-up.");
    } finally {
      setActionBusy(null);
    }
  }

  async function cancelFollowUp(item: FollowUpItem) {
    if (!item.jobId) return;
    if (!confirm(`Cancel this scheduled follow-up for "${item.brandName || item.brandEmail}"?`)) return;
    setActionBusy(item.id);
    setNotice("");
    setError("");
    try {
      const res = await fetch("/api/follow-ups/cancel", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: item.jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel follow-up.");
      setNotice(data.message || "Follow-up cancelled.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel follow-up.");
    } finally {
      setActionBusy(null);
    }
  }

  function formatDateTime(val: string | null) {
    if (!val) return "—";
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(val));
    } catch {
      return new Date(val).toLocaleString();
    }
  }

  // Filtered in-memory if user searches
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase().trim();
    return items.filter(
      (item) =>
        item.brandName.toLowerCase().includes(q) ||
        item.brandEmail.toLowerCase().includes(q) ||
        item.campaignName.toLowerCase().includes(q) ||
        item.subject.toLowerCase().includes(q) ||
        item.productCategory.toLowerCase().includes(q) ||
        item.templateName.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Top Banner Alert / Notices */}
      {notice && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm font-medium text-emerald-800">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{notice}</span>
          </div>
          <button
            onClick={() => setNotice("")}
            className="text-emerald-700 hover:text-emerald-900 font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm font-medium text-rose-800">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError("")}
            className="text-rose-700 hover:text-rose-900 font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Tabs Navigation & Action Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-line pb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("tracking")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === "tracking"
                ? "bg-[#673de6] text-white shadow-sm"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <span>📊</span>
            <span>Follow-up Activity & Tracking</span>
            <span className={`ml-1 text-xs px-2 py-0.5 rounded-full font-bold ${activeTab === "tracking" ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700"}`}>
              {stats.total}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("builder")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === "builder"
                ? "bg-[#673de6] text-white shadow-sm"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <span>⚙️</span>
            <span>Sequence Rules & Templates</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void syncInbox()}
            disabled={syncing}
            className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-sm disabled:opacity-50"
            title="Check mailboxes for brand replies to automatically stop follow-ups"
          >
            <span className={syncing ? "animate-spin" : ""}>🔄</span>
            <span>{syncing ? "Syncing..." : "Sync Mailbox Replies"}</span>
          </button>

          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-sm"
          >
            <span>↻</span>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {activeTab === "tracking" ? (
        <>
          {/* Key Metric Overview Cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div
              onClick={() => setStatusFilter("ALL")}
              className={`card p-4 cursor-pointer transition hover:border-[#673de6] ${
                statusFilter === "ALL" ? "border-[#673de6] ring-1 ring-[#673de6]" : ""
              }`}
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-bold uppercase tracking-wider">Total Tracked</span>
                <span className="text-sm">👥</span>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">{stats.total}</p>
              <p className="text-xs text-slate-500 mt-1">All brands in sequence</p>
            </div>

            <div
              onClick={() => setStatusFilter("SCHEDULED")}
              className={`card p-4 cursor-pointer transition hover:border-[#673de6] ${
                statusFilter === "SCHEDULED" ? "border-[#673de6] ring-1 ring-[#673de6]" : ""
              }`}
            >
              <div className="flex items-center justify-between text-blue-600">
                <span className="text-xs font-bold uppercase tracking-wider">Scheduled (Upcoming)</span>
                <span className="text-sm">⏱️</span>
              </div>
              <p className="mt-2 text-2xl font-bold text-blue-700">{stats.scheduled}</p>
              <p className="text-xs text-slate-500 mt-1">Waiting to be sent on delay</p>
            </div>

            <div
              onClick={() => setStatusFilter("SENT")}
              className={`card p-4 cursor-pointer transition hover:border-[#673de6] ${
                statusFilter === "SENT" ? "border-[#673de6] ring-1 ring-[#673de6]" : ""
              }`}
            >
              <div className="flex items-center justify-between text-emerald-600">
                <span className="text-xs font-bold uppercase tracking-wider">Follow-ups Sent</span>
                <span className="text-sm">📨</span>
              </div>
              <p className="mt-2 text-2xl font-bold text-emerald-700">{stats.sent}</p>
              <p className="text-xs text-slate-500 mt-1">Delivered via SMTP</p>
            </div>

            <div
              onClick={() => setStatusFilter("REPLIED")}
              className={`card p-4 cursor-pointer transition hover:border-purple-600 bg-purple-50/50 ${
                statusFilter === "REPLIED" ? "border-purple-600 ring-1 ring-purple-600" : ""
              }`}
            >
              <div className="flex items-center justify-between text-purple-700">
                <span className="text-xs font-bold uppercase tracking-wider">Replied (Stopped)</span>
                <span className="text-sm">🛑</span>
              </div>
              <p className="mt-2 text-2xl font-bold text-purple-800">{stats.replied}</p>
              <p className="text-xs text-purple-600 font-medium mt-1">Auto-stopped on reply</p>
            </div>

            <div
              onClick={() => setStatusFilter("CANCELLED")}
              className={`card p-4 cursor-pointer transition hover:border-slate-500 ${
                statusFilter === "CANCELLED" ? "border-slate-500 ring-1 ring-slate-500" : ""
              }`}
            >
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-bold uppercase tracking-wider">Cancelled / Other</span>
                <span className="text-sm">✕</span>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-700">{stats.cancelled}</p>
              <p className="text-xs text-slate-500 mt-1">Manual cancel or failed</p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="card p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="flex flex-1 items-center gap-3">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Search by Brand Name, Email, Campaign, Category, Subject..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-line bg-white pl-9 pr-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-[#673de6] focus:outline-none"
                />
                <span className="absolute left-3 top-2.5 text-slate-400 text-sm">🔍</span>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-600 font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              <select
                value={selectedCampaign}
                onChange={(e) => setSelectedCampaign(e.target.value)}
                className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-slate-700 min-w-[200px]"
              >
                <option value="">All Campaigns</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Quick Status Pill Bar */}
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { label: "All", value: "ALL" },
                { label: "Scheduled", value: "SCHEDULED" },
                { label: "Sent", value: "SENT" },
                { label: "Replied (Stopped)", value: "REPLIED" },
                { label: "Cancelled", value: "CANCELLED" },
              ].map((pill) => (
                <button
                  key={pill.value}
                  type="button"
                  onClick={() => setStatusFilter(pill.value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    statusFilter === pill.value
                      ? "bg-[#673de6] text-white shadow-sm"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          {/* Follow-ups Tracking Table */}
          <div className="card overflow-hidden">
            <div className="border-b border-line px-5 py-3.5 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">
                  Brand Follow-up Sequences
                </h3>
                <p className="text-xs text-slate-500">
                  Real-time status of all queued and sent follow-up emails. Sequences halt automatically when brand replies.
                </p>
              </div>
              <span className="text-xs font-bold text-slate-500">
                Showing {filteredItems.length} of {stats.total} record(s)
              </span>
            </div>

            {loading ? (
              <div className="py-16 text-center text-sm text-slate-500">
                <span className="inline-block animate-spin text-xl mr-2">🔄</span>
                Loading follow-up activity...
              </div>
            ) : filteredItems.length === 0 ? (
              <EmptyState
                title="No follow-up activity found"
                description={
                  searchQuery || selectedCampaign || statusFilter !== "ALL"
                    ? "No follow-up records match your selected filters. Try clearing filters or search query."
                    : "When you schedule campaigns with follow-ups enabled, every brand's sequence will appear here with complete real-time tracking."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-slate-50/70 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Brand / Recipient</th>
                      <th className="px-4 py-3 font-semibold">Campaign</th>
                      <th className="px-4 py-3 font-semibold">Follow-up Step</th>
                      <th className="px-4 py-3 font-semibold">Template Assigned</th>
                      <th className="px-4 py-3 font-semibold">Scheduled / Sent Time</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filteredItems.map((item) => (
                      <tr
                        key={item.id}
                        className={`hover:bg-slate-50/80 transition ${
                          item.status === "REPLIED_STOPPED"
                            ? "bg-purple-50/30"
                            : ""
                        }`}
                      >
                        {/* Brand / Recipient Info */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-start gap-2.5">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 font-bold text-xs text-slate-600 uppercase border border-slate-200">
                              {item.brandName.slice(0, 2) || "BR"}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 truncate">
                                {item.brandName}
                              </p>
                              <a
                                href={`mailto:${item.brandEmail}`}
                                className="text-xs text-blue-600 hover:underline block truncate"
                              >
                                {item.brandEmail}
                              </a>
                              {item.productCategory && (
                                <span className="inline-block mt-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                                  🏷️ {item.productCategory}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Campaign */}
                        <td className="px-4 py-3.5">
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                            <span>🎯</span>
                            <span className="truncate max-w-[140px]">{item.campaignName}</span>
                          </span>
                        </td>

                        {/* Follow-up Step & Delay */}
                        <td className="px-4 py-3.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-[#673de6]">
                              <span>🔁</span>
                              <span>Step #{item.stepNumber}</span>
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {item.delayAmount} {item.delayUnit.toLowerCase()} after previous
                            </span>
                          </div>
                        </td>

                        {/* Template Assigned */}
                        <td className="px-4 py-3.5">
                          <div className="max-w-[200px]">
                            <p className="text-xs font-semibold text-slate-800 truncate" title={item.templateName}>
                              📄 {item.templateName}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate mt-0.5" title={item.subject}>
                              {item.subject}
                            </p>
                            <button
                              type="button"
                              onClick={() => setPreviewItem(item)}
                              className="text-[11px] font-semibold text-blue-600 hover:underline mt-1 block"
                            >
                              Preview Content
                            </button>
                          </div>
                        </td>

                        {/* Timing */}
                        <td className="px-4 py-3.5 text-xs text-slate-600">
                          {item.status === "SENT" ? (
                            <div>
                              <span className="font-semibold text-emerald-700">Sent:</span>
                              <p className="text-[11px] text-slate-500">{formatDateTime(item.sentAt)}</p>
                            </div>
                          ) : item.status === "REPLIED_STOPPED" ? (
                            <div>
                              <span className="font-semibold text-purple-700">Replied:</span>
                              <p className="text-[11px] text-purple-600">{formatDateTime(item.repliedAt)}</p>
                            </div>
                          ) : (
                            <div>
                              <span className="font-semibold text-blue-700">Scheduled:</span>
                              <p className="text-[11px] text-slate-500">{formatDateTime(item.runAt)}</p>
                            </div>
                          )}
                        </td>

                        {/* Status Badge */}
                        <td className="px-4 py-3.5">
                          {item.status === "REPLIED_STOPPED" ? (
                            <div className="flex flex-col gap-1 items-start">
                              <Badge tone="blue">
                                🛑 Brand Replied (Stopped)
                              </Badge>
                              <span className="text-[10px] text-purple-700 font-medium">
                                Follow-up cancelled
                              </span>
                            </div>
                          ) : item.status === "SENT" ? (
                            <Badge tone="green">
                              ✓ Follow-up Sent
                            </Badge>
                          ) : item.status === "SCHEDULED" ? (
                            <div className="flex flex-col gap-1 items-start">
                              <Badge tone="neutral">
                                ⏱️ Scheduled
                              </Badge>
                            </div>
                          ) : item.status === "PROCESSING" ? (
                            <Badge tone="amber">
                              ⚡ In Flight
                            </Badge>
                          ) : (
                            <div className="flex flex-col gap-1 items-start">
                              <Badge tone="neutral">
                                {item.status}
                              </Badge>
                              {item.lastError && (
                                <span className="text-[10px] text-rose-600 line-clamp-1 max-w-[130px]" title={item.lastError}>
                                  {item.lastError}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Action to Mark as Replied and Stop Follow-up if currently Scheduled */}
                            {(item.status === "SCHEDULED" || item.status === "PROCESSING") && (
                              <button
                                type="button"
                                disabled={actionBusy === item.id}
                                onClick={() => void markAsReplied(item)}
                                className="rounded-md border border-purple-200 bg-purple-50 px-2 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-100 transition shadow-xs"
                                title="Click if brand contacted you outside the system. Cancels all pending follow-ups."
                              >
                                {actionBusy === item.id ? "..." : "🛑 Stop (Replied)"}
                              </button>
                            )}

                            {/* Action to Send Follow-up Now */}
                            {item.status === "SCHEDULED" && item.jobId && (
                              <button
                                type="button"
                                disabled={actionBusy === item.id}
                                onClick={() => void sendNow(item)}
                                className="rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 transition shadow-xs"
                                title="Send this follow-up immediately without waiting for schedule"
                              >
                                🚀 Send Now
                              </button>
                            )}

                            {/* Action to Cancel scheduled follow-up */}
                            {item.status === "SCHEDULED" && item.jobId && (
                              <button
                                type="button"
                                disabled={actionBusy === item.id}
                                onClick={() => void cancelFollowUp(item)}
                                className="rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition shadow-xs"
                                title="Cancel this follow-up email"
                              >
                                ✕
                              </button>
                            )}

                            {/* View Full Email Modal Button */}
                            <button
                              type="button"
                              onClick={() => setPreviewItem(item)}
                              className="rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
                              title="View full follow-up email body and parameters"
                            >
                              👁️ View
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Sequence Builder Tab */
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-cloud/50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Campaign Sequence Configuration
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Configure multi-step automated follow-up sequences. Choose your saved templates, delays, and timezones.
              Follow-ups always stop automatically as soon as a brand responds to any email.
            </p>
          </div>
          <FollowUpBuilder />
        </div>
      )}

      {/* Email Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl border border-line bg-white p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📄</span>
                <div>
                  <h3 className="font-bold text-slate-900">
                    Follow-up Email Details (Step #{previewItem.stepNumber})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Template: <strong className="text-slate-700">{previewItem.templateName}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="grid gap-2 text-xs bg-slate-50 p-3.5 rounded-xl border border-line">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Brand Recipient:</span>
                <span className="font-semibold text-slate-800">
                  {previewItem.brandName} &lt;{previewItem.brandEmail}&gt;
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Campaign:</span>
                <span className="font-semibold text-slate-800">{previewItem.campaignName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Delay Setting:</span>
                <span className="font-semibold text-slate-800">
                  {previewItem.delayAmount} {previewItem.delayUnit.toLowerCase()} after previous email
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Status:</span>
                <span className="font-semibold text-slate-800">{previewItem.status}</span>
              </div>
              {previewItem.stopReason && (
                <div className="flex justify-between bg-purple-100/60 p-2 rounded-lg text-purple-900">
                  <span className="font-medium">Sequence Stop Reason:</span>
                  <span className="font-bold">{previewItem.stopReason}</span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">Subject</label>
              <div className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                {previewItem.subject}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">Message Body</label>
              <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-slate-50 p-4 text-xs font-mono text-slate-800 leading-relaxed">
                {previewItem.bodyPreview || "(No body content)"}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="btn-secondary text-xs px-4 py-2"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
