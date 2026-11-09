"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, FormEvent } from "react";
import { Badge } from "@/components/ui";
import { DEFAULT_TIMEZONE, TIMEZONES } from "@/lib/preferences";
import { PreSendReviewModal, ReviewRecipient } from "@/components/pre-send-review-modal";

export interface CampaignBrandRecipient {
  id: string;
  contactId: string;
  status: string;
  brandName: string;
  email: string;
  category: string;
  sheetRowIndex?: number | null;
  sentAt?: string | null;
  errorMessage?: string | null;
  sheetSyncStatus: string;
  sheetSyncedAt?: string | null;
  sheetSyncError?: string | null;
  scheduledRunAt?: string | null;
  formStatus?: string | null;
  formUrl?: string | null;
  formExcluded?: boolean;
  formMissingInfo?: string | null;
  formJob?: {
    id: string;
    status: string;
    targetUrl: string;
    runAt: string;
    submittedAt?: string | null;
    lastError?: string | null;
    manualActionReason?: string | null;
    browserTabId?: string | null;
  } | null;
  contact: {
    id: string;
    name: string;
    fullName?: string | null;
    brandName?: string | null;
    companyName?: string | null;
    email: string;
    notes?: string | null;
    website?: string | null;
    status: string;
  };
}

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  sheetUrl?: string | null;
  sheetTab?: string | null;
  sheetWebhookUrl?: string | null;
  status: string;
  formAutomationEnabled?: boolean;
  formTemplateId?: string | null;
  formScheduleMode?: string;
  formScheduledAt?: string | null;
  formConcurrency?: number;
  formTemplate?: { id: string; name: string; description?: string | null } | null;
  mailbox: { id: string; emailAddress: string; displayName?: string | null } | null;
  template: { id: string; name: string; subject: string; body: string } | null;
  recipients: CampaignBrandRecipient[];
  followUpRules: {
    stepNumber: number;
    delayAmount: number;
    delayUnit: string;
    template: { name: string } | null;
  }[];
  scheduledJobs: { followUpStep: number | null; status: string }[];
  counters: Record<string, number>;
  formCounters?: {
    total: number;
    pending: number;
    inProgress: number;
    submitted: number;
    awaitingManual: number;
    failed: number;
    notAvailable: number;
    excluded: number;
  };
  rowSelection?: {
    startRow: number;
    endRow: number;
    totalSelected: number;
    completeCount: number;
    missingEmailCount: number;
    missingBrandCount: number;
    missingCategoryCount: number;
  };
  createdAt: string;
  updatedAt: string;
}

export function CampaignDetail({ id }: { id: string }) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [mailboxes, setMailboxes] = useState<{ id: string; emailAddress: string; displayName?: string | null }[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; subject?: string; isDefault?: boolean }[]>([]);
  const [mailboxId, setMailboxId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "SENT" | "PENDING" | "FAILED" | "NEED_SYNC" | "MANUAL_ACTION" | "FORM_SUBMITTED" | "FORM_FAILED">("ALL");
  const [browserAgentStatus, setBrowserAgentStatus] = useState<string>("OFFLINE");
  const [agentActionBusy, setAgentActionBusy] = useState(false);
  const [urlModalRecipient, setUrlModalRecipient] = useState<CampaignBrandRecipient | null>(null);
  const [urlModalValue, setUrlModalValue] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);

  // Edit Campaign Modal State (Supports draft, running, and paused campaigns)
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editMailboxId, setEditMailboxId] = useState("");
  const [editTemplateId, setEditTemplateId] = useState("");
  const [editDelaySeconds, setEditDelaySeconds] = useState(60);
  const [editSheetUrl, setEditSheetUrl] = useState("");
  const [editSheetWebhookUrl, setEditSheetWebhookUrl] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Webhook settings modal
  const [webhookModalOpen, setWebhookModalOpen] = useState(false);
  const [webhookUrlInput, setWebhookUrlInput] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [syncingSheet, setSyncingSheet] = useState(false);

  // Add Email Manually Modal State
  const [addEmailModalOpen, setAddEmailModalOpen] = useState(false);
  const [addEmailMode, setAddEmailMode] = useState<"single" | "bulk">("single");
  const [manualEmail, setManualEmail] = useState("");
  const [manualBrandName, setManualBrandName] = useState("");
  const [manualCategory, setManualCategory] = useState("");
  const [manualWebsite, setManualWebsite] = useState("");
  const [bulkEmailsText, setBulkEmailsText] = useState("");
  const [addingRecipient, setAddingRecipient] = useState(false);

  // Pre-Send Review Modal State (Mandatory template review before dispatch)
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewModalData, setReviewModalData] = useState<{
    sendMode: "sendNow" | "schedule";
    scheduledTime?: string;
  } | null>(null);
  const [reviewConfirming, setReviewConfirming] = useState(false);

  function handleOpenPreSendReview(mode: "sendNow" | "schedule") {
    if (!campaign) return;
    if (mode === "schedule" && (!scheduleDate || !scheduleTime)) {
      setError("Please pick both a date and time to schedule.");
      return;
    }
    setError("");
    setMessage("");
    setReviewModalData({
      sendMode: mode,
      scheduledTime: mode === "schedule" ? `${scheduleDate}T${scheduleTime}` : undefined,
    });
    setReviewModalOpen(true);
  }

  async function handleConfirmPreSend() {
    if (!reviewModalData) return;
    setReviewConfirming(true);
    try {
      if (reviewModalData.sendMode === "sendNow") {
        await action(`/api/campaigns/${id}/schedule`, "POST", { mode: "sendNow" }, "Campaign dispatch started!");
      } else {
        await action(
          `/api/campaigns/${id}/schedule`,
          "POST",
          { mode: "schedule", date: scheduleDate, time: scheduleTime, timezone },
          "Campaign scheduled successfully."
        );
      }
      setReviewModalOpen(false);
    } catch {
      // action handles error state
    } finally {
      setReviewConfirming(false);
    }
  }

  async function handleAddManualRecipient(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setAddingRecipient(true);

    try {
      let payload: any = {};
      if (addEmailMode === "single") {
        const email = manualEmail.trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setError("Please enter a valid email address.");
          setAddingRecipient(false);
          return;
        }
        payload = {
          email,
          brandName: manualBrandName.trim() || undefined,
          productCategory: manualCategory.trim() || undefined,
          website: manualWebsite.trim() || undefined,
        };
      } else {
        const lines = bulkEmailsText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const parsedRecipients: any[] = [];

        for (const line of lines) {
          const parts = line.split(/[,;\t]/).map((p) => p.trim());
          const emailIdx = parts.findIndex((p) => emailRegex.test(p.toLowerCase()));
          if (emailIdx !== -1) {
            const email = parts[emailIdx].toLowerCase();
            const brandName = emailIdx > 0 ? parts[0] : "";
            const category = parts.length > emailIdx + 1 && parts[emailIdx + 1] ? parts[emailIdx + 1] : "General";
            const website = parts.length > emailIdx + 2 && parts[emailIdx + 2] ? parts[emailIdx + 2] : "";
            parsedRecipients.push({ email, brandName, productCategory: category, website });
          } else {
            const match = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (match) {
              const email = match[0].toLowerCase();
              parsedRecipients.push({ email, brandName: email.split("@")[0], productCategory: "General" });
            }
          }
        }

        if (parsedRecipients.length === 0) {
          setError("No valid emails found in the bulk input.");
          setAddingRecipient(false);
          return;
        }
        payload = { recipients: parsedRecipients };
      }

      const res = await fetch(`/api/campaigns/${id}/recipients`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add email to campaign.");

      setMessage(data.message || "Email added successfully!");
      setAddEmailModalOpen(false);
      setManualEmail("");
      setManualBrandName("");
      setManualCategory("");
      setManualWebsite("");
      setBulkEmailsText("");
      await load(false);
    } catch (err: any) {
      setError(err.message || "Failed to add email to campaign.");
    } finally {
      setAddingRecipient(false);
    }
  }

  async function handleRemoveRecipient(recipientId: string, email: string) {
    if (!confirm(`Are you sure you want to remove "${email}" from this campaign?`)) return;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${id}/recipients?recipientId=${encodeURIComponent(recipientId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove recipient.");
      setMessage(`✓ Removed "${email}" from this campaign.`);
      await load(false);
    } catch (err: any) {
      setError(err.message || "Failed to remove recipient.");
    } finally {
      setBusy(false);
    }
  }

  const editable = Boolean(campaign && ["DRAFT", "READY"].includes(campaign.status));

  async function request(path: string, options?: RequestInit) {
    const response = await fetch(path, {
      ...options,
      headers: { "content-type": "application/json", ...(options?.headers || {}) },
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error([body.error, ...(body.reasons ?? [])].filter(Boolean).join(" ") || "Request failed.");
    }
    return body;
  }

  async function load(reset = false) {
    const body = await request(`/api/campaigns/${id}`);
    setCampaign(body.campaign);
    if (reset) {
      setSelected(body.campaign.recipients.map((item: CampaignBrandRecipient) => item.contactId));
      setMailboxId(body.campaign.mailbox?.id ?? "");
      setTemplateId(body.campaign.template?.id ?? "");
      setWebhookUrlInput(body.campaign.sheetWebhookUrl ?? "");
    }
  }

  useEffect(() => {
    void load(true).catch((err) => setError(err.message));
    void Promise.all([
      request("/api/contacts?pageSize=1000"),
      request("/api/mailboxes"),
      request("/api/templates"),
      request("/api/settings"),
    ])
      .then(([c, m, t, s]) => {
        setContacts(c.contacts || []);
        setMailboxes(
          (m.mailboxes || []).filter(
            (item: { status: string; smtpStatus: string }) => item.status === "ACTIVE" && item.smtpStatus === "CONNECTED"
          )
        );
        setTemplates((t.templates || []).filter((item: { status: string }) => item.status === "ACTIVE"));
        if (s?.settings?.timezone) setTimezone(s.settings.timezone);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    if (!campaign || ["DRAFT", "READY", "COMPLETED", "CANCELLED"].includes(campaign.status)) return;
    const timer = setInterval(() => {
      void load().catch((err) => setError(err.message));
    }, 6000);
    return () => clearInterval(timer);
  }, [id, campaign?.status]);

  async function loadAgentStatus() {
    try {
      const res = await fetch("/api/browser-agent");
      if (res.ok) {
        const d = await res.json();
        setBrowserAgentStatus(d.agent?.status || "OFFLINE");
      }
    } catch {}
  }

  async function handleResolveManualAction(jobId: string, outcome: "SUBMITTED" | "FAILED") {
    setAgentActionBusy(true);
    try {
      const res = await fetch("/api/browser-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resolve_manual", jobId, outcome }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      setMessage(`Action resolved as ${outcome}!`);
      await load();
      await loadAgentStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAgentActionBusy(false);
    }
  }

  async function handleProcessDueForms() {
    setAgentActionBusy(true);
    try {
      const res = await fetch("/api/browser-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "process" }),
      });
      const d = await res.json();
      setMessage(`Browser agent executed! Processed ${d.processedCount || 0} form job(s).`);
      await load();
      await loadAgentStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAgentActionBusy(false);
    }
  }

  async function handleLaunchBrowser() {
    setAgentActionBusy(true);
    try {
      const res = await fetch("/api/browser-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "launch" }),
      });
      const d = await res.json();
      if (d.success) {
        setBrowserAgentStatus("READY");
        setMessage("Google Chrome successfully launched with automation port connected!");
      } else {
        setError("Unable to launch browser automatically. Ensure Google Chrome is installed.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAgentActionBusy(false);
    }
  }

  async function handleUpdateRecipientUrl(recipientId: string, url: string) {
    if (!url.trim()) return;
    try {
      const res = await fetch("/api/browser-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update_url_and_schedule",
          campaignRecipientId: recipientId,
          targetUrl: url.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to update URL");
      setMessage("Target form URL updated and scheduled for automation!");
      setUrlModalRecipient(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    void loadAgentStatus();
  }, []);

  async function action(path: string, method = "POST", data: unknown = {}, success = "Saved.") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = await request(path, { method, body: JSON.stringify(data) });
      setMessage(
        body.queued
          ? `${body.queued} emails scheduled. Keep the background worker running.`
          : success + (body.inFlight ? " A message already submitted to SMTP may finish." : "")
      );
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  // Handle single recipient sheet sync retry (CRUCIAL: NEVER re-sends email)
  async function handleRetryRecipientSheetSync(recipientId: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await request(`/api/campaigns/${id}/sync-sheet`, {
        method: "POST",
        body: JSON.stringify({ recipientId }),
      });
      if (res.success) {
        setMessage("✓ Google Sheet row updated successfully!");
      } else {
        setError(res.error || "Could not update Google Sheet. Please check webhook configuration.");
      }
      await load(false);
    } catch (err: any) {
      setError(err.message || "Failed to retry Google Sheet sync.");
    } finally {
      setBusy(false);
    }
  }

  // Handle batch sheet sync retry for all unsynced brands
  async function handleBatchSheetSync() {
    setSyncingSheet(true);
    setError("");
    setMessage("");
    try {
      const res = await request(`/api/campaigns/${id}/sync-sheet`, {
        method: "POST",
        body: JSON.stringify({ batch: true }),
      });
      setMessage(res.message || `Synced ${res.synced} brands to Google Sheet!`);
      await load(false);
    } catch (err: any) {
      setError(err.message || "Failed to sync Google Sheet rows.");
    } finally {
      setSyncingSheet(false);
    }
  }

  // Save webhook URL
  async function handleSaveWebhook(e: React.FormEvent) {
    e.preventDefault();
    setSavingWebhook(true);
    setError("");
    setMessage("");
    try {
      await request(`/api/campaigns/${id}/sync-sheet`, {
        method: "POST",
        body: JSON.stringify({ webhookUrl: webhookUrlInput.trim(), batch: true }),
      });
      setMessage("✓ Google Sheet Webhook saved! Rows will automatically update on email delivery.");
      setWebhookModalOpen(false);
      await load(false);
    } catch (err: any) {
      setError(err.message || "Failed to save webhook URL.");
    } finally {
      setSavingWebhook(false);
    }
  }

  // Open Edit Campaign Modal
  function handleOpenEditModal() {
    if (!campaign) return;
    setEditName(campaign.name);
    setEditDescription(campaign.description || "");
    setEditMailboxId(campaign.mailbox?.id || (mailboxes[0]?.id || ""));
    setEditTemplateId(campaign.template?.id || (templates[0]?.id || ""));
    setEditDelaySeconds(60);
    setEditSheetUrl(campaign.sheetUrl || "");
    setEditSheetWebhookUrl(campaign.sheetWebhookUrl || "");
    setEditModalOpen(true);
  }

  // Save Edits for Campaign (works for draft, running, and paused campaigns)
  async function handleSaveEditedCampaign(e: React.FormEvent) {
    e.preventDefault();
    if (!campaign) return;
    setEditSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          mailboxId: editMailboxId || null,
          templateId: editTemplateId || null,
          delaySeconds: editDelaySeconds,
          sheetUrl: editSheetUrl.trim() || null,
          sheetWebhookUrl: editSheetWebhookUrl.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update campaign.");
      setMessage(`✓ Campaign "${editName}" updated successfully! Settings applied to all remaining emails.`);
      setEditModalOpen(false);
      await load(false);
    } catch (err: any) {
      setError(err.message || "Failed to save edits.");
    } finally {
      setEditSaving(false);
    }
  }

  // Delete Campaign (stops all unsent emails immediately and cleans up)
  async function handleDeleteCampaign() {
    if (!campaign) return;
    const isRunning = ["SCHEDULED", "SENDING", "ACTIVE", "PAUSED"].includes(campaign.status);
    const promptMsg = isRunning
      ? `Delete in-progress campaign "${campaign.name}"?\n\nThis will immediately STOP all remaining unsent emails and permanently remove the campaign.`
      : `Delete campaign "${campaign.name}"?`;
    if (!confirm(promptMsg)) return;

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete campaign.");
      router.push("/campaigns");
    } catch (err: any) {
      setError(err.message || "Failed to delete campaign.");
      setBusy(false);
    }
  }

  // Filtered recipients
  const filteredRecipients = useMemo(() => {
    if (!campaign) return [];
    return campaign.recipients.filter((item) => {
      // Status filter
      if (statusFilter === "SENT" && item.status !== "SENT") return false;
      if (statusFilter === "PENDING" && item.status !== "PENDING" && item.status !== "SENDING") return false;
      if (statusFilter === "FAILED" && item.status !== "FAILED") return false;
      if (statusFilter === "NEED_SYNC" && (item.status !== "SENT" || item.sheetSyncStatus === "SYNCED")) return false;
      if (statusFilter === "MANUAL_ACTION" && item.formStatus !== "AWAITING_MANUAL_ACTION") return false;
      if (statusFilter === "FORM_SUBMITTED" && item.formStatus !== "SUBMITTED") return false;
      if (statusFilter === "FORM_FAILED" && item.formStatus !== "FAILED") return false;

      // Search filter
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        item.brandName.toLowerCase().includes(q) ||
        item.email.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [campaign, statusFilter, search]);

  function formatSentTimestamp(dateStr?: string | null) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${day} ${month} ${year}, ${hours}:${minutes}`;
  }

  const inputClass = "rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs sm:text-sm focus:border-[#673DE6] focus:outline-none";

  if (!campaign) {
    return (
      <div className="card p-12 text-center text-sm text-gray-500">
        <p>{error || "Loading campaign brand records…"}</p>
      </div>
    );
  }

  const unsyncedCount = campaign.recipients.filter(
    (r) => r.status === "SENT" && r.sheetSyncStatus !== "SYNCED"
  ).length;

  const rowSelectionBreakdown = useMemo(() => {
    if (!campaign) return null;
    if (campaign.rowSelection) return campaign.rowSelection;

    const raw = campaign.recipients || [];
    let completeCount = 0;
    let missingEmailCount = 0;
    let missingBrandCount = 0;
    let missingCategoryCount = 0;

    for (const r of raw) {
      const emailVal = r.email || "";
      const isEmailValid = Boolean(
        emailVal &&
        !emailVal.includes(".invalid") &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal) &&
        !/^(n\/a|none|undefined|null|-)$/i.test(emailVal)
      );
      const brandVal = r.brandName || "";
      const isBrandValid = Boolean(
        brandVal &&
        !/^brand \(/i.test(brandVal) &&
        !/^lead #/i.test(brandVal) &&
        !/^(undefined|null|none|n\/a|-)$/i.test(brandVal)
      );
      const catVal = r.category || "";
      const isCatValid = Boolean(
        catVal &&
        catVal !== "Missing Category" &&
        !/^(undefined|null|none|n\/a|-)$/i.test(catVal)
      );

      if (!isEmailValid) missingEmailCount++;
      if (!isBrandValid) missingBrandCount++;
      if (!isCatValid) missingCategoryCount++;

      if (isEmailValid && isBrandValid && isCatValid) {
        completeCount++;
      }
    }

    const rowIndices = raw.map((r) => r.sheetRowIndex).filter((x): x is number => typeof x === "number");
    const minRow = rowIndices.length ? Math.min(...rowIndices) : 1;
    const maxRow = rowIndices.length ? Math.max(...rowIndices) : raw.length;

    return {
      startRow: minRow,
      endRow: maxRow,
      totalSelected: raw.length,
      completeCount,
      missingEmailCount,
      missingBrandCount,
      missingCategoryCount,
    };
  }, [campaign]);

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 transition mb-2"
          >
            <span>&larr;</span> Back to All Campaigns
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{campaign.name}</h1>
            <Badge
              tone={
                campaign.status === "COMPLETED" || campaign.status === "READY"
                  ? "green"
                  : campaign.status === "SENDING" || campaign.status === "SCHEDULED"
                  ? "blue"
                  : campaign.status === "PAUSED"
                  ? "amber"
                  : "neutral"
              }
            >
              {campaign.status}
            </Badge>
          </div>
          {campaign.description && (
            <p className="mt-1 text-xs sm:text-sm text-gray-500">{campaign.description}</p>
          )}
        </div>

        {/* Header Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {campaign.sheetUrl && (
            <a
              href={campaign.sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 transition shadow-2xs"
            >
              <span>📊</span> Open Google Sheet
            </a>
          )}

          <a
            href={`/api/campaigns/${id}/export`}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition shadow-2xs"
          >
            <span>📥</span> Export CSV
          </a>

          <button
            type="button"
            onClick={() => setWebhookModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-purple-200 bg-purple-50 text-xs font-semibold text-[#673DE6] hover:bg-purple-100 transition shadow-2xs"
          >
            <span>⚡</span> {campaign.sheetWebhookUrl ? "Sheet Auto-Sync: ON" : "Connect Sheet Webhook"}
          </button>

          {["SCHEDULED", "SENDING", "ACTIVE"].includes(campaign.status) && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(`/api/campaigns/${id}/control`, "POST", { action: "pause" }, "Campaign paused.")}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-xs font-bold shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer disabled:opacity-50"
                title="Pause email dispatch temporarily"
              >
                <span>⏸️</span> Pause Campaign
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!confirm(`Permanently stop campaign "${campaign.name}"? Remaining scheduled emails will not be sent.`)) return;
                  void action(`/api/campaigns/${id}/control`, "POST", { action: "cancel" }, "Campaign stopped permanently.");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-xs font-bold text-amber-800 hover:scale-105 active:scale-95 transition-all duration-200 shadow-2xs cursor-pointer disabled:opacity-50"
                title="Permanently stop campaign and cancel remaining emails"
              >
                <span>🛑</span> Stop Campaign
              </button>
            </>
          )}

          {campaign.status === "PAUSED" && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(`/api/campaigns/${id}/control`, "POST", { action: "resume" }, "Campaign resumed.")}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer disabled:opacity-50"
                title="Continue and resume email dispatch"
              >
                <span>▶️</span> Continue Campaign
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!confirm(`Permanently stop campaign "${campaign.name}"? Remaining scheduled emails will not be sent.`)) return;
                  void action(`/api/campaigns/${id}/control`, "POST", { action: "cancel" }, "Campaign stopped permanently.");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-xs font-bold text-amber-800 hover:scale-105 active:scale-95 transition-all duration-200 shadow-2xs cursor-pointer disabled:opacity-50"
                title="Permanently stop campaign and cancel remaining emails"
              >
                <span>🛑</span> Stop Campaign
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleOpenEditModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] text-white text-xs font-bold shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer"
            title="Edit mailbox, template, interval, or settings"
          >
            <span>✏️</span> Edit Campaign
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={handleDeleteCampaign}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-bold shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer disabled:opacity-50"
            title="Permanently remove campaign and cancel remaining jobs"
          >
            <span>🗑️</span> Delete Campaign
          </button>
        </div>
      </div>

      {/* Alert Messages */}
      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs sm:text-sm text-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-red-500 hover:text-red-700">✕</button>
        </div>
      )}
      {message && (
        <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs sm:text-sm text-emerald-800 flex items-center justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage("")} className="text-emerald-500 hover:text-emerald-700">✕</button>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Total Brands</p>
          <p className="mt-1 text-2xl font-extrabold text-gray-900">{campaign.counters.total ?? 0}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">In this campaign</p>
        </div>
        <div className="card p-4 border-l-4 border-l-emerald-500">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">Sent</p>
          <p className="mt-1 text-2xl font-extrabold text-emerald-700">{campaign.counters.sent ?? 0}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Delivered emails</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-blue-500">Sending / Scheduled</p>
          <p className="mt-1 text-2xl font-extrabold text-blue-600">
            {(campaign.counters.pending ?? 0) + (campaign.counters.sending ?? 0)}
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">Next in queue</p>
        </div>
        <div className="card p-4 border-l-4 border-l-red-500">
          <p className="text-[11px] font-bold uppercase tracking-wider text-red-500">Failed</p>
          <p className="mt-1 text-2xl font-extrabold text-red-600">{campaign.counters.failed ?? 0}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Needs review</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-purple-600">Sheet Synced</p>
          <p className="mt-1 text-2xl font-extrabold text-[#673DE6]">{campaign.counters.syncedSheet ?? 0}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Rows updated</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-500">Pending Sheet</p>
          <p className="mt-1 text-2xl font-extrabold text-amber-600">{unsyncedCount}</p>
          {unsyncedCount > 0 ? (
            <button
              onClick={handleBatchSheetSync}
              disabled={syncingSheet}
              className="mt-1 text-[11px] font-bold text-[#673DE6] hover:underline disabled:opacity-50"
            >
              {syncingSheet ? "Syncing..." : "Sync Sheet Now &rarr;"}
            </button>
          ) : (
            <p className="text-[10px] text-gray-400 mt-0.5">All up to date</p>
          )}
        </div>
      </div>

      {/* Website Form Automation Live Operations Card (Requirement 9 & 7) */}
      {campaign.formAutomationEnabled && (
        <div className="rounded-2xl border-2 border-purple-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-purple-100 pb-3">
            <div className="flex items-center gap-3">
              <span className="p-2 bg-purple-100 rounded-xl text-xl leading-none">
                🌐
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-extrabold text-gray-900">
                    Website Form Automation Status
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800">
                    {campaign.formTemplate?.name || "Wholesale Form"}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Live real-time status of website form discovery, browser automation, and submission.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                browserAgentStatus === "READY" || browserAgentStatus === "CONNECTED"
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  : "bg-amber-100 text-amber-800 border border-amber-300"
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  browserAgentStatus === "READY" || browserAgentStatus === "CONNECTED" ? "bg-emerald-600 animate-pulse" : "bg-amber-500"
                }`}></span>
                Browser Agent: {browserAgentStatus === "READY" ? "Ready (:9222)" : "Offline"}
              </span>

              {browserAgentStatus === "OFFLINE" && (
                <button
                  type="button"
                  disabled={agentActionBusy}
                  onClick={handleLaunchBrowser}
                  className="px-3 py-1 bg-white hover:bg-gray-50 border border-purple-300 rounded-xl text-xs font-bold text-[#673DE6] shadow-2xs cursor-pointer disabled:opacity-50"
                >
                  🚀 Launch Chrome
                </button>
              )}

              <button
                type="button"
                disabled={agentActionBusy}
                onClick={handleProcessDueForms}
                className="px-3.5 py-1.5 bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-800 hover:to-indigo-800 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <span>⚡</span>
                <span>{agentActionBusy ? "Processing..." : "Process Due Forms Now"}</span>
              </button>
            </div>
          </div>

          {/* Form Metrics Row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">Total Forms</span>
              <span className="text-xl font-extrabold text-gray-900 block mt-0.5">{campaign.formCounters?.total ?? 0}</span>
              <span className="text-[10px] text-gray-400">Same campaign brands</span>
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 block">Submitted</span>
              <span className="text-xl font-extrabold text-emerald-700 block mt-0.5">{campaign.formCounters?.submitted ?? 0}</span>
              <span className="text-[10px] text-emerald-600">Verified success</span>
            </div>
            <div className="p-3 bg-blue-50 rounded-xl border border-blue-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 block">In Progress</span>
              <span className="text-xl font-extrabold text-blue-700 block mt-0.5">{campaign.formCounters?.inProgress ?? 0}</span>
              <span className="text-[10px] text-blue-600">Live tab filling</span>
            </div>
            <div className={`p-3 rounded-xl border transition ${
              (campaign.formCounters?.awaitingManual ?? 0) > 0
                ? "bg-amber-100 border-amber-300 ring-2 ring-amber-400/50"
                : "bg-amber-50 border-amber-200"
            }`}>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">Awaiting Manual Action</span>
              <span className="text-xl font-extrabold text-amber-900 block mt-0.5">{campaign.formCounters?.awaitingManual ?? 0}</span>
              {(campaign.formCounters?.awaitingManual ?? 0) > 0 ? (
                <button
                  type="button"
                  onClick={() => setStatusFilter("MANUAL_ACTION")}
                  className="text-[10px] font-bold text-amber-900 underline block mt-0.5"
                >
                  Solve in Tab &rarr;
                </button>
              ) : (
                <span className="text-[10px] text-amber-700">CAPTCHA / Challenge</span>
              )}
            </div>
            <div className="p-3 bg-purple-50 rounded-xl border border-purple-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#673DE6] block">Pending</span>
              <span className="text-xl font-extrabold text-[#673DE6] block mt-0.5">{campaign.formCounters?.pending ?? 0}</span>
              <span className="text-[10px] text-purple-600">Queued in database</span>
            </div>
            <div className="p-3 bg-red-50 rounded-xl border border-red-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 block">Failed / Missing</span>
              <span className="text-xl font-extrabold text-red-700 block mt-0.5">
                {(campaign.formCounters?.failed ?? 0) + (campaign.formCounters?.notAvailable ?? 0)}
              </span>
              <span className="text-[10px] text-red-500">
                {campaign.formCounters?.notAvailable ?? 0} missing website
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Selected Rows & Validation Breakdown Card (Section 7) */}
      {rowSelectionBreakdown && (
        <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-200/60 pb-3">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#673DE6]">
                Campaign Row Range Selection &amp; Lead Quality
              </span>
              <h4 className="text-sm font-bold text-gray-900 mt-0.5">
                Selected Rows: {rowSelectionBreakdown.startRow}–{rowSelectionBreakdown.endRow}
                <span className="text-xs text-gray-500 font-normal ml-2">
                  (Spreadsheet Lines {rowSelectionBreakdown.startRow + 1}–{rowSelectionBreakdown.endRow + 1})
                </span>
              </h4>
            </div>
            <div className="text-right">
              <span className="text-xs text-gray-600 font-medium">Total Selected Rows:</span>{" "}
              <span className="text-lg font-extrabold text-[#673DE6]">
                {rowSelectionBreakdown.totalSelected}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <div className="rounded-lg bg-white border border-emerald-200 p-2.5 shadow-2xs">
              <p className="text-[11px] font-bold uppercase text-emerald-700">Complete Leads</p>
              <p className="text-2xl font-extrabold text-emerald-700 mt-0.5">
                {rowSelectionBreakdown.completeCount}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">Valid email, brand &amp; category</p>
            </div>

            <div className="rounded-lg bg-white border border-red-200 p-2.5 shadow-2xs">
              <p className="text-[11px] font-bold uppercase text-red-600">Missing Email</p>
              <p className="text-2xl font-extrabold text-red-600 mt-0.5">
                {rowSelectionBreakdown.missingEmailCount}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">Preserved in position (skipped from send)</p>
            </div>

            <div className="rounded-lg bg-white border border-amber-200 p-2.5 shadow-2xs">
              <p className="text-[11px] font-bold uppercase text-amber-600">Missing Brand</p>
              <p className="text-2xl font-extrabold text-amber-600 mt-0.5">
                {rowSelectionBreakdown.missingBrandCount}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">Using fallback / placeholder</p>
            </div>

            <div className="rounded-lg bg-white border border-blue-200 p-2.5 shadow-2xs">
              <p className="text-[11px] font-bold uppercase text-blue-600">Missing Category</p>
              <p className="text-2xl font-extrabold text-blue-600 mt-0.5">
                {rowSelectionBreakdown.missingCategoryCount}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">Using General category</p>
            </div>
          </div>
        </div>
      )}

      {/* Sender Mailbox & Template Details */}
      <section className="card p-5 space-y-3 bg-gray-50/50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-500 uppercase tracking-wide">Mailbox:</span>
            <span className="font-semibold text-gray-900 bg-white border border-gray-200 px-2.5 py-1 rounded-lg">
              {campaign.mailbox?.displayName ? `[${campaign.mailbox.displayName}] ` : ""}
              {campaign.mailbox?.emailAddress || "Default Verified Sender"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-500 uppercase tracking-wide">Template:</span>
            <span className="font-semibold text-gray-900 bg-white border border-gray-200 px-2.5 py-1 rounded-lg">
              {campaign.template?.name || "Standard Outreach Template"}
            </span>
          </div>
        </div>

        {campaign.template && (
          <details className="text-xs border-t border-gray-200/60 pt-2.5">
            <summary className="cursor-pointer font-semibold text-gray-600 hover:text-gray-900">
              Preview email template body & subject
            </summary>
            <div className="mt-2.5 rounded-xl bg-white border border-gray-200 p-3.5 space-y-1.5 font-mono text-[11px]">
              <p><strong>Subject:</strong> {campaign.template.subject}</p>
              <p className="whitespace-pre-wrap text-gray-600 border-t border-gray-100 pt-1.5 mt-1.5">
                {campaign.template.body}
              </p>
            </div>
          </details>
        )}
      </section>

      {/* Main Professional Brands Email List */}
      <section className="card overflow-hidden">
        {/* Table Controls Header */}
        <div className="p-5 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>📋</span> Brands Email List ({filteredRecipients.length})
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Live status of each brand in this campaign with actual sent dates, times, and Google Sheet sync records.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Add Email Manually Button */}
            <button
              type="button"
              onClick={() => {
                setError("");
                setMessage("");
                setAddEmailModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-[#673DE6] hover:bg-[#5025D1] rounded-xl shadow-xs transition cursor-pointer"
            >
              <span>➕</span> Add Email Manually
            </button>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search brand, email, category..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-56 sm:w-64 rounded-xl border border-gray-200 bg-[#F9FAFB] pl-8 pr-3 py-1.5 text-xs text-gray-800 focus:border-[#673DE6] focus:bg-white focus:outline-none"
              />
              <span className="pointer-events-none absolute left-2.5 top-2 text-gray-400 text-xs">🔍</span>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl text-xs font-semibold">
              <button
                onClick={() => setStatusFilter("ALL")}
                className={`px-2.5 py-1 rounded-lg transition ${
                  statusFilter === "ALL" ? "bg-white text-gray-900 shadow-2xs" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                All ({campaign.recipients.length})
              </button>
              <button
                onClick={() => setStatusFilter("SENT")}
                className={`px-2.5 py-1 rounded-lg transition ${
                  statusFilter === "SENT" ? "bg-white text-emerald-700 shadow-2xs font-bold" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Sent ({campaign.counters.sent ?? 0})
              </button>
              <button
                onClick={() => setStatusFilter("PENDING")}
                className={`px-2.5 py-1 rounded-lg transition ${
                  statusFilter === "PENDING" ? "bg-white text-blue-700 shadow-2xs font-bold" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Pending ({(campaign.counters.pending ?? 0) + (campaign.counters.sending ?? 0)})
              </button>
              <button
                onClick={() => setStatusFilter("FAILED")}
                className={`px-2.5 py-1 rounded-lg transition ${
                  statusFilter === "FAILED" ? "bg-white text-red-600 shadow-2xs font-bold" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Failed ({campaign.counters.failed ?? 0})
              </button>
              {campaign.formAutomationEnabled && (
                <>
                  {(campaign.formCounters?.awaitingManual ?? 0) > 0 && (
                    <button
                      onClick={() => setStatusFilter("MANUAL_ACTION")}
                      className={`px-2.5 py-1 rounded-lg transition animate-pulse font-bold ${
                        statusFilter === "MANUAL_ACTION"
                          ? "bg-amber-500 text-white shadow-2xs"
                          : "bg-amber-100 text-amber-900 border border-amber-300"
                      }`}
                    >
                      ⚠️ Manual Action ({campaign.formCounters?.awaitingManual ?? 0})
                    </button>
                  )}
                  <button
                    onClick={() => setStatusFilter("FORM_SUBMITTED")}
                    className={`px-2.5 py-1 rounded-lg transition ${
                      statusFilter === "FORM_SUBMITTED"
                        ? "bg-white text-emerald-700 shadow-2xs font-bold"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    Forms Submitted ({campaign.formCounters?.submitted ?? 0})
                  </button>
                  <button
                    onClick={() => setStatusFilter("FORM_FAILED")}
                    className={`px-2.5 py-1 rounded-lg transition ${
                      statusFilter === "FORM_FAILED"
                        ? "bg-white text-red-600 shadow-2xs font-bold"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    Forms Failed ({campaign.formCounters?.failed ?? 0})
                  </button>
                </>
              )}
              {unsyncedCount > 0 && (
                <button
                  onClick={() => setStatusFilter("NEED_SYNC")}
                  className={`px-2.5 py-1 rounded-lg transition ${
                    statusFilter === "NEED_SYNC" ? "bg-white text-amber-700 shadow-2xs font-bold" : "text-amber-600 hover:text-amber-800"
                  }`}
                  title="Sent emails that still need to be synchronized to the Google Sheet"
                >
                  Unsynced ({unsyncedCount})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Brands Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-[#F9FAFB] border-b border-gray-100 text-gray-500 font-bold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-4 py-3 text-center w-12">#</th>
                <th className="px-4 py-3">Brand Name</th>
                <th className="px-4 py-3">Email Address</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Email Status</th>
                {campaign.formAutomationEnabled && (
                  <>
                    <th className="px-4 py-3">Website &amp; Form URL</th>
                    <th className="px-4 py-3">Form Status</th>
                  </>
                )}
                <th className="px-4 py-3">Google Sheet Sync</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRecipients.length === 0 ? (
                <tr>
                  <td colSpan={campaign.formAutomationEnabled ? 9 : 7} className="py-12 text-center text-gray-400 text-xs">
                    No brands match the selected filter.
                  </td>
                </tr>
              ) : (
                filteredRecipients.map((brand, idx) => {
                  const sentFormatted = formatSentTimestamp(brand.sentAt);

                  return (
                    <tr key={brand.id} className="hover:bg-gray-50/70 transition">
                      {/* Original Sheet Row # */}
                      <td className="px-4 py-3.5 text-center font-mono text-[11px] text-gray-400 font-bold">
                        {brand.sheetRowIndex ?? idx + 1}
                      </td>

                      {/* Brand Name */}
                      <td className="px-4 py-3.5 font-bold text-gray-900">
                        {brand.brandName}
                      </td>

                      {/* Email */}
                      <td className="px-4 py-3.5 font-mono text-xs text-gray-700">
                        {brand.status === "SKIPPED" || !brand.email || brand.email.includes(".invalid") ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200">
                            ⚠️ Missing Email
                          </span>
                        ) : (
                          <a
                            href={`mailto:${brand.email}`}
                            className="hover:text-[#673DE6] hover:underline"
                          >
                            {brand.email}
                          </a>
                        )}
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-100">
                          {brand.category || "General"}
                        </span>
                      </td>

                      {/* Email Status with Actual Sent Date and Time */}
                      <td className="px-4 py-3.5">
                        {brand.status === "SENT" ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 w-fit">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              SENT
                            </span>
                            {sentFormatted && (
                              <span className="text-[11px] text-gray-500 font-medium">
                                🕒 {sentFormatted}
                              </span>
                            )}
                          </div>
                        ) : brand.status === "SENDING" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 w-fit animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                            SENDING...
                          </span>
                        ) : brand.status === "FAILED" ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 w-fit">
                              ✕ FAILED
                            </span>
                            {brand.errorMessage && (
                              <span className="text-[10px] text-red-600 max-w-xs truncate" title={brand.errorMessage}>
                                {brand.errorMessage}
                              </span>
                            )}
                          </div>
                        ) : brand.status === "REPLIED" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200 w-fit">
                            💬 REPLIED
                          </span>
                        ) : brand.status === "SKIPPED" ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 w-fit">
                              ⏭️ SKIPPED
                            </span>
                            {brand.errorMessage && (
                              <span className="text-[10px] text-amber-600 max-w-xs truncate" title={brand.errorMessage}>
                                {brand.errorMessage}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 w-fit">
                            ⏳ PENDING
                          </span>
                        )}
                      </td>

                      {/* Website & Form URL + Form Status (Website Form Automation) */}
                      {campaign.formAutomationEnabled && (
                        <>
                          <td className="px-4 py-3.5 max-w-[190px]">
                            <div className="flex flex-col gap-1">
                              {brand.contact?.website ? (
                                <a
                                  href={brand.contact.website.startsWith("http") ? brand.contact.website : `https://${brand.contact.website}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-600 hover:underline truncate block"
                                  title={brand.contact.website}
                                >
                                  🌐 {brand.contact.website}
                                </a>
                              ) : (
                                <span className="text-[11px] text-red-500 font-semibold">Missing Website</span>
                              )}
                              {brand.formUrl ? (
                                <a
                                  href={brand.formUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] font-mono text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100 truncate block hover:underline"
                                  title={brand.formUrl}
                                >
                                  📋 {brand.formUrl}
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setUrlModalRecipient(brand);
                                    setUrlModalValue(brand.contact?.website ? `${brand.contact.website.replace(/\/+$/, "")}/wholesale` : "");
                                  }}
                                  className="text-[10px] text-[#673DE6] font-bold hover:underline self-start"
                                >
                                  + Set Form URL
                                </button>
                              )}
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            {brand.formStatus === "SUBMITTED" ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 w-fit">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  SUBMITTED
                                </span>
                                {brand.formJob?.submittedAt && (
                                  <span className="text-[10px] text-gray-500">
                                    🕒 {new Date(brand.formJob.submittedAt).toLocaleTimeString()}
                                  </span>
                                )}
                              </div>
                            ) : brand.formStatus === "IN_PROGRESS" ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 w-fit animate-pulse">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                                IN_PROGRESS...
                              </span>
                            ) : brand.formStatus === "AWAITING_MANUAL_ACTION" ? (
                              <div className="flex flex-col gap-1">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 w-fit animate-pulse">
                                  ⚠️ AWAITING ACTION
                                </span>
                                <span className="text-[10px] text-amber-800 font-medium max-w-xs truncate" title={brand.formJob?.manualActionReason || "CAPTCHA / challenge detected"}>
                                  {brand.formJob?.manualActionReason || "CAPTCHA detected"}
                                </span>
                              </div>
                            ) : brand.formStatus === "FAILED" ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 w-fit">
                                  ✕ FAILED
                                </span>
                                <span className="text-[10px] text-red-600 max-w-xs truncate" title={brand.formJob?.lastError || ""}>
                                  {brand.formJob?.lastError || "Submission failed"}
                                </span>
                              </div>
                            ) : brand.formStatus === "NOT_AVAILABLE" ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-700 border border-gray-200 w-fit">
                                  NOT_AVAILABLE
                                </span>
                                <span className="text-[10px] text-gray-500">Missing website</span>
                              </div>
                            ) : brand.formExcluded ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-500 w-fit">
                                EXCLUDED
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-100 w-fit">
                                PENDING
                              </span>
                            )}
                          </td>
                        </>
                      )}

                      {/* Google Sheet Sync Status */}
                      <td className="px-4 py-3.5">
                        {brand.sheetSyncStatus === "SYNCED" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200" title={`Synced at ${brand.sheetSyncedAt || "earlier"}`}>
                            ✓ Row Synced
                          </span>
                        ) : brand.status === "SENT" ? (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              ⚠️ Sync Pending
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRetryRecipientSheetSync(brand.id)}
                              disabled={busy}
                              className="text-[11px] font-bold text-[#673DE6] hover:underline disabled:opacity-50"
                              title="Update this brand's row in Google Sheet without resending email"
                            >
                              Sync Now
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-400">
                            Waiting for send
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex flex-col sm:flex-row items-end sm:items-center justify-end gap-1.5">
                          {/* Website Form Actions */}
                          {brand.formStatus === "AWAITING_MANUAL_ACTION" && brand.formJob && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={agentActionBusy}
                                onClick={() => handleResolveManualAction(brand.formJob!.id, "SUBMITTED")}
                                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold shadow-2xs"
                                title="Click after you complete the CAPTCHA in your open browser tab"
                              >
                                ✓ Solved
                              </button>
                              <button
                                type="button"
                                disabled={agentActionBusy}
                                onClick={() => handleResolveManualAction(brand.formJob!.id, "FAILED")}
                                className="px-1.5 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-[10px]"
                                title="Mark form submission failed"
                              >
                                ✕ Fail
                              </button>
                            </div>
                          )}
                          {brand.formStatus === "NOT_AVAILABLE" && (
                            <button
                              type="button"
                              onClick={() => {
                                setUrlModalRecipient(brand);
                                setUrlModalValue(brand.contact?.website ? `${brand.contact.website.replace(/\/+$/, "")}/wholesale` : "");
                              }}
                              className="px-2 py-1 text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition"
                            >
                              + Form URL
                            </button>
                          )}
                          {brand.status === "SENT" && brand.sheetSyncStatus !== "SYNCED" && (
                            <button
                              type="button"
                              onClick={() => handleRetryRecipientSheetSync(brand.id)}
                              disabled={busy}
                              className="px-2.5 py-1 text-[11px] font-bold text-[#673DE6] bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 transition"
                            >
                              Update Sheet
                            </button>
                          )}
                          {brand.status === "PENDING" && (
                            <button
                              type="button"
                              onClick={() => handleRemoveRecipient(brand.id, brand.email)}
                              disabled={busy}
                              className="px-2 py-1 text-[11px] font-medium text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                              title="Remove recipient from campaign"
                            >
                              🗑️ Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Campaign Run Controls & Follow-ups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Run Controls */}
        <section className="card p-6 space-y-4">
          <h3 className="font-bold text-base text-gray-900 flex items-center gap-2">
            <span>⚙️</span> Campaign Run Controls
          </h3>

          {(campaign.status === "READY" || campaign.status === "DRAFT") && (
            <div className="space-y-4">
              <button
                disabled={busy}
                onClick={() => handleOpenPreSendReview("sendNow")}
                className="w-full rounded-xl bg-[#673DE6] hover:bg-[#5025D1] text-white py-3 text-xs sm:text-sm font-bold shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>⚡</span> Send Campaign Now (Review &amp; Confirm)
              </button>

              <div className="border-t border-gray-100 pt-3 space-y-2">
                <p className="text-xs font-bold text-gray-700">Or Schedule for Later:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    aria-label="Scheduled date"
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className={inputClass}
                  />
                  <input
                    aria-label="Scheduled time"
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <button
                  disabled={busy || !scheduleDate || !scheduleTime}
                  className="w-full btn-secondary py-2 text-xs font-bold cursor-pointer disabled:opacity-50"
                  onClick={() => handleOpenPreSendReview("schedule")}
                >
                  Schedule Send (Review &amp; Confirm)
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            {["SCHEDULED", "SENDING", "ACTIVE"].includes(campaign.status) && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-xs transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  onClick={async () => {
                    if (
                      !confirm(
                        `🚀 Forward and dispatch campaign "${campaign.name}" immediately?\n\nEmails will start sending in real time without waiting.`
                      )
                    ) {
                      return;
                    }
                    await action(`/api/campaigns/${id}/forward`, "POST", {}, "Campaign forwarded for immediate dispatch!");
                  }}
                >
                  <span>🚀</span> Forward Now
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 transition cursor-pointer disabled:opacity-50"
                  onClick={() => void action(`/api/campaigns/${id}/control`, "POST", { action: "pause" }, "Campaign paused.")}
                >
                  ⏸️ Pause Campaign
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-300 transition cursor-pointer disabled:opacity-50"
                  onClick={() => {
                    if (!confirm(`Permanently stop campaign "${campaign.name}"? Remaining scheduled emails will not be sent.`)) return;
                    void action(`/api/campaigns/${id}/control`, "POST", { action: "cancel" }, "Campaign stopped permanently.");
                  }}
                >
                  🛑 Stop Campaign
                </button>
              </>
            )}
            {campaign.status === "PAUSED" && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 transition cursor-pointer disabled:opacity-50"
                  onClick={() => void action(`/api/campaigns/${id}/control`, "POST", { action: "resume" }, "Campaign resumed.")}
                >
                  ▶️ Resume Campaign
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-300 transition cursor-pointer disabled:opacity-50"
                  onClick={() => {
                    if (!confirm(`Permanently stop campaign "${campaign.name}"? Remaining scheduled emails will not be sent.`)) return;
                    void action(`/api/campaigns/${id}/control`, "POST", { action: "cancel" }, "Campaign stopped permanently.");
                  }}
                >
                  🛑 Stop Campaign
                </button>
              </>
            )}
            <button
              type="button"
              disabled={busy}
              className="px-4 py-2 rounded-xl text-xs font-bold text-[#673DE6] bg-purple-50 hover:bg-purple-100 border border-purple-300 transition cursor-pointer disabled:opacity-50"
              onClick={handleOpenEditModal}
            >
              ✏️ Edit Campaign Settings
            </button>
            <button
              type="button"
              disabled={busy}
              className="px-4 py-2 rounded-xl text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition cursor-pointer disabled:opacity-50"
              onClick={handleDeleteCampaign}
            >
              🗑️ Delete Campaign
            </button>
            <Link href="/scheduled" className="btn-secondary text-xs font-semibold">
              View Scheduled Queue &rarr;
            </Link>
          </div>
        </section>

        {/* Follow-ups */}
        <section className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base text-gray-900 flex items-center gap-2">
              <span>🔁</span> Follow-up Steps ({campaign.followUpRules.length})
            </h3>
            <Link className="btn-secondary text-xs" href={`/follow-ups?campaign=${id}`}>
              Configure Follow-ups
            </Link>
          </div>
          <p className="text-xs text-gray-500">
            Automated follow-ups send to brands that have not replied. Any reply instantly stops future follow-ups.
          </p>
          <div className="space-y-2.5">
            {campaign.followUpRules.length ? (
              campaign.followUpRules.map((rule) => (
                <div key={rule.stepNumber} className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between font-semibold text-gray-900">
                    <span>Step {rule.stepNumber}</span>
                    <span className="text-gray-500">
                      +{rule.delayAmount} {rule.delayUnit.toLowerCase()}
                    </span>
                  </div>
                  <p className="text-gray-600 truncate">{rule.template?.name ?? "Custom Follow-up"}</p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
                No follow-up steps configured for this campaign.
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Google Sheet Webhook Integration Modal */}
      {webhookModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl border border-gray-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚡</span>
                <h3 className="text-base font-bold text-gray-900">Google Sheet Real-Time Sync Setup</h3>
              </div>
              <button
                type="button"
                onClick={() => setWebhookModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-sm p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              When an email is sent to a brand, the system will automatically update the original row in your Google Sheet with:
              <br />
              <strong className="text-gray-900">`SENT`</strong>, <strong className="text-gray-900">Sent Date</strong>, and <strong className="text-gray-900">Sent Time</strong>.
            </p>

            <form onSubmit={handleSaveWebhook} className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Google Apps Script Web App URL
                </label>
                <input
                  type="url"
                  placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                  value={webhookUrlInput}
                  onChange={(e) => setWebhookUrlInput(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 p-2.5 text-xs font-mono focus:border-[#673DE6] focus:outline-none"
                />
              </div>

              {/* 1-Click Code Snippet to Copy */}
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-gray-700 uppercase">
                    30-Second Setup in Google Sheets:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const code = `function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var rowIndex = data.rowIndex;
  if (!rowIndex || rowIndex < 2) return ContentService.createTextOutput(JSON.stringify({success:false, error:"Invalid row"}));
  // Write SENT, Date, and Time into columns H, I, J (or appended status columns)
  sheet.getRange(rowIndex, 8).setValue(data.status); // Column H: Status
  sheet.getRange(rowIndex, 9).setValue(data.sentDate); // Column I: Sent Date
  sheet.getRange(rowIndex, 10).setValue(data.sentTime); // Column J: Sent Time
  return ContentService.createTextOutput(JSON.stringify({success:true})).setMimeType(ContentService.MimeType.JSON);
}`;
                      navigator.clipboard.writeText(code);
                      alert("Code copied to clipboard! In your Google Sheet, open Extensions > Apps Script, paste this code, click Deploy > New Deployment > Web app > Access: Anyone, and paste the URL above.");
                    }}
                    className="text-[11px] font-bold text-[#673DE6] hover:underline"
                  >
                    Copy Script Code 📋
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 leading-normal">
                  1. In Google Sheet, click <strong>Extensions &rarr; Apps Script</strong>.<br />
                  2. Paste the snippet &rarr; click <strong>Deploy &rarr; New deployment &rarr; Web app</strong>.<br />
                  3. Set <em>Who has access</em> to <strong>Anyone</strong>, copy the web app URL, and paste it above!
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setWebhookModalOpen(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingWebhook}
                  className="rounded-xl bg-[#673DE6] hover:bg-[#5025D1] px-5 py-2 text-xs font-bold text-white shadow-xs"
                >
                  {savingWebhook ? "Saving & Testing..." : "Save Webhook & Auto-Sync"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mandatory Pre-Send Template Review Modal */}
      {reviewModalOpen && reviewModalData && campaign && (
        <PreSendReviewModal
          isOpen={reviewModalOpen}
          onClose={() => setReviewModalOpen(false)}
          onConfirm={handleConfirmPreSend}
          isConfirming={reviewConfirming}
          campaignTitle={campaign.name}
          senderMailbox={campaign.mailbox?.emailAddress || "Default Hostinger Mailbox"}
          totalRecipients={campaign.recipients.length}
          sendMode={reviewModalData.sendMode}
          scheduledTime={reviewModalData.scheduledTime}
          delayAmount={60}
          delayUnit="seconds"
          subjectTemplate={campaign.template?.subject || "(No Subject)"}
          bodyTemplate={campaign.template?.body || "(No Body)"}
          followUpEnabled={campaign.followUpRules?.length > 0}
          followUpDays={campaign.followUpRules?.[0]?.delayAmount || 3}
          recipients={
            campaign.recipients.length > 0
              ? campaign.recipients.map((r) => ({
                  brandName: r.brandName || r.contact?.name || "Target Brand",
                  brandEmail: r.email || r.contact?.email || "brand@example.com",
                  productCategory: r.category || "General",
                  asin: r.contact?.notes || undefined,
                  website: r.contact?.website || undefined,
                  sheetNum: r.sheetRowIndex || undefined,
                }))
              : [
                  {
                    brandName: "Sample Brand",
                    brandEmail: "brand@example.com",
                    productCategory: "General Outreach",
                  },
                ]
          }
        />
      )}

      {/* Edit Campaign Modal (For Draft, In-Progress, and Paused campaigns) */}
      {editModalOpen && campaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-gray-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
            <form onSubmit={handleSaveEditedCampaign}>
              {/* Header */}
              <div className="px-6 py-4 bg-gradient-to-r from-purple-50 via-white to-blue-50 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="p-2 bg-[#673DE6] text-white rounded-xl text-base leading-none">
                    ✏️
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-gray-900">Edit Campaign</h3>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        campaign.status === "SENDING" || campaign.status === "SCHEDULED"
                          ? "bg-blue-100 text-blue-700"
                          : campaign.status === "PAUSED"
                          ? "bg-amber-100 text-amber-700"
                          : campaign.status === "COMPLETED"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-700"
                      }`}>
                        {campaign.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500">Update mailbox, template, interval &amp; settings</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 rounded-lg p-1 text-sm font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Informative Banner with Quick Controls */}
              <div className="p-4 bg-purple-50/70 border-b border-purple-100 text-xs">
                {campaign.status === "PAUSED" ? (
                  <div className="space-y-2.5">
                    <div className="flex items-start gap-2 text-amber-900 font-medium leading-relaxed">
                      <span className="text-base">⏸️</span>
                      <div>
                        <strong>Campaign is Currently PAUSED:</strong> Email sending is frozen. You can edit settings below, or use the quick action buttons:
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-amber-200/50">
                      <button
                        type="button"
                        disabled={busy || editSaving}
                        onClick={async () => {
                          setEditModalOpen(false);
                          void action(`/api/campaigns/${id}/control`, "POST", { action: "resume" }, "Campaign resumed.");
                        }}
                        className="px-3 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-[11px] font-bold rounded-lg shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-150 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <span>▶️</span> Resume Sending
                      </button>
                      <button
                        type="button"
                        disabled={busy || editSaving}
                        onClick={async () => {
                          if (!confirm(`Permanently stop campaign "${campaign.name}"? Remaining scheduled emails will not be sent.`)) return;
                          setEditModalOpen(false);
                          void action(`/api/campaigns/${id}/control`, "POST", { action: "cancel" }, "Campaign stopped permanently.");
                        }}
                        className="px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-bold rounded-lg border border-amber-200 transition-all duration-150 flex items-center gap-1 cursor-pointer disabled:opacity-50 hover:scale-105 active:scale-95"
                      >
                        <span>🛑</span> Stop Campaign
                      </button>
                      <button
                        type="button"
                        disabled={busy || editSaving}
                        onClick={async () => {
                          setEditModalOpen(false);
                          await handleDeleteCampaign();
                        }}
                        className="px-3 py-1 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-[11px] font-bold rounded-lg shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-150 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <span>🗑️</span> Delete Campaign
                      </button>
                    </div>
                  </div>
                ) : campaign.status === "SENDING" || campaign.status === "SCHEDULED" ? (
                  <div className="space-y-2.5">
                    <div className="flex items-start gap-2 text-purple-900 font-medium leading-relaxed">
                      <span className="text-base">⚡</span>
                      <div>
                        <strong>Active Mid-Campaign Editing:</strong> Modifying the sender mailbox, template, or interval will take effect immediately on all <strong>{(campaign.counters?.pending ?? 0) + (campaign.counters?.sending ?? 0)} pending/unsent</strong> emails.
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-purple-200/50">
                      <button
                        type="button"
                        disabled={busy || editSaving}
                        onClick={async () => {
                          setEditModalOpen(false);
                          void action(`/api/campaigns/${id}/control`, "POST", { action: "pause" }, "Campaign paused.");
                        }}
                        className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold rounded-lg shadow-2xs transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <span>⏸️</span> Pause Campaign
                      </button>
                      <button
                        type="button"
                        disabled={busy || editSaving}
                        onClick={async () => {
                          if (!confirm(`Permanently stop campaign "${campaign.name}"? Remaining scheduled emails will not be sent.`)) return;
                          setEditModalOpen(false);
                          void action(`/api/campaigns/${id}/control`, "POST", { action: "cancel" }, "Campaign stopped permanently.");
                        }}
                        className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 text-[11px] font-bold rounded-lg border border-red-300 transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <span>🛑</span> Stop Campaign
                      </button>
                      <button
                        type="button"
                        disabled={busy || editSaving}
                        onClick={async () => {
                          setEditModalOpen(false);
                          await handleDeleteCampaign();
                        }}
                        className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold rounded-lg shadow-2xs transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <span>🗑️</span> Delete Campaign
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-gray-700 font-medium">
                    <span className="text-sm">ℹ️</span>
                    <div>
                      Update campaign settings and assigned template before dispatch.
                    </div>
                  </div>
                )}
              </div>

              {/* Body Form Fields */}
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                {/* Campaign Name */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Campaign Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="e.g. Campaign Name"
                    className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Description / Notes (Optional)
                  </label>
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="e.g. Outreach batch notes"
                    className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                  />
                </div>

                {/* Sender Mailbox */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Hostinger Sender Mailbox
                  </label>
                  <select
                    value={editMailboxId}
                    onChange={(e) => setEditMailboxId(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                  >
                    <option value="">-- Use Default Hostinger Mailbox --</option>
                    {mailboxes.map((mb) => (
                      <option key={mb.id} value={mb.id}>
                        {mb.displayName ? `${mb.displayName} (${mb.emailAddress})` : mb.emailAddress}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Email Template */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Email Template
                  </label>
                  <select
                    value={editTemplateId}
                    onChange={(e) => setEditTemplateId(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                  >
                    <option value="">-- Select Template --</option>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name} {tpl.isDefault ? "★ (Active Global)" : ""} {tpl.subject ? `- Subject: ${tpl.subject.slice(0, 45)}...` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Delay between consecutive emails */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Delay Between Remaining Emails
                  </label>
                  <select
                    value={editDelaySeconds}
                    onChange={(e) => setEditDelaySeconds(Number(e.target.value))}
                    className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                  >
                    <option value={0}>0 seconds (Instant burst send)</option>
                    <option value={15}>15 seconds</option>
                    <option value={30}>30 seconds</option>
                    <option value={60}>60 seconds / 1 minute (Recommended for Hostinger)</option>
                    <option value={120}>120 seconds / 2 minutes</option>
                    <option value={300}>300 seconds / 5 minutes</option>
                  </select>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Spreads remaining queue jobs to prevent host rate limits.
                  </p>
                </div>

                {/* Google Sheet URL */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Google Sheet URL (Optional)
                  </label>
                  <input
                    type="url"
                    value={editSheetUrl}
                    onChange={(e) => setEditSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                  />
                </div>

                {/* Webhook URL */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Google Apps Script Webhook URL (Optional)
                  </label>
                  <input
                    type="url"
                    value={editSheetWebhookUrl}
                    onChange={(e) => setEditSheetWebhookUrl(e.target.value)}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSaving || !editName.trim()}
                  className="px-5 py-2 text-xs font-bold text-white bg-[#673DE6] hover:bg-[#5025D1] rounded-xl shadow-xs transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {editSaving ? (
                    <>
                      <span className="animate-spin inline-block h-3 w-3 border-2 border-white border-t-transparent rounded-full"></span>
                      Saving Edits...
                    </>
                  ) : (
                    <>
                      <span>💾</span> Save &amp; Apply Changes
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Email Manually Modal */}
      {addEmailModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-gray-100 animate-in fade-in zoom-in duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2">
                <span className="text-lg">✍️</span>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Add Email to Campaign</h3>
                  <p className="text-[11px] text-gray-500">Manually add brand recipients to this campaign</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAddEmailModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 rounded-lg p-1 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Mode Switcher */}
            <div className="px-6 pt-4 pb-2 border-b border-gray-100 flex gap-2">
              <button
                type="button"
                onClick={() => setAddEmailMode("single")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
                  addEmailMode === "single"
                    ? "bg-[#673DE6] text-white shadow-2xs"
                    : "bg-gray-100 text-gray-600 hover:text-gray-900"
                }`}
              >
                ➕ Single Email
              </button>
              <button
                type="button"
                onClick={() => setAddEmailMode("bulk")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
                  addEmailMode === "bulk"
                    ? "bg-[#673DE6] text-white shadow-2xs"
                    : "bg-gray-100 text-gray-600 hover:text-gray-900"
                }`}
              >
                📋 Bulk Paste
              </button>
            </div>

            <form onSubmit={handleAddManualRecipient}>
              <div className="p-6 space-y-4">
                {addEmailMode === "single" ? (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Email Address <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        required
                        value={manualEmail}
                        onChange={(e) => setManualEmail(e.target.value)}
                        placeholder="e.g. founder@coolbrand.com"
                        className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Brand / Contact Name <span className="text-gray-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={manualBrandName}
                        onChange={(e) => setManualBrandName(e.target.value)}
                        placeholder="e.g. Acme Brands"
                        className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Product Category <span className="text-gray-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={manualCategory}
                        onChange={(e) => setManualCategory(e.target.value)}
                        placeholder="e.g. Electronics, Home & Kitchen"
                        className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Website / Amazon Link <span className="text-gray-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={manualWebsite}
                        onChange={(e) => setManualWebsite(e.target.value)}
                        placeholder="https://brand.com"
                        className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Paste Emails List <span className="text-red-500">*</span>
                    </label>
                    <p className="text-[11px] text-gray-500 mb-2">
                      Enter one per line, or formatted as <code className="text-[#673DE6] font-mono">Brand Name, email@domain.com, Category</code>.
                    </p>
                    <textarea
                      rows={6}
                      required
                      value={bulkEmailsText}
                      onChange={(e) => setBulkEmailsText(e.target.value)}
                      placeholder={"contact@brandone.com\nAcme Corp, acme@example.com, Electronics\nsupport@store.com"}
                      className="w-full text-xs font-mono px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                    />
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setAddEmailModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingRecipient}
                  className="px-5 py-2 text-xs font-bold text-white bg-[#673DE6] hover:bg-[#5025D1] rounded-xl shadow-xs transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {addingRecipient ? (
                    <>
                      <span className="animate-spin inline-block h-3 w-3 border-2 border-white border-t-transparent rounded-full"></span>
                      Adding...
                    </>
                  ) : (
                    <>
                      <span>➕</span> Add to Campaign
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Set Form URL Modal */}
      {urlModalRecipient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 border border-purple-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h4 className="font-extrabold text-sm text-gray-900 flex items-center gap-2">
                <span>🌐</span> Set Form URL: {urlModalRecipient.brandName}
              </h4>
              <button
                type="button"
                onClick={() => setUrlModalRecipient(null)}
                className="text-gray-400 hover:text-gray-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-gray-600">
                Provide the direct wholesale, retailer, or contact application form URL for this brand.
              </p>
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase mb-1">
                  Target Website Form URL:
                </label>
                <input
                  type="url"
                  placeholder="https://brand.com/wholesale"
                  value={urlModalValue}
                  onChange={(e) => setUrlModalValue(e.target.value)}
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-xs font-mono focus:border-[#673DE6] focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setUrlModalRecipient(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleUpdateRecipientUrl(urlModalRecipient.id, urlModalValue)}
                className="px-5 py-2 bg-[#673DE6] hover:bg-[#5025D1] text-white text-xs font-bold rounded-xl shadow-xs"
              >
                Save &amp; Schedule Form
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
