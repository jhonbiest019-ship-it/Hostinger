"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState, useMemo } from "react";
import { Badge, EmptyState } from "@/components/ui";
import { parseCsv, csvValue } from "@/lib/csv";
import { renderTemplate, formatEmailBodyToHtml } from "@/lib/email/template";
import { PreSendReviewModal, ReviewRecipient } from "@/components/pre-send-review-modal";

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  sheetUrl?: string | null;
  sheetWebhookUrl?: string | null;
  mailbox: { id: string; emailAddress: string; displayName: string | null } | null;
  template: { id: string; name: string; subject: string } | null;
  counters: { total: number; pending: number; sending: number; sent: number; failed: number; skipped: number };
  createdAt: string;
  updatedAt: string;
};

type Mailbox = {
  id: string;
  emailAddress: string;
  displayName?: string | null;
  username?: string | null;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecurity?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecurity?: string;
  status: string;
  smtpStatus: string;
  imapStatus?: string;
  lastError?: string | null;
  lastCheckedAt?: string | null;
};
type Template = { id: string; name: string; subject: string; body: string; isDefault?: boolean };

interface SheetRow {
  index: number; // 1-based data row number
  sheetRowNumber?: number; // Actual Google Sheet row number (header is row 1)
  sheetNum?: number; // Continuous 1, 2, 3, 4, 5... from Num column
  asin?: string;
  amazonLink?: string;
  brandName: string;
  brandEmail: string;
  productCategory: string;
  website: string;
  hasValidEmail?: boolean;
  hasValidBrand?: boolean;
  hasValidCategory?: boolean;
  quality: "COMPLETE" | "INCOMPLETE" | "NO_EMAIL" | "NO_BRAND" | "NO_CATEGORY";
  missingFields: string[];
  raw: Record<string, any>;
}

interface SkippedNoEmailRow {
  originalIndex: number;
  sheetNum?: number;
  asin?: string;
  amazonLink?: string;
  brandName: string;
  brandEmail: string;
  productCategory: string;
  website: string;
  reason: string;
  raw: Record<string, any>;
}

function getAutoCampaignDateName(existingCampaigns: { name: string }[] = []) {
  const now = new Date();
  const d = now.getDate();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = months[now.getMonth()];
  const y = now.getFullYear();
  const base = `Campaign - ${d} ${m} ${y}`;
  const count = existingCampaigns.filter((c) => c.name.startsWith(base)).length;
  return count > 0 ? `${base} (#${count + 1})` : base;
}

interface CampaignWorkspaceProps {
  initialSourceMode?: "file" | "googlesheet" | "manual";
}

export function CampaignWorkspace({ initialSourceMode }: CampaignWorkspaceProps = {}) {
  const [activeTab, setActiveTab] = useState<"excel" | "list">("excel");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Authenticated user session & real-time user-isolated mailbox states
  const [currentUser, setCurrentUser] = useState<{ id: string; name?: string | null; email: string } | null>(null);
  const [mailboxRefreshing, setMailboxRefreshing] = useState(false);
  const [mailboxActionBusy, setMailboxActionBusy] = useState<string | null>(null);
  const [mailboxNotification, setMailboxNotification] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Quick Add / Edit Hostinger Mailbox Modal in Step 3
  const [mailboxModalOpen, setMailboxModalOpen] = useState(false);
  const [mailboxModalMode, setMailboxModalMode] = useState<"add" | "edit">("add");
  const [mailboxModalTargetId, setMailboxModalTargetId] = useState<string | null>(null);
  const [mailboxFormEmail, setMailboxFormEmail] = useState("");
  const [mailboxFormDisplayName, setMailboxFormDisplayName] = useState("");
  const [mailboxFormUsername, setMailboxFormUsername] = useState("");
  const [mailboxFormPassword, setMailboxFormPassword] = useState("");
  const [mailboxFormSmtpHost, setMailboxFormSmtpHost] = useState("smtp.hostinger.com");
  const [mailboxFormSmtpPort, setMailboxFormSmtpPort] = useState(465);
  const [mailboxFormSmtpSecurity, setMailboxFormSmtpSecurity] = useState("TLS");
  const [mailboxFormImapHost, setMailboxFormImapHost] = useState("imap.hostinger.com");
  const [mailboxFormImapPort, setMailboxFormImapPort] = useState(993);
  const [mailboxFormImapSecurity, setMailboxFormImapSecurity] = useState("TLS");
  const [mailboxFormBusy, setMailboxFormBusy] = useState(false);
  const [mailboxFormError, setMailboxFormError] = useState<string | null>(null);

  // Schedule Draft Campaign Modal
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [targetDraftCampaign, setTargetDraftCampaign] = useState<Campaign | null>(null);
  const [draftScheduleDate, setDraftScheduleDate] = useState("");
  const [draftScheduleTime, setDraftScheduleTime] = useState("");
  const [draftScheduleIntervalSec, setDraftScheduleIntervalSec] = useState<number>(60);
  const [draftScheduleMailboxId, setDraftScheduleMailboxId] = useState("");
  const [schedulingBusy, setSchedulingBusy] = useState(false);

  // Edit Campaign Modal State (Supports draft, running, and paused campaigns)
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [targetEditCampaign, setTargetEditCampaign] = useState<Campaign | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editMailboxId, setEditMailboxId] = useState("");
  const [editTemplateId, setEditTemplateId] = useState("");
  const [editDelaySeconds, setEditDelaySeconds] = useState(60);
  const [editSheetUrl, setEditSheetUrl] = useState("");
  const [editSheetWebhookUrl, setEditSheetWebhookUrl] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Website Form Automation State (Active by default)
  const [formAutomationEnabled, setFormAutomationEnabled] = useState(true);
  const [formTemplates, setFormTemplates] = useState<any[]>([]);
  const [selectedFormTemplateId, setSelectedFormTemplateId] = useState("");
  const [formScheduleMode, setFormScheduleMode] = useState<"SAME_TIME" | "DIFFERENT_TIME">("SAME_TIME");
  const [formScheduledDate, setFormScheduledDate] = useState("");
  const [formScheduledTime, setFormScheduledTime] = useState("");
  const [formConcurrency, setFormConcurrency] = useState(2);
  const [browserAgentStatus, setBrowserAgentStatus] = useState<"READY" | "CONNECTED" | "OFFLINE">("OFFLINE");
  const [formOverrides, setFormOverrides] = useState<Record<string, { targetUrl?: string; resolvedValues?: Record<string, any>; excluded?: boolean }>>({});

  // Final Pre-Send Review Modal State (Mandatory check before any send)
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewModalData, setReviewModalData] = useState<{
    campaignTitle: string;
    senderMailbox: string;
    totalRecipients: number;
    sendMode: "sendNow" | "schedule";
    scheduledTime?: string;
    delayAmount: number;
    delayUnit: string;
    subjectTemplate: string;
    bodyTemplate: string;
    followUpEnabled?: boolean;
    followUpDays?: number;
    recipients: ReviewRecipient[];
    formAutomationEnabled?: boolean;
    formTemplateName?: string;
    formScheduleMode?: "SAME_TIME" | "DIFFERENT_TIME";
    formScheduledTime?: string;
    formConcurrency?: number;
    onConfirmExecute: () => Promise<void>;
  } | null>(null);
  const [reviewConfirming, setReviewConfirming] = useState(false);

  // Active Sending Real-Time Banner
  const [activeSendingBanner, setActiveSendingBanner] = useState<{
    visible: boolean;
    title: string;
    details: string;
    status: "sending" | "completed";
  } | null>(null);

  // Excel / CSV / Google Sheet / Manual Campaign State
  const [sourceMode, setSourceMode] = useState<"file" | "googlesheet" | "manual">(initialSourceMode || "file");
  const [googleSheetUrl, setGoogleSheetUrl] = useState("");
  const [googleSheetLoading, setGoogleSheetLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [allParsedRows, setAllParsedRows] = useState<SheetRow[]>([]);
  const [skippedNoEmailRows, setSkippedNoEmailRows] = useState<SkippedNoEmailRow[]>([]);
  const [showExcludedRows, setShowExcludedRows] = useState(false);
  const [fromRow, setFromRow] = useState<number>(1);
  const [toRow, setToRow] = useState<number>(20);
  const [sheetStartRowInput, setSheetStartRowInput] = useState<string>("");
  const [sheetEndRowInput, setSheetEndRowInput] = useState<string>("");

  // Manual Email Input State
  const [manualInputMode, setManualInputMode] = useState<"single" | "bulk">("single");
  const [manualEmail, setManualEmail] = useState("");
  const [manualBrandName, setManualBrandName] = useState("");
  const [manualCategory, setManualCategory] = useState("");
  const [manualWebsite, setManualWebsite] = useState("");
  const [manualBulkText, setManualBulkText] = useState("");

  function handleStartRowChange(val: string) {
    setSheetStartRowInput(val);
    if (!val.trim()) {
      setFromRow(1);
    } else {
      const num = parseInt(val, 10);
      if (!isNaN(num) && num >= 1) {
        setFromRow(num);
      }
    }
  }

  function handleEndRowChange(val: string) {
    setSheetEndRowInput(val);
    if (!val.trim()) {
      if (allParsedRows.length > 0) {
        setToRow(allParsedRows.length);
      }
    } else {
      const num = parseInt(val, 10);
      if (!isNaN(num) && num >= 1) {
        setToRow(num);
      }
    }
  }

  async function handleFetchGoogleSheet(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!googleSheetUrl.trim()) {
      setMessage({ type: "error", text: "Please paste a valid Google Sheet link." });
      return;
    }
    setGoogleSheetLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/campaigns/google-sheet", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: googleSheetUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch Google Sheet.");

      const sheetLabel = `Google Sheet (Tab ${data.gid || "0"})`;
      setFileName(sheetLabel);
      const parsedRows: SheetRow[] = data.rows || [];
      const skippedRows: SkippedNoEmailRow[] = data.skippedRows || [];
      setAllParsedRows(parsedRows);
      setSkippedNoEmailRows(skippedRows);
      const totalCount = parsedRows.length;

      let effectiveFrom = 1;
      if (sheetStartRowInput.trim()) {
        const parsedStart = parseInt(sheetStartRowInput.trim(), 10);
        if (!isNaN(parsedStart) && parsedStart >= 1) {
          effectiveFrom = Math.min(parsedStart, totalCount);
        }
      }

      let effectiveTo = totalCount;
      if (sheetEndRowInput.trim()) {
        const parsedEnd = parseInt(sheetEndRowInput.trim(), 10);
        if (!isNaN(parsedEnd) && parsedEnd >= effectiveFrom) {
          effectiveTo = Math.min(parsedEnd, totalCount);
        }
      }

      setFromRow(effectiveFrom);
      setToRow(effectiveTo);
      setSheetStartRowInput(String(effectiveFrom));
      setSheetEndRowInput(String(effectiveTo));

      const completeCount = data.completeCount ?? parsedRows.filter((r) => r.quality === "COMPLETE").length;
      const incompleteCount = data.incompleteCount ?? parsedRows.filter((r) => r.quality === "INCOMPLETE").length;
      const noEmailCount = data.noEmailCount ?? parsedRows.filter((r) => r.quality === "NO_EMAIL").length;

      setMessage({
        type: "success",
        text: `✓ Google Sheet loaded! ${totalCount} rows preserved in exact spreadsheet sequence.`,
      });
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Failed to load Google Sheet." });
    } finally {
      setGoogleSheetLoading(false);
    }
  }

  // Campaign Form State
  const [campaignName, setCampaignName] = useState("");
  const [mailboxId, setMailboxId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // Send Mode & Spacing
  const [sendMode, setSendMode] = useState<"sendNow" | "schedule">("sendNow");
  const [scheduleTime, setScheduleTime] = useState("");
  const [delayAmount, setDelayAmount] = useState<number>(2);
  const [delayUnit, setDelayUnit] = useState<"seconds" | "minutes">("minutes");
  const [previewRowIndex, setPreviewRowIndex] = useState(0);
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpDays, setFollowUpDays] = useState(3);
  const [followUpTemplateId, setFollowUpTemplateId] = useState("");

  function getKarachiParts(d: Date) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Karachi",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = Object.fromEntries(formatter.formatToParts(d).map((p) => [p.type, p.value]));
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
    };
  }

  function calculateEndTime(startDate: Date | string, totalCount: number, delaySec: number) {
    if (totalCount <= 0) return "—";
    const base = typeof startDate === "string" ? new Date(startDate) : startDate;
    const startMs = isNaN(base.getTime()) ? Date.now() : base.getTime();
    const end = new Date(startMs + Math.max(0, totalCount - 1) * delaySec * 1000);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Karachi",
      hour: "2-digit",
      minute: "2-digit",
    }).format(end);
  }

  // Load SheetJS dynamically from public directory
  useEffect(() => {
    if (typeof window !== "undefined" && !(window as any).XLSX) {
      const script = document.createElement("script");
      script.src = "/xlsx.full.min.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  async function fetchMailboxesOnly(silently = false) {
    if (!silently) setMailboxRefreshing(true);
    try {
      const res = await fetch("/api/mailboxes", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      const list: Mailbox[] = data.mailboxes || [];
      setMailboxes(list);

      // Keep selected mailbox valid or pick the best active one
      setMailboxId((prevId) => {
        if (prevId && list.some((m) => m.id === prevId)) return prevId;
        const activeOne = list.find((m) => m.status === "ACTIVE" && m.smtpStatus === "CONNECTED");
        return activeOne?.id || list[0]?.id || "";
      });
    } catch {
      // ignore
    } finally {
      if (!silently) setMailboxRefreshing(false);
    }
  }

  async function loadInitialData() {
    try {
      setLoading(true);
      const [cRes, mRes, tRes, uRes] = await Promise.all([
        fetch("/api/campaigns", { credentials: "include" }),
        fetch("/api/mailboxes", { credentials: "include" }),
        fetch("/api/templates", { credentials: "include" }),
        fetch("/api/auth/me", { credentials: "include" }).catch(() => null),
      ]);
      const [cData, mData, tData, uData] = await Promise.all([
        cRes.json(),
        mRes.json(),
        tRes.json(),
        uRes && uRes.ok ? uRes.json() : Promise.resolve(null),
      ]);

      if (uData?.user) {
        setCurrentUser(uData.user);
      }

      setCampaigns(cData.campaigns || []);
      const list: Mailbox[] = mData.mailboxes || [];
      setMailboxes(list);
      
      const userKey = uData?.user?.id ? `active_sender_mailbox_id_${uData.user.id}` : "active_sender_mailbox_id";
      const savedId = typeof window !== "undefined" ? localStorage.getItem(userKey) || localStorage.getItem("active_sender_mailbox_id") : null;
      if (savedId && list.some((m: any) => m.id === savedId)) {
        setMailboxId(savedId);
      } else {
        const activeOne = list.find((m) => m.status === "ACTIVE" && m.smtpStatus === "CONNECTED");
        if (activeOne) setMailboxId(activeOne.id);
        else if (list.length > 0) setMailboxId(list[0].id);
      }

      const loadedTemplates: Template[] = tData.templates || [];
      setTemplates(loadedTemplates);
      const activeTpl = loadedTemplates.find((t) => t.isDefault) || loadedTemplates[0];
      if (activeTpl) {
        setSelectedTemplateId(activeTpl.id);
        setSubject(activeTpl.subject);
        setBody(activeTpl.body);
      }

      // Load Form Templates & Browser Agent status
      try {
        const ftRes = await fetch("/api/forms/templates");
        if (ftRes.ok) {
          const ftData = await ftRes.json();
          const fList = ftData.templates || [];
          setFormTemplates(fList);
          const defForm = fList.find((f: any) => f.isDefault) || fList[0];
          if (defForm) setSelectedFormTemplateId(defForm.id);
        }
      } catch {}

      try {
        const baRes = await fetch("/api/browser-agent");
        if (baRes.ok) {
          const baData = await baRes.json();
          setBrowserAgentStatus(baData.agent?.status || "OFFLINE");
        }
      } catch {}
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleSwitchSender(newId: string) {
    const targetMb = mailboxes.find((m) => m.id === newId);
    setMailboxId(newId);
    const userKey = currentUser?.id ? `active_sender_mailbox_id_${currentUser.id}` : "active_sender_mailbox_id";
    if (typeof window !== "undefined") {
      localStorage.setItem(userKey, newId);
      localStorage.setItem("active_sender_mailbox_id", newId);
      window.dispatchEvent(new CustomEvent("sender-mailbox-changed", { detail: { mailboxId: newId } }));
    }

    if (targetMb) {
      if (targetMb.status === "ACTIVE" && targetMb.smtpStatus === "CONNECTED") {
        setMailboxNotification({
          type: "success",
          text: `⚡ Active sender switched to ${targetMb.displayName ? `[${targetMb.displayName}] ` : ""}${targetMb.emailAddress} in real time!`,
        });
      } else {
        setMailboxNotification({
          type: "error",
          text: `⚠️ Selected mailbox ${targetMb.emailAddress} is not fully connected. Click "Fix / Reconnect" to test it.`,
        });
      }
      setTimeout(() => setMailboxNotification(null), 4000);
    }

    try {
      await fetch("/api/mailboxes/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mailboxId: newId }),
      });
    } catch {}
  }

  async function handleTestMailboxConnection(id: string, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    setMailboxActionBusy(`test-${id}`);
    setMailboxNotification(null);
    try {
      const res = await fetch(`/api/mailboxes/${id}/test`, { method: "POST", body: "{}" });
      const data = await res.json();
      await fetchMailboxesOnly(false);
      if (data.success) {
        setMailboxNotification({
          type: "success",
          text: `✓ Connection Verified! SMTP and IMAP connected successfully.`,
        });
      } else {
        setMailboxNotification({
          type: "error",
          text: `❌ Verification failed: ${data.lastError || data.message || "Authentication failed. Check credentials."}`,
        });
      }
    } catch (err: any) {
      setMailboxNotification({
        type: "error",
        text: `Failed to test connection: ${err.message || "Network error"}`,
      });
    } finally {
      setMailboxActionBusy(null);
      setTimeout(() => setMailboxNotification(null), 5000);
    }
  }

  function handleOpenAddMailboxModal() {
    setMailboxModalMode("add");
    setMailboxModalTargetId(null);
    setMailboxFormEmail("");
    setMailboxFormDisplayName("");
    setMailboxFormUsername("");
    setMailboxFormPassword("");
    setMailboxFormSmtpHost("smtp.hostinger.com");
    setMailboxFormSmtpPort(465);
    setMailboxFormSmtpSecurity("TLS");
    setMailboxFormImapHost("imap.hostinger.com");
    setMailboxFormImapPort(993);
    setMailboxFormImapSecurity("TLS");
    setMailboxFormError(null);
    setMailboxModalOpen(true);
  }

  function handleOpenEditMailboxModal(mb: Mailbox, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    setMailboxModalMode("edit");
    setMailboxModalTargetId(mb.id);
    setMailboxFormEmail(mb.emailAddress);
    setMailboxFormDisplayName(mb.displayName || "");
    setMailboxFormUsername(mb.username || mb.emailAddress);
    setMailboxFormPassword("");
    setMailboxFormSmtpHost(mb.smtpHost || "smtp.hostinger.com");
    setMailboxFormSmtpPort(mb.smtpPort || 465);
    setMailboxFormSmtpSecurity(mb.smtpSecurity || "TLS");
    setMailboxFormImapHost(mb.imapHost || "imap.hostinger.com");
    setMailboxFormImapPort(mb.imapPort || 993);
    setMailboxFormImapSecurity(mb.imapSecurity || "TLS");
    setMailboxFormError(mb.lastError || null);
    setMailboxModalOpen(true);
  }

  async function handleSaveMailboxForm(e: React.FormEvent) {
    e.preventDefault();
    setMailboxFormBusy(true);
    setMailboxFormError(null);

    const email = mailboxFormEmail.trim();
    let username = mailboxFormUsername.trim() || email;
    // Auto-fix Hostinger username if missing @
    if (mailboxFormSmtpHost.includes("hostinger.com") && !username.includes("@")) {
      username = email;
    }

    const payload: any = {
      emailAddress: email,
      displayName: mailboxFormDisplayName.trim() || null,
      username,
      smtpHost: mailboxFormSmtpHost.trim() || "smtp.hostinger.com",
      smtpPort: Number(mailboxFormSmtpPort) || 465,
      smtpSecurity: mailboxFormSmtpSecurity,
      imapHost: mailboxFormImapHost.trim() || "imap.hostinger.com",
      imapPort: Number(mailboxFormImapPort) || 993,
      imapSecurity: mailboxFormImapSecurity,
    };

    if (mailboxFormPassword.trim()) {
      payload.password = mailboxFormPassword.trim();
    } else if (mailboxModalMode === "add") {
      setMailboxFormError("Password is required to connect a new Hostinger mailbox.");
      setMailboxFormBusy(false);
      return;
    }

    try {
      const url = mailboxModalMode === "add" ? "/api/mailboxes" : `/api/mailboxes/${mailboxModalTargetId}`;
      const method = mailboxModalMode === "add" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save mailbox.");
      }

      const savedMb = data.mailbox;
      const isConnected = data.connectionStatus === "ACTIVE" || savedMb?.status === "ACTIVE";

      await fetchMailboxesOnly(false);
      if (savedMb?.id) {
        setMailboxId(savedMb.id);
        const userKey = currentUser?.id ? `active_sender_mailbox_id_${currentUser.id}` : "active_sender_mailbox_id";
        if (typeof window !== "undefined") {
          localStorage.setItem(userKey, savedMb.id);
          localStorage.setItem("active_sender_mailbox_id", savedMb.id);
        }
      }

      setMailboxModalOpen(false);
      setMailboxNotification({
        type: isConnected ? "success" : "error",
        text: isConnected
          ? `✓ Hostinger mailbox ${email} successfully connected & verified in real time!`
          : `⚠️ Saved, but Hostinger verification failed: ${data.lastError || savedMb?.lastError || "Check password."}`,
      });
      setTimeout(() => setMailboxNotification(null), 5000);
    } catch (err: any) {
      setMailboxFormError(err.message || "Failed to save mailbox.");
    } finally {
      setMailboxFormBusy(false);
    }
  }

  useEffect(() => {
    void loadInitialData();

    // Auto-poll user mailboxes every 6s so updates in another tab or mailbox test reflect in real time
    const pollInterval = setInterval(() => {
      void fetchMailboxesOnly(true);
    }, 6000);

    const onMailboxesUpdated = () => void fetchMailboxesOnly(true);
    const onSenderChanged = (e: any) => {
      const id = e.detail?.mailboxId;
      if (id) setMailboxId(id);
    };

    window.addEventListener("mailboxes-updated", onMailboxesUpdated);
    window.addEventListener("sender-mailbox-changed", onSenderChanged);

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("source") === "googlesheet" || params.get("mode") === "googlesheet") {
        setSourceMode("googlesheet");
      }
    }

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener("mailboxes-updated", onMailboxesUpdated);
      window.removeEventListener("sender-mailbox-changed", onSenderChanged);
    };
  }, []);

  // Real-time sending monitor
  useEffect(() => {
    let timer: NodeJS.Timeout;
    async function checkActiveSending() {
      try {
        const res = await fetch("/api/campaigns/active-status", { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.isSending && data.activeCampaigns?.length) {
          const current = data.activeCampaigns[0];
          setActiveSendingBanner({
            visible: true,
            title: `⚡ Real-Time Sending in Progress: "${current.name}"`,
            details: `Actively dispatching via ${current.mailboxEmail} (${current.sent}/${current.total} sent, ${current.pending} pending)...`,
            status: "sending",
          });
        } else if (activeSendingBanner?.status === "sending") {
          setActiveSendingBanner({
            visible: true,
            title: `✅ Email Sending Completed!`,
            details: `All scheduled emails have been dispatched successfully and recorded in Hostinger Sent box.`,
            status: "completed",
          });
          setTimeout(() => setActiveSendingBanner(null), 6000);
        }
      } catch {
        // ignore
      }
    }
    void checkActiveSending();
    timer = setInterval(checkActiveSending, 6000);
    return () => clearInterval(timer);
  }, []);

  // Handle File Upload (Excel .xlsx, .xls or CSV .csv)
  function handleFileUpload(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setMessage(null);

    const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    const isCsv = file.name.endsWith(".csv");

    if (!isExcel && !isCsv) {
      setMessage({ type: "error", text: "Please upload an Excel file (.xlsx, .xls) or CSV file (.csv)." });
      return;
    }

    if (isExcel && (window as any).XLSX) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = (window as any).XLSX.read(data, { type: "array" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const json: any[] = (window as any).XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

          processParsedData(json, file.name);
        } catch (err: any) {
          setMessage({ type: "error", text: "Unable to parse Excel file: " + err.message });
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // CSV parser fallback
      file.text().then((text) => {
        const rows = parseCsv(text);
        processParsedData(rows, file.name);
      });
    }
  }

  function processParsedData(rawRows: any[], currentFileName?: string) {
    if (!rawRows.length) {
      setMessage({ type: "error", text: "The sheet is empty or contains no data rows." });
      return;
    }

    const columns = Object.keys(rawRows[0] || {});

    // Detect Num column (Column A in sheet: Num / No / Sr / #)
    const numKey =
      columns.find((k) =>
        /^(num|no|s\.?no|sr\.?(no)?|#|index|id|serial)$/i.test(k.trim().toLowerCase())
      ) ||
      columns.find((k) =>
        /^(num|no|sr)/i.test(k.trim().toLowerCase()) &&
        !/phone|mobile|tel|category|asin|name/i.test(k.trim().toLowerCase())
      ) ||
      columns[0];

    // Detect Asin column (Column B in sheet: Asin)
    const asinKey = columns.find((k) => /^asin$|^product\s*id/i.test(k.trim().toLowerCase()));

    // Detect Amazon Link column (Column C in sheet: Amazon LINK / Amz)
    const amazonLinkKey = columns.find((k) =>
      /amazon|amz|listing/i.test(k.trim().toLowerCase())
    );

    // Detect Brand Name column (Column D in sheet: Brand name)
    const brandKey =
      columns.find((k) => /^brand(\s*name)?$/i.test(k.trim().toLowerCase())) ||
      columns.find(
        (k) =>
          /brand|company|business|store|vendor|partner|client/i.test(k.toLowerCase()) &&
          !/email|mail|phone|web|site|asin|link|num/i.test(k.toLowerCase())
      );

    const allProcessedRows: SheetRow[] = [];
    let sequentialCounter = 0;

    rawRows.forEach((row, idx) => {
      // 1. Check if row is completely blank
      const values = Object.values(row).map((v) => (v ? String(v).trim() : ""));
      const isBlank = values.every((v) => v === "");
      if (isBlank) return;

      // 2. Extract sheet Num (Column A: 1, 2, 3, 4, 5...)
      let sheetNum: number | null = null;
      if (numKey && row[numKey] !== undefined && String(row[numKey]).trim() !== "") {
        const parsed = parseInt(String(row[numKey]).trim(), 10);
        if (!isNaN(parsed) && parsed > 0) {
          sheetNum = parsed;
        }
      }

      // 3. Extract Asin & Amazon Link
      const asin = asinKey ? String(row[asinKey]).trim() : "";
      const amazonLink = amazonLinkKey ? String(row[amazonLinkKey]).trim() : "";

      // 4. Extract Brand Name
      const rawBrand = brandKey ? String(row[brandKey]).trim() : "";
      const hasBrand = Boolean(rawBrand && !/^(undefined|null|none|n\/a|-)$/i.test(rawBrand));

      // Maintain sequential continuous number starting from 1, 2, 3...
      sequentialCounter++;
      const itemNum = sheetNum !== null ? sheetNum : sequentialCounter;

      // 5. Find Brand Email (Mandatory)
      let foundEmail: string | null = null;
      const emailRegexMatch = (val: any) => {
        if (!val) return null;
        const cleaned = String(val).trim().replace(/^mailto:\s*/i, "");
        const match = cleaned.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        return match ? match[0].toLowerCase() : null;
      };

      const emailKeys = Object.keys(row).filter(
        (k) => /email|mail|e-mail/i.test(k.toLowerCase()) && !/phone|tel|mobile/i.test(k.toLowerCase())
      );
      for (const k of emailKeys) {
        const candidate = emailRegexMatch(row[k]);
        if (candidate) {
          foundEmail = candidate;
          break;
        }
      }
      if (!foundEmail) {
        for (const [k, v] of Object.entries(row)) {
          if (k === numKey || k === asinKey || k === amazonLinkKey) continue;
          const candidate = emailRegexMatch(v);
          if (candidate) {
            foundEmail = candidate;
            break;
          }
        }
      }

      const isValidEmail = Boolean(foundEmail);
      const rawEmail = foundEmail || "";

      // 6. Find Product Category
      const categoryKey = Object.keys(row).find((k) =>
        /category|niche|product|industry|tag|segment|type/i.test(k.toLowerCase()) &&
        !/asin|link|num|brand|email/i.test(k.toLowerCase())
      );
      const rawCategory = categoryKey ? String(row[categoryKey]).trim() : "";
      const hasCategory = Boolean(rawCategory && !/^(undefined|null|none|n\/a|-)$/i.test(rawCategory));

      // 7. Find Website
      const webKey = Object.keys(row).find((k) =>
        /web|site|url|domain/i.test(k.toLowerCase()) && !/amazon|amz/i.test(k.toLowerCase())
      );
      const website = webKey ? String(row[webKey]).trim() : (amazonLink || "");

      const brandName = hasBrand
        ? rawBrand
        : (asin ? `Brand (${asin})` : (rawEmail ? `Brand (${rawEmail.split("@")[0]})` : `Item #${itemNum}`));

      // 8. Lead Quality Classification (Preserves strict row order, never sorts or shifts)
      const hasValidEmail = Boolean(isValidEmail);
      const hasValidBrand = Boolean(hasBrand);
      const hasValidCategory = Boolean(hasCategory);

      let quality: "COMPLETE" | "NO_EMAIL" | "NO_BRAND" | "NO_CATEGORY" | "INCOMPLETE" = "COMPLETE";
      const missingFields: string[] = [];

      if (!hasValidEmail) {
        missingFields.push("Email Address");
      }
      if (!hasValidBrand) {
        missingFields.push("Brand Name");
      }
      if (!hasValidCategory) {
        missingFields.push("Product Category");
      }

      if (!hasValidEmail) {
        quality = "NO_EMAIL";
      } else if (!hasValidBrand) {
        quality = "NO_BRAND";
      } else if (!hasValidCategory) {
        quality = "NO_CATEGORY";
      } else if (missingFields.length > 0) {
        quality = "INCOMPLETE";
      } else {
        quality = "COMPLETE";
      }

      allProcessedRows.push({
        index: sequentialCounter,
        sheetRowNumber: idx + 2,
        sheetNum: itemNum,
        asin,
        amazonLink,
        brandName,
        brandEmail: rawEmail,
        productCategory: hasCategory ? rawCategory : "Missing Category",
        website,
        hasValidEmail,
        hasValidBrand,
        hasValidCategory,
        quality,
        missingFields,
        raw: row,
      });
    });

    setAllParsedRows(allProcessedRows);
    setSkippedNoEmailRows([]);

    const totalCount = allProcessedRows.length;
    let effectiveFrom = 1;
    if (sheetStartRowInput.trim()) {
      const parsedStart = parseInt(sheetStartRowInput.trim(), 10);
      if (!isNaN(parsedStart) && parsedStart >= 1) {
        effectiveFrom = Math.min(parsedStart, totalCount);
      }
    }
    let effectiveTo = totalCount;
    if (sheetEndRowInput.trim()) {
      const parsedEnd = parseInt(sheetEndRowInput.trim(), 10);
      if (!isNaN(parsedEnd) && parsedEnd >= effectiveFrom) {
        effectiveTo = Math.min(parsedEnd, totalCount);
      }
    }
    setFromRow(effectiveFrom);
    setToRow(effectiveTo);
    setSheetStartRowInput(String(effectiveFrom));
    setSheetEndRowInput(String(effectiveTo));

    setMessage({
      type: "success",
      text: `✓ File processed! ${allProcessedRows.length} total rows preserved in exact sequence.`,
    });
  }

  function fileBaseName(name: string) {
    return name.replace(/\.[^/.]+$/, "");
  }

  // Manual Email Handlers
  function handleAddSingleManualEmail(e?: FormEvent) {
    if (e) e.preventDefault();
    const email = manualEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage({ type: "error", text: "Please enter a valid email address." });
      return;
    }

    if (allParsedRows.some((r) => r.brandEmail.toLowerCase() === email)) {
      setMessage({ type: "error", text: `Email "${email}" is already in the list.` });
      return;
    }

    const brandName = manualBrandName.trim() || email.split("@")[0];
    const productCategory = manualCategory.trim() || "General";
    const website = manualWebsite.trim() || "";
    const nextNum = allParsedRows.length + 1;

    const newRow: SheetRow = {
      index: nextNum,
      sheetNum: nextNum,
      asin: "",
      amazonLink: website,
      brandName,
      brandEmail: email,
      productCategory,
      website,
      quality: "COMPLETE",
      missingFields: [],
      raw: {
        "Brand Name": brandName,
        "Brand Email": email,
        "Product Category": productCategory,
        Website: website,
      },
    };

    const updatedRows = [...allParsedRows, newRow].map((r, i) => ({ ...r, index: i + 1, sheetNum: i + 1 }));
    setAllParsedRows(updatedRows);
    if (!fileName || fileName.startsWith("Manual")) {
      setFileName("Manual Contacts List");
    }
    setFromRow(1);
    setToRow(updatedRows.length);
    setSheetStartRowInput("1");
    setSheetEndRowInput(String(updatedRows.length));

    setManualEmail("");
    setManualBrandName("");
    setManualCategory("");
    setManualWebsite("");
    setMessage({ type: "success", text: `✓ Added "${brandName}" (${email}) to campaign list!` });
  }

  function handleAddBulkManualEmails(e?: FormEvent) {
    if (e) e.preventDefault();
    const text = manualBulkText.trim();
    if (!text) {
      setMessage({ type: "error", text: "Please paste at least one email address." });
      return;
    }

    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const existingSet = new Set(allParsedRows.map((r) => r.brandEmail.toLowerCase()));
    const newRows: SheetRow[] = [];
    let skippedDuplicates = 0;

    for (const line of lines) {
      const parts = line.split(/[,;\t]/).map((p) => p.trim());
      let email = "";
      let brandName = "";
      let category = "General";
      let website = "";

      const emailIdx = parts.findIndex((p) => emailRegex.test(p.toLowerCase()));
      if (emailIdx !== -1) {
        email = parts[emailIdx].toLowerCase();
        if (emailIdx > 0) {
          brandName = parts[0];
        }
        if (parts.length > emailIdx + 1 && parts[emailIdx + 1]) {
          category = parts[emailIdx + 1];
        }
        if (parts.length > emailIdx + 2 && parts[emailIdx + 2]) {
          website = parts[emailIdx + 2];
        }
      } else {
        const match = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (match) {
          email = match[0].toLowerCase();
          brandName = email.split("@")[0];
        }
      }

      if (!email) continue;
      if (existingSet.has(email)) {
        skippedDuplicates++;
        continue;
      }
      existingSet.add(email);

      if (!brandName) brandName = email.split("@")[0];

      newRows.push({
        index: 0,
        sheetNum: 0,
        asin: "",
        amazonLink: website,
        brandName,
        brandEmail: email,
        productCategory: category,
        website,
        quality: "COMPLETE",
        missingFields: [],
        raw: {
          "Brand Name": brandName,
          "Brand Email": email,
          "Product Category": category,
          Website: website,
        },
      });
    }

    if (newRows.length === 0) {
      setMessage({
        type: "error",
        text: skippedDuplicates > 0 ? "All entered emails are already in the list." : "No valid email addresses found in the pasted text.",
      });
      return;
    }

    const updatedRows = [...allParsedRows, ...newRows].map((r, i) => ({ ...r, index: i + 1, sheetNum: i + 1 }));
    setAllParsedRows(updatedRows);
    if (!fileName || fileName.startsWith("Manual")) {
      setFileName("Manual Contacts List");
    }
    setFromRow(1);
    setToRow(updatedRows.length);
    setSheetStartRowInput("1");
    setSheetEndRowInput(String(updatedRows.length));
    setManualBulkText("");

    setMessage({
      type: "success",
      text: `✓ Added ${newRows.length} email${newRows.length > 1 ? "s" : ""} to the list!${
        skippedDuplicates > 0 ? ` (${skippedDuplicates} duplicates skipped)` : ""
      }`,
    });
  }

  function handleRemoveParsedRow(indexToRemove: number) {
    const updated = allParsedRows
      .filter((_, idx) => idx !== indexToRemove)
      .map((r, i) => ({ ...r, index: i + 1, sheetNum: i + 1 }));
    setAllParsedRows(updated);
    if (updated.length > 0) {
      const newTo = Math.min(toRow, updated.length);
      setToRow(newTo);
      setSheetEndRowInput(String(newTo));
    } else {
      setFromRow(1);
      setToRow(0);
      setSheetStartRowInput("");
      setSheetEndRowInput("");
    }
  }

  function handleClearAllParsedRows() {
    if (!confirm("Are you sure you want to clear all recipients from the list?")) return;
    setAllParsedRows([]);
    setFromRow(1);
    setToRow(20);
    setSheetStartRowInput("");
    setSheetEndRowInput("");
    setFileName("");
  }

  // Active Selected Rows based on fromRow and toRow: exactly fromRow to toRow (End - Start + 1)
  const selectedRows = useMemo(() => {
    if (!allParsedRows.length) return [];
    const start = Math.max(1, fromRow);
    const end = Math.min(allParsedRows.length, toRow);
    if (start > end) return [];
    return allParsedRows.slice(start - 1, end);
  }, [allParsedRows, fromRow, toRow]);

  // Validation breakdown strictly within the selected row range (never across the entire sheet)
  const selectionBreakdown = useMemo(() => {
    const total = selectedRows.length;
    let completeCount = 0;
    let missingEmailCount = 0;
    let missingBrandCount = 0;
    let missingCategoryCount = 0;

    for (const r of selectedRows) {
      const isEmailValid = Boolean(
        r.brandEmail &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.brandEmail) &&
        !/^(n\/a|none|undefined|null|-)$/i.test(r.brandEmail)
      );
      const isBrandValid = Boolean(
        r.brandName &&
        !/^brand \(/i.test(r.brandName) &&
        !/^item #/i.test(r.brandName) &&
        !/^(undefined|null|none|n\/a|-)$/i.test(r.brandName)
      );
      const isCategoryValid = Boolean(
        r.productCategory &&
        r.productCategory !== "Missing Category" &&
        !/^(undefined|null|none|n\/a|-)$/i.test(r.productCategory)
      );

      if (!isEmailValid) missingEmailCount++;
      if (!isBrandValid) missingBrandCount++;
      if (!isCategoryValid) missingCategoryCount++;

      if (isEmailValid && isBrandValid && isCategoryValid) {
        completeCount++;
      }
    }

    return {
      total,
      completeCount,
      missingEmailCount,
      missingBrandCount,
      missingCategoryCount,
    };
  }, [selectedRows]);

  // Handle Template Selection
  function handleSelectTemplate(id: string) {
    setSelectedTemplateId(id);
    const t = templates.find((item) => item.id === id);
    if (t) {
      setSubject(t.subject);
      setBody(t.body);
    }
  }

  // Insert variable into template
  function insertVariable(variable: string) {
    setBody((prev) => `${prev} {{${variable}}}`);
  }

  // Save Campaign (Draft / Store without immediate dispatch)
  async function handleSaveCampaignOnly() {
    if (!selectedRows.length) {
      setMessage({ type: "error", text: "No rows selected. Please specify start and end row numbers." });
      return;
    }

    setBusy(true);
    setMessage(null);

    const finalCampaignName = campaignName.trim() || getAutoCampaignDateName(campaigns);

    try {
      const res = await fetch("/api/campaigns/sheet-send", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignName: finalCampaignName,
          mailboxId: mailboxId || undefined,
          templateId: selectedTemplateId || undefined,
          sheetUrl: sourceMode === "googlesheet" ? googleSheetUrl.trim() : undefined,
          subject: subject || undefined,
          body: body || undefined,
          saveOnly: true,
          startRow: fromRow,
          endRow: toRow,
          totalSelectedRows: selectedRows.length,
          rows: selectedRows.map((r) => ({
            rowIndex: r.index,
            sheetRowNumber: r.sheetRowNumber || (r.index + 1),
            sheetNum: r.sheetNum,
            asin: r.asin,
            amazonLink: r.amazonLink,
            brandName: r.brandName,
            brandEmail: r.brandEmail,
            productCategory: r.productCategory,
            website: r.website,
            quality: r.quality,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to save campaign.");
      }

      setMessage({
        type: "success",
        text: `💾 Campaign "${finalCampaignName}" saved successfully with ${selectedRows.length} brands (${data.count || 0} valid emails)! You can view it in the All Campaigns tab or schedule/dispatch below.`,
      });

      await loadInitialData();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Failed to save campaign." });
    } finally {
      setBusy(false);
    }
  }

  // Submit / Send Campaign - Triggers Mandatory Pre-Send Template Review Modal
  function handleSubmitCampaign() {
    if (!mailboxId) {
      setMessage({ type: "error", text: "Please select a verified sender mailbox." });
      return;
    }

    if (!selectedRows.length) {
      setMessage({ type: "error", text: "No rows selected. Please check your start and end row numbers." });
      return;
    }

    if (!subject.trim() || !body.trim()) {
      setMessage({ type: "error", text: "Please provide both Subject and Email Body." });
      return;
    }

    if (sendMode === "schedule" && !scheduleTime) {
      setMessage({ type: "error", text: "Please select a scheduled date and time." });
      return;
    }

    const finalCampaignName = campaignName.trim() || getAutoCampaignDateName(campaigns);
    const selectedMailboxObj = mailboxes.find((m) => m.id === mailboxId);
    const senderEmail = selectedMailboxObj?.emailAddress || "Default Hostinger Mailbox";

    const currentFormTpl = formTemplates.find((t) => t.id === selectedFormTemplateId);
    const formTplName = currentFormTpl?.name || "Wholesale Application";
    let effectiveFormScheduleTime: string | undefined = undefined;
    if (formScheduleMode === "DIFFERENT_TIME" && formScheduledDate && formScheduledTime) {
      effectiveFormScheduleTime = `${formScheduledDate}T${formScheduledTime}:00`;
    }

    setReviewModalData({
      campaignTitle: finalCampaignName,
      senderMailbox: senderEmail,
      totalRecipients: selectedRows.length,
      sendMode,
      scheduledTime: sendMode === "schedule" ? scheduleTime : undefined,
      delayAmount,
      delayUnit,
      subjectTemplate: subject,
      bodyTemplate: body,
      followUpEnabled,
      followUpDays,
      formAutomationEnabled,
      formTemplateName: formTplName,
      formScheduleMode,
      formScheduledTime: effectiveFormScheduleTime,
      formConcurrency,
      recipients: selectedRows.map((r, idx) => {
        const ovr = formOverrides[r.brandEmail] || formOverrides[r.brandName] || formOverrides[String(idx)] || {};
        const isExcluded = Boolean(ovr.excluded);
        const hasWeb = Boolean(r.website && r.website.trim() && !/^(n\/a|none|-)$/i.test(r.website));
        const derivedUrl = ovr.targetUrl || r.asin || (hasWeb ? `${r.website.replace(/\/+$/, "")}/wholesale` : "");
        return {
          brandName: r.brandName,
          brandEmail: r.brandEmail,
          productCategory: r.productCategory,
          asin: r.asin,
          amazonLink: r.amazonLink,
          website: r.website,
          formUrl: derivedUrl,
          sheetNum: r.sheetNum,
          formExcluded: isExcluded,
          formResolvedValues: ovr.resolvedValues,
          formStatus: isExcluded ? "EXCLUDED" : (hasWeb || derivedUrl ? "READY" : "MISSING_WEBSITE"),
          formMissingInfo: !hasWeb && !derivedUrl ? "Missing brand website URL" : undefined,
        };
      }),
      onConfirmExecute: async () => {
        await executeDirectSheetSend(finalCampaignName);
      },
    });
    setReviewModalOpen(true);
  }

  // Executes actual dispatch after user verifies template preview
  async function executeDirectSheetSend(finalCampaignName: string) {
    setReviewConfirming(true);
    setBusy(true);
    setMessage(null);

    const effectiveDelaySeconds = delayUnit === "minutes" ? delayAmount * 60 : delayAmount;
    let effectiveFormScheduleTime: string | undefined = undefined;
    if (formScheduleMode === "DIFFERENT_TIME" && formScheduledDate && formScheduledTime) {
      effectiveFormScheduleTime = `${formScheduledDate}T${formScheduledTime}:00`;
    }

    try {
      const res = await fetch("/api/campaigns/sheet-send", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignName: finalCampaignName,
          mailboxId,
          templateId: selectedTemplateId || undefined,
          sheetUrl: sourceMode === "googlesheet" ? googleSheetUrl.trim() : undefined,
          subject,
          body,
          sendMode,
          scheduleTime: sendMode === "schedule" ? scheduleTime : undefined,
          delaySeconds: effectiveDelaySeconds,
          timezone: "Asia/Karachi",
          followUpEnabled,
          followUpDays,
          followUpTemplateId: followUpTemplateId || undefined,
          formAutomationEnabled,
          formTemplateId: formAutomationEnabled ? (selectedFormTemplateId || undefined) : undefined,
          formScheduleMode,
          formScheduledAt: effectiveFormScheduleTime,
          formConcurrency,
          formOverrides,
          startRow: fromRow,
          endRow: toRow,
          totalSelectedRows: selectedRows.length,
          rows: selectedRows.map((r) => ({
            rowIndex: r.index,
            sheetRowNumber: r.sheetRowNumber || (r.index + 1),
            sheetNum: r.sheetNum,
            asin: r.asin,
            amazonLink: r.amazonLink,
            brandName: r.brandName,
            brandEmail: r.brandEmail,
            productCategory: r.productCategory,
            website: r.website,
            quality: r.quality,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to send campaign.");
      }

      setReviewModalOpen(false);
      setMessage({
        type: "success",
        text:
          sendMode === "sendNow"
            ? `🎉 Successfully queued ${data.count} emails! Emails will be sent with a ${delayAmount} ${delayUnit} gap between each send in real time.`
            : `🕒 Successfully scheduled ${data.count} emails starting ${new Date(scheduleTime).toLocaleString()} with a ${delayAmount} ${delayUnit} gap!`,
      });

      if (sendMode === "sendNow") {
        setActiveSendingBanner({
          visible: true,
          title: `⚡ Email Sending Started!`,
          details: `Campaign "${finalCampaignName}" is actively dispatching ${data.count} emails in real-time via Hostinger SMTP.`,
          status: "sending",
        });
      } else {
        setActiveSendingBanner({
          visible: true,
          title: `🕒 Campaign Scheduled!`,
          details: `Campaign "${finalCampaignName}" scheduled to send ${data.count} emails.`,
          status: "completed",
        });
      }

      // Reload campaigns list
      await loadInitialData();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      alert(err.message || "Failed to process campaign.");
      setMessage({ type: "error", text: err.message || "Failed to process campaign." });
    } finally {
      setReviewConfirming(false);
      setBusy(false);
    }
  }

  // Open schedule modal for draft campaign
  function handleOpenScheduleModal(camp: Campaign) {
    setTargetDraftCampaign(camp);
    const nextHour = new Date(Date.now() + 60 * 60 * 1000);
    const p = getKarachiParts(nextHour);
    setDraftScheduleDate(p.date);
    setDraftScheduleTime(p.time);
    setDraftScheduleIntervalSec(60);
    setDraftScheduleMailboxId(camp.mailbox?.id || mailboxes[0]?.id || "");
    setScheduleModalOpen(true);
  }

  // Confirm schedule draft send - Opens Pre-Send Review Modal
  async function handleConfirmScheduleDraft() {
    if (!targetDraftCampaign) return;
    if (!draftScheduleDate || !draftScheduleTime) {
      alert("Please select both a valid date and time.");
      return;
    }
    setSchedulingBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${targetDraftCampaign.id}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok || !data.campaign) throw new Error(data.error || "Failed to load campaign for preview.");
      const camp = data.campaign;

      const recipientsList: ReviewRecipient[] = (camp.recipients || []).map((r: any) => ({
        brandName: r.snapshotBrand || r.contact?.brandName || r.contact?.name || "Target Brand",
        brandEmail: (r.status === "SKIPPED" || (r.contact?.email && r.contact.email.includes(".invalid")))
          ? (r.snapshotEmail || "")
          : (r.snapshotEmail || r.contact?.email || ""),
        productCategory: r.productCategory || r.contact?.category || "General",
        asin: r.contact?.formUrl,
        website: r.contact?.website,
        sheetNum: r.sheetRowIndex,
      }));

      const scheduledIso = `${draftScheduleDate}T${draftScheduleTime}`;
      const mailboxObj = mailboxes.find((m) => m.id === draftScheduleMailboxId);

      setScheduleModalOpen(false);
      setReviewModalData({
        campaignTitle: camp.name,
        senderMailbox: mailboxObj?.emailAddress || camp.mailbox?.emailAddress || "Default Hostinger Mailbox",
        totalRecipients: recipientsList.length || camp.counters?.total || 1,
        sendMode: "schedule",
        scheduledTime: scheduledIso,
        delayAmount: draftScheduleIntervalSec,
        delayUnit: "seconds",
        subjectTemplate: camp.template?.subject || "Outreach Proposal",
        bodyTemplate: camp.template?.body || "Hello...",
        followUpEnabled: camp.followUpsEnabled,
        recipients: recipientsList.length ? recipientsList : [{
          brandName: "Saved Brand",
          brandEmail: "contact@example.com",
          productCategory: "General Outreach"
        }],
        onConfirmExecute: async () => {
          setReviewConfirming(true);
          try {
            const scheduleRes = await fetch(`/api/campaigns/${camp.id}/schedule`, {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                mode: "schedule",
                date: draftScheduleDate,
                time: draftScheduleTime,
                timezone: "Asia/Karachi",
                delaySeconds: draftScheduleIntervalSec,
                mailboxId: draftScheduleMailboxId || undefined,
              }),
            });
            const scheduleData = await scheduleRes.json();
            if (!scheduleRes.ok) throw new Error(scheduleData.error || "Unable to schedule campaign.");
            setReviewModalOpen(false);
            setMessage({
              type: "success",
              text: `🕒 Campaign "${camp.name}" scheduled successfully for ${draftScheduleDate} at ${draftScheduleTime}!`,
            });
            await loadInitialData();
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("mail-counts-updated"));
            }
          } catch (err: any) {
            alert(err.message || "Failed to schedule draft campaign.");
          } finally {
            setReviewConfirming(false);
          }
        }
      });
      setReviewModalOpen(true);
    } catch (err: any) {
      alert(err.message || "Failed to prepare campaign preview.");
    } finally {
      setSchedulingBusy(false);
    }
  }

  // Dispatch a saved/draft campaign to all its saved brand recipients - Opens Pre-Send Review Modal
  async function handleDispatchSavedCampaign(campaignId: string, name: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok || !data.campaign) throw new Error(data.error || "Failed to load campaign for preview.");
      
      const camp = data.campaign;
      const recipientsList: ReviewRecipient[] = (camp.recipients || []).map((r: any) => ({
        brandName: r.snapshotBrand || r.contact?.brandName || r.contact?.name || "Target Brand",
        brandEmail: (r.status === "SKIPPED" || (r.contact?.email && r.contact.email.includes(".invalid")))
          ? (r.snapshotEmail || "")
          : (r.snapshotEmail || r.contact?.email || ""),
        productCategory: r.productCategory || r.contact?.category || "General",
        asin: r.contact?.formUrl,
        website: r.contact?.website,
        sheetNum: r.sheetRowIndex,
      }));

      setReviewModalData({
        campaignTitle: camp.name,
        senderMailbox: camp.mailbox?.emailAddress || "Default Hostinger Mailbox",
        totalRecipients: recipientsList.length || camp.counters?.total || 1,
        sendMode: "sendNow",
        delayAmount: 60,
        delayUnit: "seconds",
        subjectTemplate: camp.template?.subject || "Outreach Proposal",
        bodyTemplate: camp.template?.body || "Hello...",
        followUpEnabled: camp.followUpsEnabled,
        recipients: recipientsList.length ? recipientsList : [{
          brandName: "Saved Brand",
          brandEmail: "contact@example.com",
          productCategory: "General Outreach"
        }],
        onConfirmExecute: async () => {
          setReviewConfirming(true);
          try {
            const sendRes = await fetch(`/api/campaigns/${campaignId}/schedule`, {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ mode: "sendNow" }),
            });
            const sendData = await sendRes.json();
            if (!sendRes.ok) throw new Error(sendData.error || "Unable to dispatch campaign.");
            setReviewModalOpen(false);
            setMessage({
              type: "success",
              text: `🚀 Campaign "${name}" dispatched successfully! ${sendData.queued || recipientsList.length} emails are now being sent in real time.`,
            });
            setActiveSendingBanner({
              visible: true,
              title: `⚡ Email Sending in Progress: "${name}"`,
              details: `${sendData.queued || recipientsList.length} emails dispatched to Hostinger SMTP.`,
              status: "sending",
            });
            await loadInitialData();
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("mail-counts-updated"));
            }
          } catch (err: any) {
            alert(err.message || "Failed to dispatch campaign.");
          } finally {
            setReviewConfirming(false);
          }
        }
      });
      setReviewModalOpen(true);
    } catch (err: any) {
      alert(err.message || "Failed to load campaign preview.");
    } finally {
      setBusy(false);
    }
  }

  function handleOpenEditModal(camp: Campaign) {
    setTargetEditCampaign(camp);
    setEditName(camp.name);
    setEditDescription(camp.description || "");
    setEditMailboxId(camp.mailbox?.id || (mailboxes[0]?.id || ""));
    setEditTemplateId(camp.template?.id || (templates[0]?.id || ""));
    setEditDelaySeconds(60);
    setEditSheetUrl(camp.sheetUrl || "");
    setEditSheetWebhookUrl(camp.sheetWebhookUrl || "");
    setEditModalOpen(true);
  }

  async function handleSaveEditedCampaign(e: React.FormEvent) {
    e.preventDefault();
    if (!targetEditCampaign) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${targetEditCampaign.id}`, {
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
      setMessage({
        type: "success",
        text: `✓ Campaign "${editName}" updated successfully! Settings applied to all remaining emails.`,
      });
      setEditModalOpen(false);
      await loadInitialData();
    } catch (err: any) {
      alert(err.message || "Failed to save edits.");
    } finally {
      setEditSaving(false);
    }
  }

  // Delete campaign (supports draft, running, paused, and completed campaigns)
  async function handleDeleteCampaign(campaignId: string, name: string, status?: string) {
    const isRunning = status && ["SCHEDULED", "SENDING", "ACTIVE", "PAUSED"].includes(status);
    const promptMsg = isRunning
      ? `Delete in-progress campaign "${name}"?\n\nThis will immediately STOP all remaining unsent emails and remove the campaign.`
      : `Delete campaign "${name}"?`;
    if (!confirm(promptMsg)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to delete campaign.");
      setMessage({
        type: "success",
        text: `🗑️ Campaign "${name}" deleted successfully.`,
      });
      await loadInitialData();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Failed to delete campaign." });
    } finally {
      setBusy(false);
    }
  }

  // Preview row calculation
  const currentPreview = selectedRows[previewRowIndex] || selectedRows[0];
  const renderedSubject = currentPreview
    ? renderTemplate(subject, {
        brandName: currentPreview.brandName,
        productCategory: currentPreview.productCategory,
        email: currentPreview.brandEmail,
        website: currentPreview.website,
        asin: currentPreview.asin,
        amazonLink: currentPreview.amazonLink,
        sheetNum: currentPreview.sheetNum,
        num: currentPreview.sheetNum,
      })
    : subject;
  const renderedBody = currentPreview
    ? renderTemplate(body, {
        brandName: currentPreview.brandName,
        productCategory: currentPreview.productCategory,
        email: currentPreview.brandEmail,
        website: currentPreview.website,
        asin: currentPreview.asin,
        amazonLink: currentPreview.amazonLink,
        sheetNum: currentPreview.sheetNum,
        num: currentPreview.sheetNum,
      })
    : body;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
      {/* Real-time Email Sending Status Indicator */}
      {activeSendingBanner && (
        <div
          className={`p-4 rounded-2xl border shadow-sm transition-all flex items-center justify-between gap-4 ${
            activeSendingBanner.status === "sending"
              ? "bg-purple-50/90 border-purple-200 text-purple-950"
              : "bg-emerald-50/90 border-emerald-200 text-emerald-950"
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="relative flex h-3.5 w-3.5 shrink-0">
              {activeSendingBanner.status === "sending" && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex rounded-full h-3.5 w-3.5 ${
                  activeSendingBanner.status === "sending" ? "bg-[#673DE6]" : "bg-emerald-500"
                }`}
              ></span>
            </span>
            <div>
              <p className="text-xs sm:text-sm font-bold flex items-center gap-2">
                {activeSendingBanner.title}
                {activeSendingBanner.status === "sending" && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#673DE6] text-white">
                    <span className="animate-spin inline-block h-2.5 w-2.5 border-2 border-white border-t-transparent rounded-full"></span>
                    Sending Active
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">{activeSendingBanner.details}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeSendingBanner.status === "sending" && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (!confirm("Emergency Stop: Immediately freeze/pause all active email sending?")) return;
                  setBusy(true);
                  try {
                    const res = await fetch("/api/campaigns/emergency-stop", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "pause" }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Failed to stop");
                    setMessage({
                      type: "success",
                      text: `🛑 Emergency Stop Applied! ${data.pausedCampaignsCount || 0} active campaign(s) safely PAUSED.`,
                    });
                    setActiveSendingBanner(null);
                    await loadInitialData();
                    if (typeof window !== "undefined") {
                      window.dispatchEvent(new CustomEvent("mail-counts-updated"));
                    }
                  } catch (err: any) {
                    alert(err.message || "Failed to stop.");
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-xl bg-red-600 hover:bg-red-700 text-white px-3.5 py-1.5 text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <span>🛑</span>
                <span>STOP SENDING</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveSendingBanner(null)}
              className="text-gray-400 hover:text-gray-700 text-xs px-2 py-1 rounded-md cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Top Banner / Tab Switcher */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Campaigns & Excel Outreach</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Upload an Excel sheet, select a row range (e.g., rows 10 to 20), and dispatch spaced outreach in one click.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab("excel")}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition ${
              activeTab === "excel" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            📊 Excel / CSV Campaign
          </button>
          <button
            onClick={() => setActiveTab("list")}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition ${
              activeTab === "list" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            📋 All Campaigns ({campaigns.length})
          </button>
        </div>
      </div>

      {/* Notifications */}
      {message && (
        <div
          className={`rounded-2xl p-4 text-xs sm:text-sm font-medium ${
            message.type === "success"
              ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
              : "bg-red-50 border border-red-200 text-red-800"
          }`}
        >
          {message.text}
        </div>
      )}

      {activeTab === "excel" ? (
        <div className="space-y-6">
          {/* Step 1: Upload Excel File or Import Google Sheet */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#673DE6]/10 text-[#673DE6] font-bold text-xs flex items-center justify-center">
                  1
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">
                    {sourceMode === "manual"
                      ? "Manual Email / Brand Outreach Entry"
                      : sourceMode === "googlesheet"
                      ? "Import from Google Sheets (Cloud Sync)"
                      : "Upload Excel / CSV Sheet"}
                  </h2>
                  <p className="text-xs text-gray-500">
                    {sourceMode === "manual"
                      ? "Add email recipients manually or bulk paste emails directly"
                      : sourceMode === "googlesheet"
                      ? "Paste a Google Sheet URL to fetch brand outreach contacts directly"
                      : "Supports .xlsx, .xls, and .csv with columns for Brand Name, Brand Email, and Product Category"}
                  </p>
                </div>
              </div>

              {fileName && (
                <span className="text-xs font-semibold px-3 py-1 bg-purple-50 text-[#673DE6] rounded-full border border-purple-100">
                  {sourceMode === "manual" ? "✍️" : sourceMode === "googlesheet" ? "🌐" : "📁"} {fileName}
                </span>
              )}
            </div>

            {/* Source Switcher Pills */}
            <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
              <button
                type="button"
                onClick={() => setSourceMode("file")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
                  sourceMode === "file"
                    ? "bg-[#673DE6] text-white shadow-xs"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <span>📁</span> Upload Excel / CSV File
              </button>
              <button
                type="button"
                onClick={() => setSourceMode("googlesheet")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
                  sourceMode === "googlesheet"
                    ? "bg-[#673DE6] text-white shadow-xs"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <span>🌐</span> Google Sheet Link (Plugin)
              </button>
              <button
                type="button"
                onClick={() => setSourceMode("manual")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
                  sourceMode === "manual"
                    ? "bg-[#673DE6] text-white shadow-xs"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <span>✍️</span> Manual Email Entry
              </button>
            </div>

            {sourceMode === "manual" ? (
              <div className="space-y-4">
                <div className="bg-purple-50/40 border border-purple-100 rounded-xl p-4 text-xs text-gray-700 space-y-2">
                  <div className="flex items-center gap-2 text-purple-900 font-bold text-sm">
                    <span>✍️</span>
                    <span>Direct Brand &amp; Email Recipient Manager</span>
                  </div>
                  <p className="text-gray-600 leading-relaxed">
                    Add email addresses manually one by one or paste a list of emails directly. No spreadsheet required.
                  </p>
                </div>

                {/* Submode toggle */}
                <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-xl w-fit text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setManualInputMode("single")}
                    className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      manualInputMode === "single"
                        ? "bg-white text-gray-900 shadow-2xs font-bold"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    <span>➕</span> Single Email Entry
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualInputMode("bulk")}
                    className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      manualInputMode === "bulk"
                        ? "bg-white text-gray-900 shadow-2xs font-bold"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    <span>📋</span> Bulk Paste Emails
                  </button>
                </div>

                {manualInputMode === "single" ? (
                  <form onSubmit={handleAddSingleManualEmail} className="space-y-3 bg-gray-50/60 p-4 rounded-xl border border-gray-200">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1">
                          Email Address <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="email"
                          required
                          value={manualEmail}
                          onChange={(e) => setManualEmail(e.target.value)}
                          placeholder="e.g. founder@brand.com"
                          className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1">
                          Brand Name <span className="text-gray-400 font-normal">(Optional)</span>
                        </label>
                        <input
                          type="text"
                          value={manualBrandName}
                          onChange={(e) => setManualBrandName(e.target.value)}
                          placeholder="e.g. Acme Corp"
                          className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1">
                          Product Category <span className="text-gray-400 font-normal">(Optional)</span>
                        </label>
                        <input
                          type="text"
                          value={manualCategory}
                          onChange={(e) => setManualCategory(e.target.value)}
                          placeholder="e.g. Electronics, Beauty"
                          className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1">
                          Website / Amazon Link <span className="text-gray-400 font-normal">(Optional)</span>
                        </label>
                        <input
                          type="text"
                          value={manualWebsite}
                          onChange={(e) => setManualWebsite(e.target.value)}
                          placeholder="https://brand.com"
                          className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-1">
                      <p className="text-[11px] text-gray-500">
                        Brand name will be used in <code className="text-[#673DE6] font-mono">{"{{brandName}}"}</code> email template variable.
                      </p>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-[#673DE6] hover:bg-[#5025D1] text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>➕</span> Add to Campaign List
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleAddBulkManualEmails} className="space-y-3 bg-gray-50/60 p-4 rounded-xl border border-gray-200">
                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 mb-1">
                        Paste Multiple Emails <span className="text-red-500">*</span>
                      </label>
                      <p className="text-[11px] text-gray-500 mb-2">
                        Paste one per line, or comma-separated: <code className="text-[#673DE6] font-mono">Brand Name, email@domain.com, Category</code> or just plain emails.
                      </p>
                      <textarea
                        rows={5}
                        required
                        value={manualBulkText}
                        onChange={(e) => setManualBulkText(e.target.value)}
                        placeholder={"contact@brandone.com\nAcme Brand, acme@example.com, Electronics\nfounder@coolstore.com"}
                        className="w-full px-3.5 py-2.5 text-xs font-mono border border-gray-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        className="px-4 py-2 bg-[#673DE6] hover:bg-[#5025D1] text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>📥</span> Parse &amp; Add Emails
                      </button>
                    </div>
                  </form>
                )}

                {allParsedRows.length > 0 && (
                  <div className="flex items-center justify-between p-3 bg-purple-50 rounded-xl border border-purple-100">
                    <div className="flex items-center gap-2 text-xs text-purple-900 font-semibold">
                      <span>✓</span>
                      <span>{allParsedRows.length} total recipients ready in list</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearAllParsedRows}
                      className="text-xs text-red-600 hover:text-red-800 font-medium hover:underline cursor-pointer"
                    >
                      Clear List
                    </button>
                  </div>
                )}
              </div>
            ) : sourceMode === "googlesheet" ? (
              <div className="space-y-4">
                <div className="bg-purple-50/40 border border-purple-100 rounded-xl p-4 text-xs text-gray-700 space-y-2">
                  <div className="flex items-center gap-2 text-purple-900 font-bold text-sm">
                    <span>⚡</span>
                    <span>Google Sheets Real-Time Cloud Importer</span>
                  </div>
                  <p className="text-gray-600 leading-relaxed">
                    Paste any Google Sheet link below. The system automatically reads and maps your sheet headers (e.g. <strong>Brand Name</strong>, <strong>Brand Email</strong>, <strong>Category</strong>, <strong>Website</strong>) and pulls the data directly into your outreach campaign.
                  </p>
                  <p className="text-[11px] text-purple-700 font-medium">
                    💡 Tip: Make sure your Google Sheet is shared as <strong>&ldquo;Anyone with the link can view&rdquo;</strong> (File &rarr; Share &rarr; General access &rarr; Anyone with the link).
                  </p>
                </div>

                <form onSubmit={handleFetchGoogleSheet} className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                      Google Sheet URL <span className="text-red-500">*</span>
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="url"
                        required
                        placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0"
                        value={googleSheetUrl}
                        onChange={(e) => setGoogleSheetUrl(e.target.value)}
                        className="flex-1 px-3.5 py-2.5 text-xs border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#673DE6] focus:border-transparent bg-white shadow-2xs font-mono"
                      />
                      <button
                        type="submit"
                        disabled={googleSheetLoading}
                        className="px-5 py-2.5 bg-[#673DE6] hover:bg-[#5329cc] text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
                      >
                        {googleSheetLoading ? (
                          <>
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                            Fetching Sheet...
                          </>
                        ) : (
                          <>
                            <span>📥</span> Fetch Google Sheet
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Real-Time Row Range Selection (Optional) */}
                  <div className="rounded-xl border border-purple-100 bg-purple-50/40 p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-purple-100/70 pb-2.5">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                            Row Selection
                          </span>
                          <span className="text-[10px] font-semibold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                            Optional (100% Real-Time)
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          Leave blank to import all rows, or specify start &amp; end rows (e.g. Row 1 to Row 25).
                        </p>
                      </div>

                      {allParsedRows.length > 0 && (
                        <div className="flex items-center gap-2 bg-[#673DE6] text-white px-3 py-1 rounded-full text-xs font-semibold shadow-2xs">
                          <span>✓ Active: Rows {fromRow} to {toRow}</span>
                          <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px]">
                            {selectedRows.length} Brands
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1">
                          Start Row # <span className="text-gray-400 font-normal">(Optional)</span>
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={allParsedRows.length > 0 ? allParsedRows.length : undefined}
                          value={sheetStartRowInput}
                          onChange={(e) => handleStartRowChange(e.target.value)}
                          placeholder="e.g. 1 (Default: start from row 1)"
                          className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6] font-semibold text-gray-900 shadow-2xs"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1">
                          End Row # <span className="text-gray-400 font-normal">(Optional)</span>
                        </label>
                        <input
                          type="number"
                          min={fromRow}
                          max={allParsedRows.length > 0 ? allParsedRows.length : undefined}
                          value={sheetEndRowInput}
                          onChange={(e) => handleEndRowChange(e.target.value)}
                          placeholder={
                            allParsedRows.length > 0
                              ? `e.g. ${allParsedRows.length} (Default: row ${allParsedRows.length})`
                              : "e.g. 25 (Default: all rows to end)"
                          }
                          className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6] font-semibold text-gray-900 shadow-2xs"
                        />
                      </div>
                    </div>

                    {allParsedRows.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                        <span className="text-[11px] font-semibold text-gray-500 mr-1">Quick Select:</span>
                        <button
                          type="button"
                          onClick={() => {
                            setFromRow(1);
                            setToRow(allParsedRows.length);
                            setSheetStartRowInput("1");
                            setSheetEndRowInput(String(allParsedRows.length));
                          }}
                          className="px-2.5 py-1 rounded-lg bg-purple-100 text-[#673DE6] font-semibold hover:bg-purple-200 text-xs transition"
                        >
                          🌟 All Rows (1 - {allParsedRows.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFromRow(1);
                            const to = Math.min(25, allParsedRows.length);
                            setToRow(to);
                            setSheetStartRowInput("1");
                            setSheetEndRowInput(String(to));
                          }}
                          className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs font-semibold transition"
                        >
                          Rows 1 - 25
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const start = Math.min(10, allParsedRows.length);
                            const to = Math.min(20, allParsedRows.length);
                            setFromRow(start);
                            setToRow(to);
                            setSheetStartRowInput(String(start));
                            setSheetEndRowInput(String(to));
                          }}
                          className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs font-semibold transition"
                        >
                          Rows 10 - 20
                        </button>
                        {(sheetStartRowInput || sheetEndRowInput) && (
                          <button
                            type="button"
                            onClick={() => {
                              setSheetStartRowInput("");
                              setSheetEndRowInput("");
                              setFromRow(1);
                              setToRow(allParsedRows.length);
                            }}
                            className="px-2 py-1 text-gray-500 hover:text-gray-800 text-[11px] underline ml-auto font-medium"
                          >
                            Reset to All Rows
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="text-gray-400 text-[11px]">
                      Need a sample test sheet?
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const demoUrl = "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0";
                        setGoogleSheetUrl(demoUrl);
                      }}
                      className="text-[#673DE6] hover:underline font-semibold text-[11px]"
                    >
                      Paste Sample Google Sheet Link
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="border-2 border-dashed border-gray-200 hover:border-[#673DE6] rounded-2xl p-8 text-center transition cursor-pointer bg-gray-50/50 hover:bg-white relative">
                <input
                  type="file"
                  accept=".xlsx, .xls, .csv, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex flex-col items-center">
                  <span className="text-3xl mb-2">📑</span>
                  <p className="text-sm font-semibold text-gray-800">
                    Click to browse or drag & drop your Excel (.xlsx) or CSV file
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    System will automatically detect Brand Name, Brand Email, and Category
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* Step 2: Row Range Selector (e.g. 10 se 20) */}
          {allParsedRows.length > 0 && (
            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#673DE6]/10 text-[#673DE6] font-bold text-xs flex items-center justify-center">
                    2
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-gray-900">Select Row Range (Start and End Rows)</h2>
                    <p className="text-xs text-gray-500">
                      Total {allParsedRows.length} rows loaded. Specify which rows to send emails to.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSourceMode("manual");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="bg-purple-100 hover:bg-purple-200 text-[#673DE6] px-3.5 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>➕</span> Add Manual Email
                  </button>
                  <div className="bg-[#673DE6] text-white px-3.5 py-1.5 rounded-full text-xs font-semibold shadow-xs">
                    ✓ Selected: {selectedRows.length} Brands (Rows {fromRow} to {toRow})
                  </div>
                  <button
                    type="button"
                    disabled={busy || !selectedRows.length}
                    onClick={handleSaveCampaignOnly}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded-full text-xs font-bold shadow-xs transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    <span>💾</span> Save Campaign
                  </button>
                </div>
              </div>

              {/* Quality & Lead Categorization Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-700 flex items-center justify-center font-bold text-sm">
                    ✓
                  </div>
                  <div>
                    <div className="text-xs font-bold text-emerald-900">
                      {allParsedRows.filter((r) => r.quality === "COMPLETE").length} Complete Leads
                    </div>
                    <div className="text-[11px] text-emerald-700">
                      Brand + Email + Category (Sorted First)
                    </div>
                  </div>
                </div>

                <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-700 flex items-center justify-center font-bold text-sm">
                    ⚠️
                  </div>
                  <div>
                    <div className="text-xs font-bold text-amber-900">
                      {allParsedRows.filter((r) => r.quality === "INCOMPLETE").length} Missing Category
                    </div>
                    <div className="text-[11px] text-amber-700">
                      Has Email &amp; Brand (Sorted Middle)
                    </div>
                  </div>
                </div>

                <div className="bg-red-50/70 border border-red-200/80 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-500/10 text-red-700 flex items-center justify-center font-bold text-sm">
                    🚫
                  </div>
                  <div>
                    <div className="text-xs font-bold text-red-900">
                      {allParsedRows.filter((r) => r.quality === "NO_EMAIL").length} Missing Email
                    </div>
                    <div className="text-[11px] text-red-700">
                      Moved to End of List (Option 1)
                    </div>
                  </div>
                </div>
              </div>

              {/* Collapsible View of Excluded Rows (No Email) */}
              {showExcludedRows && skippedNoEmailRows.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50/40 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-red-900 flex items-center gap-1.5">
                      <span>🚫</span> Excluded Rows ({skippedNoEmailRows.length} rows missing valid email)
                    </span>
                    <span className="text-[11px] text-red-600">
                      These rows were automatically separated out and will NOT receive emails.
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-48 rounded-lg border border-red-200 bg-white">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-red-50 text-red-800 font-semibold border-b border-red-100 sticky top-0">
                        <tr>
                          <th className="p-2">Sheet Num #</th>
                          <th className="p-2">ASIN</th>
                          <th className="p-2">Brand / Product</th>
                          <th className="p-2">Status / Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-red-100">
                        {skippedNoEmailRows.map((sr, idx) => (
                          <tr key={idx} className="hover:bg-red-50/30">
                            <td className="p-2 text-gray-500 font-mono font-bold">
                              #{sr.sheetNum || sr.originalIndex}
                            </td>
                            <td className="p-2 font-mono text-purple-700">
                              {sr.asin ? (
                                <span className="bg-purple-50 px-1.5 py-0.5 rounded text-[11px] border border-purple-100">
                                  {sr.asin}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="p-2 font-medium text-gray-800">{sr.brandName}</td>
                            <td className="p-2 text-red-600 font-medium">⚠️ {sr.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Campaign Name Field */}
              <div className="bg-purple-50/50 rounded-xl border border-purple-100 p-4">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-gray-800 uppercase tracking-wide">
                    Campaign Name <span className="text-gray-400 font-normal lowercase">(optional)</span>
                  </label>
                  {!campaignName.trim() && (
                    <span className="text-[11px] font-semibold text-[#673DE6] bg-purple-100/70 px-2.5 py-0.5 rounded-md">
                      Auto-default: {getAutoCampaignDateName(campaigns)}
                    </span>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    placeholder={`e.g. Chocolates Outreach or leave blank for "${getAutoCampaignDateName(campaigns)}"`}
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-gray-900 focus:border-[#673DE6] focus:outline-none shadow-2xs"
                  />
                  {campaignName && (
                    <button
                      type="button"
                      onClick={() => setCampaignName("")}
                      className="px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-800 bg-white hover:bg-gray-100 border border-gray-200 rounded-xl transition shadow-2xs"
                    >
                      Clear to use Date
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy || !selectedRows.length}
                    onClick={handleSaveCampaignOnly}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
                  >
                    {busy ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-1.5 h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        Saving...
                      </>
                    ) : (
                      <>
                        <span>💾</span> Save Campaign
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1.5">
                  If left blank, this campaign will automatically be saved using today&apos;s date (<strong>{getAutoCampaignDateName(campaigns)}</strong>).
                </p>
              </div>

              {/* Range Inputs & Quick Select Presets */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Start Row # (Data Row)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={allParsedRows.length}
                      value={fromRow}
                      onChange={(e) => {
                        const val = Math.max(1, parseInt(e.target.value) || 1);
                        setFromRow(val);
                        setSheetStartRowInput(String(val));
                      }}
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2 text-sm font-bold text-gray-900 focus:border-[#673DE6] focus:outline-none"
                      placeholder="e.g. 1"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      End Row # (Data Row)
                    </label>
                    <input
                      type="number"
                      min={fromRow}
                      max={allParsedRows.length}
                      value={toRow}
                      onChange={(e) => {
                        const val = Math.min(allParsedRows.length, parseInt(e.target.value) || fromRow);
                        setToRow(val);
                        setSheetEndRowInput(String(val));
                      }}
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2 text-sm font-bold text-gray-900 focus:border-[#673DE6] focus:outline-none"
                      placeholder="e.g. 25"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Quick Select Presets
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFromRow(1);
                          setToRow(allParsedRows.length);
                          setSheetStartRowInput("1");
                          setSheetEndRowInput(String(allParsedRows.length));
                        }}
                        className="px-3 py-1.5 rounded-lg border border-purple-200 bg-purple-50 text-xs font-semibold text-[#673DE6] hover:bg-purple-100 shadow-2xs"
                        title={`Select all available rows: 1 to ${allParsedRows.length}`}
                      >
                        🌟 All Rows (1 - {allParsedRows.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFromRow(1);
                          const to = Math.min(25, allParsedRows.length);
                          setToRow(to);
                          setSheetStartRowInput("1");
                          setSheetEndRowInput(String(to));
                        }}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold hover:bg-gray-50 text-gray-700"
                        title="Select exactly rows 1 through 25 (25 rows)"
                      >
                        Rows 1 – 25
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const start = Math.min(10, allParsedRows.length);
                          const to = Math.min(20, allParsedRows.length);
                          setFromRow(start);
                          setToRow(to);
                          setSheetStartRowInput(String(start));
                          setSheetEndRowInput(String(to));
                        }}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold hover:bg-gray-50 text-gray-700"
                        title="Select exactly rows 10 through 20 (11 rows)"
                      >
                        Rows 10 – 20
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const start = Math.min(51, allParsedRows.length);
                          const to = Math.min(60, allParsedRows.length);
                          setFromRow(start);
                          setToRow(to);
                          setSheetStartRowInput(String(start));
                          setSheetEndRowInput(String(to));
                        }}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold hover:bg-gray-50 text-gray-700"
                        title="Select exactly rows 51 through 60 (10 rows)"
                      >
                        Rows 51 – 60
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFromRow(1);
                          setToRow(allParsedRows.length);
                          setSheetStartRowInput("1");
                          setSheetEndRowInput(String(allParsedRows.length));
                        }}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 bg-gray-50 text-xs font-semibold hover:bg-gray-100 text-gray-700"
                        title="Reset selection to all rows"
                      >
                        ↺ Reset to All Rows
                      </button>
                    </div>
                  </div>
                </div>

                {/* Section 7: Required Selection & Lead Validation Card */}
                <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-200/60 pb-3">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#673DE6]">
                        Selected Range Validation Breakdown
                      </span>
                      <h4 className="text-sm font-bold text-gray-900 mt-0.5">
                        Selected Rows: {fromRow}–{toRow}
                        <span className="text-xs text-gray-500 font-normal ml-2">
                          (Spreadsheet Lines {fromRow + 1}–{toRow + 1})
                        </span>
                      </h4>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-gray-600 font-medium">Total Selected Rows:</span>{" "}
                      <span className="text-lg font-extrabold text-[#673DE6]">
                        {selectionBreakdown.total}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                    <div className="rounded-lg bg-white border border-emerald-200 p-2.5 shadow-2xs">
                      <p className="text-[11px] font-bold uppercase text-emerald-700">Complete Leads</p>
                      <p className="text-2xl font-extrabold text-emerald-700 mt-0.5">
                        {selectionBreakdown.completeCount}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Valid email, brand &amp; category</p>
                    </div>

                    <div className="rounded-lg bg-white border border-red-200 p-2.5 shadow-2xs">
                      <p className="text-[11px] font-bold uppercase text-red-600">Missing Email</p>
                      <p className="text-2xl font-extrabold text-red-600 mt-0.5">
                        {selectionBreakdown.missingEmailCount}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Kept in place (skipped from send)</p>
                    </div>

                    <div className="rounded-lg bg-white border border-amber-200 p-2.5 shadow-2xs">
                      <p className="text-[11px] font-bold uppercase text-amber-600">Missing Brand</p>
                      <p className="text-2xl font-extrabold text-amber-600 mt-0.5">
                        {selectionBreakdown.missingBrandCount}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Using placeholder brand name</p>
                    </div>

                    <div className="rounded-lg bg-white border border-blue-200 p-2.5 shadow-2xs">
                      <p className="text-[11px] font-bold uppercase text-blue-600">Missing Category</p>
                      <p className="text-2xl font-extrabold text-blue-600 mt-0.5">
                        {selectionBreakdown.missingCategoryCount}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Using General category</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Preview Table of Chosen Rows */}
              <div className="mt-4 rounded-xl border border-gray-200 overflow-x-auto max-h-64">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 text-gray-700 font-bold border-b border-gray-200 sticky top-0">
                    <tr>
                      <th className="p-2.5">Num #</th>
                      <th className="p-2.5">ASIN</th>
                      <th className="p-2.5">Brand Name</th>
                      <th className="p-2.5">Brand Email</th>
                      <th className="p-2.5">Category</th>
                      <th className="p-2.5">Lead Status</th>
                      <th className="p-2.5">Amazon / Web Link</th>
                      <th className="p-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {selectedRows.map((r, i) => (
                      <tr
                        key={r.index}
                        onClick={() => setPreviewRowIndex(i)}
                        className={`hover:bg-purple-50/50 cursor-pointer ${
                          i === previewRowIndex ? "bg-purple-50 font-semibold" : ""
                        }`}
                      >
                        <td className="p-2.5 text-gray-700 font-mono font-bold whitespace-nowrap">
                          #{r.sheetNum || r.index}
                          {r.sheetNum && r.sheetNum !== r.index && (
                            <span className="text-[10px] text-gray-400 font-normal ml-1">
                              (Queue #{r.index})
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 font-mono text-purple-700 whitespace-nowrap">
                          {r.asin ? (
                            <span className="bg-purple-50 px-2 py-0.5 rounded border border-purple-100 font-semibold">
                              {r.asin}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="p-2.5 text-gray-900 font-medium">{r.brandName}</td>
                        <td className="p-2.5 text-gray-700 font-mono">
                          {r.brandEmail ? (
                            r.brandEmail
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-600 border border-red-200">
                              ⚠️ Missing Email
                            </span>
                          )}
                        </td>
                        <td className="p-2.5">
                          {r.productCategory === "Missing Category" ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              ⚠️ Missing Category
                            </span>
                          ) : (
                            <span className="text-purple-700 font-medium">{r.productCategory || "—"}</span>
                          )}
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          {r.quality === "COMPLETE" ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              ✓ Complete
                            </span>
                          ) : r.quality === "NO_EMAIL" ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                              ⚠️ Missing Email
                            </span>
                          ) : r.quality === "NO_BRAND" ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              ⚠️ Missing Brand
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                              ⚠️ Missing Category
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 text-gray-500 whitespace-nowrap">
                          {r.amazonLink || r.website ? (
                            <a
                              href={r.amazonLink || r.website}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#673DE6] hover:underline font-medium truncate max-w-[150px] inline-block"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {r.amazonLink ? "Amazon ↗" : "Link ↗"}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveParsedRow(r.index - 1);
                            }}
                            className="p-1 text-gray-400 hover:text-red-600 rounded hover:bg-red-50 transition cursor-pointer"
                            title="Remove from list"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bottom Action Footer for Step 2 */}
              <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 bg-purple-50/60 border border-purple-100 rounded-xl p-3.5">
                <div className="text-xs text-gray-700">
                  <span className="font-bold text-gray-900">{selectedRows.length} Brands selected</span>{" "}
                  ({selectedRows.filter((r) => r.brandEmail).length} with email,{" "}
                  <span className="text-red-600 font-semibold">{selectedRows.filter((r) => !r.brandEmail).length} without email</span>)
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy || !selectedRows.length}
                    onClick={handleSaveCampaignOnly}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {busy ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-1 h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        Saving...
                      </>
                    ) : (
                      <>
                        <span>💾</span> Save Campaign ({campaignName.trim() || getAutoCampaignDateName(campaigns)})
                      </>
                    )}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Step 3: Sender, Template & Dynamic Variables */}
          {allParsedRows.length > 0 && (
            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-5">
              <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
                <div className="w-8 h-8 rounded-full bg-[#673DE6]/10 text-[#673DE6] font-bold text-xs flex items-center justify-center">
                  3
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Email Template & Auto-Replace Variables</h2>
                  <p className="text-xs text-gray-500">
                    Brand Name and Product Category will be dynamically populated into template variables.
                  </p>
                </div>
              </div>

              {/* Easy Hostinger Sender Mailbox Selector with Real-Time Switch & User Isolation */}
              <div className="rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50/50 via-white to-indigo-50/30 p-5 space-y-4 shadow-xs">
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 border-b border-purple-100/80 pb-3.5">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold text-gray-900 flex items-center gap-1.5">
                        <span>✉️</span> Sender Hostinger Mailbox
                      </span>
                      <span className="text-[10px] font-bold text-[#673DE6] bg-purple-100 px-2.5 py-0.5 rounded-full">
                        {mailboxes.length} {mailboxes.length === 1 ? "Mailbox" : "Mailboxes"} Connected
                      </span>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Live Real-Time
                      </span>
                      {currentUser && (
                        <span className="text-[10px] font-semibold text-gray-600 bg-white border border-gray-200 px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-2xs" title="Access strictly isolated to your user account">
                          <span>👤</span>
                          <span className="font-bold text-gray-800">{currentUser.name || currentUser.email}</span>
                          <span className="text-gray-400 font-normal">• Isolated Access</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      Select which Hostinger email account will dispatch this campaign. You can switch, test, or update credentials in real time:
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end lg:self-auto">
                    <button
                      type="button"
                      disabled={mailboxRefreshing}
                      onClick={() => void fetchMailboxesOnly(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
                      title="Sync and refresh mailbox connection status from Hostinger in real time"
                    >
                      <span className={`text-xs ${mailboxRefreshing ? "animate-spin" : ""}`}>🔄</span>
                      <span>{mailboxRefreshing ? "Refreshing..." : "Refresh Status"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenAddMailboxModal}
                      className="px-3.5 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] rounded-xl shadow-xs hover:shadow-md transition flex items-center gap-1.5 cursor-pointer"
                      title="Connect an additional Hostinger email account"
                    >
                      <span>➕</span>
                      <span>Connect Hostinger Mail</span>
                    </button>
                  </div>
                </div>

                {/* Real-time Notification Toast */}
                {mailboxNotification && (
                  <div
                    className={`p-3 rounded-xl text-xs font-medium flex items-center justify-between gap-2 border animate-in fade-in duration-200 ${
                      mailboxNotification.type === "success"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : mailboxNotification.type === "error"
                        ? "bg-rose-50 text-rose-800 border-rose-200"
                        : "bg-blue-50 text-blue-800 border-blue-200"
                    }`}
                  >
                    <span>{mailboxNotification.text}</span>
                    <button
                      type="button"
                      onClick={() => setMailboxNotification(null)}
                      className="text-gray-400 hover:text-gray-600 font-bold px-1"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* Active Sender Confirmation Banner */}
                {mailboxId && (
                  <div className="p-2.5 rounded-xl bg-purple-50/70 border border-purple-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-gray-700 font-medium">Selected Active Dispatch Sender:</span>
                      <strong className="font-mono text-gray-900 font-bold">
                        {(() => {
                          const mb = mailboxes.find((m) => m.id === mailboxId);
                          return mb ? `${mb.displayName ? `[${mb.displayName}] ` : ""}${mb.emailAddress}` : "Default Mailbox";
                        })()}
                      </strong>
                    </div>
                    {(() => {
                      const mb = mailboxes.find((m) => m.id === mailboxId);
                      const isConn = mb && mb.status === "ACTIVE" && mb.smtpStatus === "CONNECTED";
                      return isConn ? (
                        <span className="text-[11px] font-bold text-emerald-700 bg-white border border-emerald-300 px-2.5 py-0.5 rounded-full">
                          ✓ Verified &amp; Ready for Delivery
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold text-rose-700 bg-white border border-rose-300 px-2.5 py-0.5 rounded-full">
                          ⚠️ Needs Authentication Fix
                        </span>
                      );
                    })()}
                  </div>
                )}

                {mailboxes.length === 0 ? (
                  <div className="text-xs text-amber-800 bg-amber-50 p-4 rounded-xl border border-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div>
                      <p className="font-bold">⚠️ No Hostinger mailboxes found for your account.</p>
                      <p className="text-amber-700 text-[11px] mt-0.5">Connect your Hostinger email (sales@, info@, etc.) to start sending emails.</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenAddMailboxModal}
                      className="px-3.5 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs cursor-pointer shrink-0"
                    >
                      Connect Hostinger Mail Now
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {mailboxes.map((m) => {
                      const isSelected = m.id === mailboxId;
                      const isConnected = m.status === "ACTIVE" && m.smtpStatus === "CONNECTED";
                      const isTestingThis = mailboxActionBusy === `test-${m.id}`;

                      return (
                        <div
                          key={m.id}
                          onClick={() => handleSwitchSender(m.id)}
                          className={`rounded-2xl p-4 border-2 transition-all cursor-pointer flex flex-col justify-between gap-3 relative group ${
                            isSelected
                              ? "border-[#673DE6] bg-white shadow-md ring-2 ring-[#673DE6]/20"
                              : "border-gray-200 bg-white/95 hover:border-purple-300 hover:bg-purple-50/20"
                          }`}
                        >
                          {/* Card Top: Identity & Status */}
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div
                                  className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm shrink-0 font-bold transition ${
                                    isSelected
                                      ? "bg-gradient-to-br from-[#673DE6] to-[#5025D1] text-white shadow-xs"
                                      : "bg-purple-50 text-[#673DE6] border border-purple-100"
                                  }`}
                                >
                                  ✉️
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-gray-900 truncate flex items-center gap-1.5">
                                    {m.displayName ? (
                                      <>
                                        <span className="text-purple-700 font-extrabold truncate">{m.displayName}</span>
                                        <span className="font-mono text-gray-400 text-[11px] font-normal truncate">({m.emailAddress})</span>
                                      </>
                                    ) : (
                                      <span className="font-mono truncate">{m.emailAddress}</span>
                                    )}
                                  </p>
                                  <p className="text-[10px] text-gray-500 truncate mt-0.5">
                                    Header: <span className="font-semibold text-gray-700">{m.displayName ? `"${m.displayName}" <${m.emailAddress}>` : m.emailAddress}</span>
                                  </p>
                                </div>
                              </div>

                              <span
                                className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                  isConnected
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : m.status === "ERROR" || m.smtpStatus === "FAILED"
                                    ? "bg-rose-50 text-rose-700 border-rose-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200"
                                }`}
                              >
                                {isConnected ? "✓ Verified" : m.status === "ERROR" ? "Failed" : "Pending"}
                              </span>
                            </div>

                            {/* Error Details snippet if connection is broken */}
                            {m.lastError && !isConnected && (
                              <div className="p-2 rounded-lg bg-rose-50/90 border border-rose-200 text-[10px] text-rose-800 leading-snug">
                                <span className="font-bold">Error:</span> {m.lastError.length > 85 ? `${m.lastError.slice(0, 85)}...` : m.lastError}
                              </div>
                            )}

                            {isConnected && (
                              <div className="text-[10px] text-gray-400 font-mono">
                                Hostinger: 465 (SMTP) / 993 (IMAP)
                              </div>
                            )}
                          </div>

                          {/* Card Bottom: Selection Pill & Quick Actions */}
                          <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-gray-100">
                            <span
                              className={`text-[10px] font-bold px-2.5 py-1 rounded-lg transition ${
                                isSelected
                                  ? "bg-[#673DE6] text-white shadow-2xs"
                                  : isConnected
                                  ? "text-purple-700 hover:text-purple-900 font-semibold"
                                  : "text-rose-600 font-semibold"
                              }`}
                            >
                              {isSelected ? "● Selected Active" : isConnected ? "Click to Switch ➔" : "⚠️ Needs Fix"}
                            </span>

                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                disabled={isTestingThis}
                                onClick={(e) => void handleTestMailboxConnection(m.id, e)}
                                className="px-2 py-1 text-[10px] font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                title="Test SMTP/IMAP connection now"
                              >
                                {isTestingThis ? (
                                  <span className="animate-spin inline-block h-2.5 w-2.5 border border-purple-600 border-t-transparent rounded-full" />
                                ) : (
                                  <span>⚡ Test</span>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleOpenEditMailboxModal(m, e)}
                                className="px-2 py-1 text-[10px] font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition flex items-center gap-1 cursor-pointer"
                                title="Change Hostinger password, username, or display name"
                              >
                                <span>⚙️ Edit</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Saved Template Selector */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Saved Template (Optional)
                </label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => handleSelectTemplate(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white p-2.5 text-xs sm:text-sm text-gray-800 focus:border-[#673DE6] focus:outline-none"
                >
                  <option value="">Custom template / write below</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.isDefault ? "★ (Active Template)" : ""} - {t.subject}
                    </option>
                  ))}
                </select>
              </div>

              {/* Clickable Variable Tags */}
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-1.5">
                  Click to insert dynamic tags (Auto-replace values):
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => insertVariable("brandName")}
                    className="rounded-lg bg-purple-50 border border-purple-200 px-2.5 py-1 text-xs font-semibold text-[#673DE6] hover:bg-purple-100 transition"
                  >
                    + {"{{brandName}}"}
                  </button>
                  <button
                    type="button"
                    onClick={() => insertVariable("asin")}
                    className="rounded-lg bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition"
                  >
                    + {"{{asin}}"}
                  </button>
                  <button
                    type="button"
                    onClick={() => insertVariable("amazonLink")}
                    className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition"
                  >
                    + {"{{amazonLink}}"}
                  </button>
                  <button
                    type="button"
                    onClick={() => insertVariable("productCategory")}
                    className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition"
                  >
                    + {"{{productCategory}}"}
                  </button>
                  <button
                    type="button"
                    onClick={() => insertVariable("brandEmail")}
                    className="rounded-lg bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition"
                  >
                    + {"{{brandEmail}}"}
                  </button>
                  <button
                    type="button"
                    onClick={() => insertVariable("website")}
                    className="rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100 transition"
                  >
                    + {"{{website}}"}
                  </button>
                </div>
              </div>

              {/* Editor + Live Preview Split Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
                {/* Left: Inputs */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Subject</label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 p-2.5 text-xs sm:text-sm text-gray-900 focus:border-[#673DE6] focus:outline-none font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Email Body</label>
                    <textarea
                      rows={11}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 p-3 text-xs sm:text-sm text-gray-900 focus:border-[#673DE6] focus:outline-none leading-relaxed"
                    />
                  </div>
                </div>

                {/* Right: Real-time Live Preview */}
                <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between border-b border-gray-200 pb-2 mb-3">
                      <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                        🔍 Live Preview (Recipient View)
                      </span>
                      {currentPreview && (
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <button
                            type="button"
                            disabled={previewRowIndex <= 0}
                            onClick={() => setPreviewRowIndex((prev) => Math.max(0, prev - 1))}
                            className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"
                          >
                            ◀
                          </button>
                          <span className="font-medium text-gray-700">
                            Num #{currentPreview.sheetNum || currentPreview.index} (Queue #{currentPreview.index} of {selectedRows.length})
                          </span>
                          <button
                            type="button"
                            disabled={previewRowIndex >= selectedRows.length - 1}
                            onClick={() => setPreviewRowIndex((prev) => Math.min(selectedRows.length - 1, prev + 1))}
                            className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"
                          >
                            ▶
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-2xs space-y-3">
                      <div className="text-xs text-gray-500 space-y-1 border-b border-gray-100 pb-3">
                        <p>
                          <span className="font-semibold text-gray-800">To:</span>{" "}
                          {currentPreview?.brandEmail || "brand@example.com"}
                        </p>
                        <p>
                          <span className="font-semibold text-gray-800">Brand:</span>{" "}
                          {currentPreview?.brandName || "Sample Brand"}
                        </p>
                        {currentPreview?.asin && (
                          <p>
                            <span className="font-semibold text-gray-800">ASIN:</span>{" "}
                            <span className="font-mono text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100 text-[11px] font-semibold">
                              {currentPreview.asin}
                            </span>
                          </p>
                        )}
                        <p>
                          <span className="font-semibold text-gray-800">Category:</span>{" "}
                          <span className="text-purple-600 font-medium">
                            {currentPreview?.productCategory || "Product Category"}
                          </span>
                        </p>
                        <p className="font-bold text-gray-900 text-sm pt-1">
                          <span className="font-normal text-gray-500 text-xs">Subject: </span>
                          {renderedSubject}
                        </p>
                      </div>

                      <div
                        className="text-xs sm:text-sm text-gray-900 leading-relaxed min-h-[140px] font-sans overflow-x-auto"
                        dangerouslySetInnerHTML={{
                          __html: formatEmailBodyToHtml(renderedBody),
                        }}
                      />
                    </div>
                  </div>

                  <p className="text-[11px] text-gray-400 mt-3 text-center">
                    Values for {"{{brandName}}"}, {"{{asin}}"}, {"{{amazonLink}}"}, and {"{{productCategory}}"} are automatically dynamically replaced.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Dedicated Section: Website Form Automation */}
          {allParsedRows.length > 0 && (
            <section className="rounded-2xl border-2 border-purple-200/80 bg-white p-6 shadow-xs space-y-5 transition-all">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-indigo-600 text-white font-extrabold text-sm flex items-center justify-center shadow-xs">
                    🌐
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-extrabold text-gray-900">
                        Website Form Automation
                      </h3>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-[#673DE6] uppercase tracking-wider">
                        Integrated Multi-Channel
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">
                      Automatically fill and submit wholesale or contact forms on selected brand websites using the same campaign recipients.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Toggle Switch */}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formAutomationEnabled}
                      onChange={(e) => setFormAutomationEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#673DE6]"></div>
                    <span className="ml-2.5 text-xs font-bold text-gray-900">
                      {formAutomationEnabled ? "Automation Enabled" : "Disabled"}
                    </span>
                  </label>
                </div>
              </div>

              {formAutomationEnabled ? (
                <div className="space-y-5 animate-fade-in">
                  {/* Top Options Bar: Form Template, Scheduling Mode, Concurrency */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-purple-50/50 p-4 rounded-2xl border border-purple-100">
                    {/* 1. Select Form Template */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wide">
                        📄 Form Template
                      </label>
                      <select
                        value={selectedFormTemplateId}
                        onChange={(e) => setSelectedFormTemplateId(e.target.value)}
                        className="w-full rounded-xl border border-purple-200 bg-white p-2 text-xs font-semibold text-gray-900 focus:border-[#673DE6] focus:outline-none shadow-2xs"
                      >
                        {formTemplates.map((ft) => (
                          <option key={ft.id} value={ft.id}>
                            {ft.name} {ft.isDefault ? "★ (Default)" : ""}
                          </option>
                        ))}
                        {formTemplates.length === 0 && (
                          <option value="">Default Wholesale Application</option>
                        )}
                      </select>
                      <p className="text-[10px] text-gray-500">
                        Personalizes applicant name, company, category, and wholesale inquiry.
                      </p>
                    </div>

                    {/* 2. Form Scheduling Mode */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wide">
                        🕒 Form Scheduling Mode
                      </label>
                      <div className="space-y-1 text-xs">
                        <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-800">
                          <input
                            type="radio"
                            name="formScheduleMode"
                            checked={formScheduleMode === "SAME_TIME"}
                            onChange={() => setFormScheduleMode("SAME_TIME")}
                            className="text-[#673DE6] focus:ring-[#673DE6]"
                          />
                          <span>Email &amp; Form at Same Time</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-800">
                          <input
                            type="radio"
                            name="formScheduleMode"
                            checked={formScheduleMode === "DIFFERENT_TIME"}
                            onChange={() => setFormScheduleMode("DIFFERENT_TIME")}
                            className="text-[#673DE6] focus:ring-[#673DE6]"
                          />
                          <span>Different Scheduled Time</span>
                        </label>
                      </div>
                      {formScheduleMode === "DIFFERENT_TIME" && (
                        <div className="grid grid-cols-2 gap-1.5 pt-1">
                          <input
                            type="date"
                            value={formScheduledDate}
                            onChange={(e) => setFormScheduledDate(e.target.value)}
                            className="w-full text-[11px] p-1.5 rounded-lg border border-purple-200 bg-white"
                          />
                          <input
                            type="time"
                            value={formScheduledTime}
                            onChange={(e) => setFormScheduledTime(e.target.value)}
                            className="w-full text-[11px] p-1.5 rounded-lg border border-purple-200 bg-white"
                          />
                        </div>
                      )}
                    </div>

                    {/* 3. Concurrency & Browser Agent Status */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wide">
                        🖥️ Local Browser Agent
                      </label>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          browserAgentStatus === "READY" || browserAgentStatus === "CONNECTED"
                            ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                            : "bg-amber-100 text-amber-800 border border-amber-300"
                        }`}>
                          <span className={`w-2 h-2 rounded-full ${
                            browserAgentStatus === "READY" || browserAgentStatus === "CONNECTED" ? "bg-emerald-600 animate-pulse" : "bg-amber-500"
                          }`}></span>
                          {browserAgentStatus === "READY" ? "Agent Ready (CDP :9222)" : "Agent Offline"}
                        </span>

                        {browserAgentStatus === "OFFLINE" && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const res = await fetch("/api/browser-agent", {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({ action: "launch" }),
                                });
                                const d = await res.json();
                                if (d.success) setBrowserAgentStatus("READY");
                                else alert("Unable to launch browser automatically. Please ensure Google Chrome is installed.");
                              } catch {
                                alert("Agent check failed.");
                              }
                            }}
                            className="px-2 py-1 bg-white hover:bg-gray-100 border border-purple-200 rounded-lg text-[10px] font-bold text-[#673DE6]"
                          >
                            Launch Chrome
                          </button>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-1 text-xs">
                        <span className="text-[11px] text-gray-600 font-medium">Concurrency Limit:</span>
                        <select
                          value={formConcurrency}
                          onChange={(e) => setFormConcurrency(parseInt(e.target.value) || 2)}
                          className="rounded-lg border border-purple-200 bg-white p-1 text-xs font-bold"
                        >
                          <option value={1}>1 Tab (Gentle)</option>
                          <option value={2}>2 Tabs (Recommended)</option>
                          <option value={3}>3 Tabs (Fast)</option>
                          <option value={4}>4 Tabs</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Selected Brands Form Preparation Table */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-extrabold text-gray-800 flex items-center gap-1.5">
                        <span>🎯</span> Form Preparation for Selected Recipients ({selectedRows.length} Brands)
                      </span>
                      <span className="text-[11px] text-gray-500">
                        Inherits the exact campaign recipients. Modify target URLs or exclude brands below.
                      </span>
                    </div>

                    <div className="rounded-xl border border-gray-200 overflow-hidden shadow-2xs">
                      <div className="max-h-60 overflow-y-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-200 text-gray-500 font-bold uppercase text-[10px]">
                            <tr>
                              <th className="px-3 py-2">Brand</th>
                              <th className="px-3 py-2">Website</th>
                              <th className="px-3 py-2">Target Form URL</th>
                              <th className="px-3 py-2">Form Status</th>
                              <th className="px-3 py-2 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {selectedRows.slice(0, 50).map((row, idx) => {
                              const ovr = formOverrides[row.brandEmail] || formOverrides[row.brandName] || formOverrides[String(idx)] || {};
                              const isExcluded = Boolean(ovr.excluded);
                              const hasWeb = Boolean(row.website && row.website.trim() && !/^(n\/a|none|-)$/i.test(row.website));
                              const formUrl = ovr.targetUrl || row.asin || (hasWeb ? `${row.website.replace(/\/+$/, "")}/wholesale` : "—");

                              return (
                                <tr key={idx} className={isExcluded ? "opacity-50 bg-gray-50/80" : "hover:bg-purple-50/30"}>
                                  <td className="px-3 py-1.5 font-bold text-gray-900 whitespace-nowrap">
                                    {row.brandName || "—"}
                                  </td>
                                  <td className="px-3 py-1.5 text-gray-600 truncate max-w-[140px]" title={row.website || ""}>
                                    {hasWeb ? row.website : <span className="text-red-500 text-[10px]">Missing Web</span>}
                                  </td>
                                  <td className="px-3 py-1.5 font-mono text-[11px] text-gray-800 truncate max-w-[180px]" title={formUrl}>
                                    {formUrl}
                                  </td>
                                  <td className="px-3 py-1.5 whitespace-nowrap">
                                    {isExcluded ? (
                                      <span className="text-[10px] text-gray-500 font-bold">Excluded</span>
                                    ) : !hasWeb && !ovr.targetUrl ? (
                                      <span className="text-[10px] text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 rounded">
                                        Needs Website
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">
                                        Ready
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const key = row.brandEmail || row.brandName || String(idx);
                                        setFormOverrides((prev) => ({
                                          ...prev,
                                          [key]: { ...prev[key], excluded: !isExcluded },
                                        }));
                                      }}
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                        isExcluded
                                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                          : "bg-gray-50 text-gray-600 border-gray-200 hover:text-rose-600"
                                      }`}
                                    >
                                      {isExcluded ? "Include" : "Exclude"}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {selectedRows.length > 50 && (
                        <div className="p-2 bg-gray-50 text-center text-[11px] text-gray-500 border-t border-gray-200">
                          Showing first 50 of {selectedRows.length} recipients. Full combined table available in Pre-Send Review.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-600 flex items-center justify-between">
                  <span>
                    Website Form Automation is currently <strong>disabled</strong>. The campaign will execute email delivery only.
                  </span>
                  <button
                    type="button"
                    onClick={() => setFormAutomationEnabled(true)}
                    className="px-3 py-1 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-xs font-bold text-gray-800"
                  >
                    Enable Form Filling
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Step 4: Dispatch Options (Start Time & Time Spacing) */}
          {allParsedRows.length > 0 && (
            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-5">
              <div className="flex items-center gap-3 border-b border-gray-100 pb-3">
                <div className="w-8 h-8 rounded-full bg-[#673DE6]/10 text-[#673DE6] font-bold text-xs flex items-center justify-center">
                  4
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">
                    Schedule & Time Spacing (Start Time & Interval Delay)
                  </h3>
                  <p className="text-xs text-gray-500">
                    Configure the dispatch start time and real-time interval delay between consecutive emails.
                  </p>
                </div>
              </div>

              {/* Grid with 2 columns: Start Time & Time Difference */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                {/* Column 1: Start Time */}
                <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-3">
                  <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                    1. Sending Start Time
                  </span>

                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-gray-800">
                      <input
                        type="radio"
                        name="sendMode"
                        checked={sendMode === "sendNow"}
                        onChange={() => setSendMode("sendNow")}
                        className="text-[#673DE6] focus:ring-[#673DE6]"
                      />
                      <span>⚡ Start Immediately (Send Now)</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-gray-800">
                      <input
                        type="radio"
                        name="sendMode"
                        checked={sendMode === "schedule"}
                        onChange={() => {
                          setSendMode("schedule");
                          if (!scheduleTime) {
                            const tomorrow = new Date();
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            const p = getKarachiParts(tomorrow);
                            setScheduleTime(`${p.date}T10:00`);
                          }
                        }}
                        className="text-[#673DE6] focus:ring-[#673DE6]"
                      />
                      <span>🕒 Schedule Specific Start Date & Time</span>
                    </label>

                    {sendMode === "schedule" && (
                      <div className="pt-2 pl-6">
                        <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                          Select Start Date & Time (Asia/Karachi):
                        </label>
                        <input
                          type="datetime-local"
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 focus:border-[#673DE6] focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Column 2: Time Difference between each email */}
                <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-3">
                  <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                    2. Real-Time Delay Between Each Email
                  </span>
                  <p className="text-[11px] text-gray-500">
                    Specify the delay before sending the next email in the queue:
                  </p>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="number"
                      min={1}
                      max={3600}
                      value={delayAmount}
                      onChange={(e) => setDelayAmount(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-24 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs sm:text-sm font-bold text-gray-900 focus:border-[#673DE6] focus:outline-none"
                    />

                    <select
                      value={delayUnit}
                      onChange={(e) => setDelayUnit(e.target.value as "seconds" | "minutes")}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs sm:text-sm font-semibold text-gray-700 focus:outline-none"
                    >
                      <option value="seconds">Seconds</option>
                      <option value="minutes">Minutes</option>
                    </select>
                  </div>

                  {/* Preset chips */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {[
                      { label: "30 Sec", amount: 30, unit: "seconds" as const },
                      { label: "1 Min", amount: 1, unit: "minutes" as const },
                      { label: "2 Min", amount: 2, unit: "minutes" as const },
                      { label: "5 Min", amount: 5, unit: "minutes" as const },
                      { label: "10 Min", amount: 10, unit: "minutes" as const },
                    ].map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => {
                          setDelayAmount(chip.amount);
                          setDelayUnit(chip.unit);
                        }}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition ${
                          delayAmount === chip.amount && delayUnit === chip.unit
                            ? "bg-[#673DE6] text-white border-[#673DE6]"
                            : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
                        }`}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Real-time Schedule Calculation Banner */}
              <div className="rounded-xl bg-purple-50 border border-purple-200 p-4 text-xs space-y-1">
                <p className="font-bold text-[#673DE6] text-sm">
                  ⏱️ Real-time Staggered Schedule Calculation:
                </p>
                <p className="text-gray-800">
                  Total <span className="font-bold">{selectedRows.length} emails</span> (Rows {fromRow} to {toRow}) with <span className="font-bold">{delayAmount} {delayUnit}</span> delay between each email.
                </p>
                <p className="text-gray-600">
                  {sendMode === "schedule" && scheduleTime
                    ? `First email will send at ${new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit" }).format(new Date(scheduleTime))}, and final email will complete approximately at ${calculateEndTime(scheduleTime, selectedRows.length, delayUnit === "minutes" ? delayAmount * 60 : delayAmount)}.`
                    : `First email will dispatch immediately, consecutive emails spaced every ${delayAmount} ${delayUnit}, finishing approximately at ${calculateEndTime(new Date(), selectedRows.length, delayUnit === "minutes" ? delayAmount * 60 : delayAmount)}.`}
                </p>
              </div>

              {/* Automated Follow-up Option */}
              <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-gray-900">
                    <input
                      type="checkbox"
                      checked={followUpEnabled}
                      onChange={(e) => setFollowUpEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-[#673DE6] focus:ring-[#673DE6]"
                    />
                    <span className="flex items-center gap-1.5">
                      🔁 Enable Automated Follow-up (If recipient does not reply)
                    </span>
                  </label>

                  {followUpEnabled && (
                    <span className="text-[11px] font-bold text-[#673DE6] bg-purple-50 border border-purple-200 px-2.5 py-0.5 rounded-full self-start sm:self-auto">
                      Auto-sends after {followUpDays} {followUpDays === 1 ? "day" : "days"}
                    </span>
                  )}
                </div>

                {followUpEnabled && (
                  <div className="pt-3 border-t border-gray-200 space-y-3 animate-fade-in">
                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                        Follow-up Delay (Send follow-up if no reply after X days):
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {[1, 2, 3, 5, 7, 10, 14].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setFollowUpDays(d)}
                            className={`rounded-xl px-3 py-1.5 text-xs font-semibold border transition ${
                              followUpDays === d
                                ? "bg-[#673DE6] text-white border-[#673DE6] shadow-2xs"
                                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
                            }`}
                          >
                            {d} {d === 1 ? "Day" : "Days"} {d === 3 ? "★" : ""}
                          </button>
                        ))}
                        <div className="flex items-center gap-1.5 ml-2">
                          <span className="text-xs text-gray-500 font-medium">Custom:</span>
                          <input
                            type="number"
                            min="1"
                            max="90"
                            value={followUpDays}
                            onChange={(e) => setFollowUpDays(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-16 rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-900 focus:border-[#673DE6] focus:outline-none"
                          />
                          <span className="text-xs text-gray-500 font-medium">days</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                        Follow-up Template (Optional):
                      </label>
                      <select
                        value={followUpTemplateId}
                        onChange={(e) => setFollowUpTemplateId(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white p-2.5 text-xs text-gray-800 focus:border-[#673DE6] focus:outline-none"
                      >
                        <option value="">Default: Friendly follow-up reply ("Re: {subject || 'Partnership Outreach'}")</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.subject})
                          </option>
                        ))}
                      </select>
                    </div>

                    <p className="text-[11px] text-gray-500 italic">
                      💡 If the recipient replies before day {followUpDays}, the automated follow-up will be cancelled automatically.
                    </p>
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <div className="flex items-center justify-end pt-2">
                <button
                  type="button"
                  disabled={busy || selectedRows.length === 0}
                  onClick={handleSubmitCampaign}
                  className="rounded-2xl bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] px-8 py-3 text-sm font-bold text-white shadow-md shadow-purple-500/25 hover:shadow-lg hover:shadow-purple-500/35 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer disabled:opacity-50"
                >
                  {busy
                    ? "Scheduling Campaign..."
                    : sendMode === "sendNow"
                    ? `⚡ Start Sending ${selectedRows.length} Emails (${delayAmount} ${delayUnit} Gap)`
                    : `🕒 Schedule ${selectedRows.length} Emails (${delayAmount} ${delayUnit} Gap)`}
                </button>
              </div>
            </section>
          )}
        </div>
      ) : (
        /* Standard Campaigns List */
        <div className="space-y-4">
          {campaigns.some((c) => ["SCHEDULED", "SENDING", "ACTIVE"].includes(c.status)) && (
            <div className="p-4 rounded-2xl border border-red-200 bg-red-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">🛑</span>
                <div>
                  <p className="text-xs sm:text-sm font-bold text-red-950">
                    Active Email Dispatch in Progress
                  </p>
                  <p className="text-xs text-red-700">
                    If this was started by mistake, click Emergency Stop to immediately freeze all outgoing sends.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (!confirm("Emergency Stop: Immediately freeze/pause all active email dispatches?")) return;
                  setBusy(true);
                  try {
                    const res = await fetch("/api/campaigns/emergency-stop", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "pause" }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Failed to stop");
                    setMessage({
                      type: "success",
                      text: `🛑 Emergency Stop Applied! ${data.pausedCampaignsCount || 0} active campaign(s) safely PAUSED.`,
                    });
                    await loadInitialData();
                    if (typeof window !== "undefined") {
                      window.dispatchEvent(new CustomEvent("mail-counts-updated"));
                    }
                  } catch (err: any) {
                    alert(err.message || "Failed to stop.");
                  } finally {
                    setBusy(false);
                  }
                }}
                className="px-4 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-bold rounded-xl shadow-md shadow-red-500/25 hover:shadow-lg hover:shadow-red-500/35 hover:scale-105 active:scale-95 transition-all duration-200 shrink-0 cursor-pointer disabled:opacity-50"
              >
                🛑 Emergency Stop All Active Campaigns
              </button>
            </div>
          )}
          <div className="card overflow-x-auto">
          {campaigns.length === 0 ? (
            <EmptyState
              title="No campaigns yet"
              description="Upload an Excel sheet above to launch your first batch campaign!"
            />
          ) : (
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="border-b border-line bg-gray-50/60">
                <tr>
                  {["Campaign Name", "Mailbox", "Recipients", "Sent", "Failed", "Status", "Created", "Actions"].map(
                    (heading) => (
                      <th
                        key={heading}
                        className="whitespace-nowrap px-5 py-4 text-xs font-bold uppercase tracking-wide text-gray-400"
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {campaigns.map((camp) => (
                  <tr key={camp.id} className="hover:bg-purple-50/30 transition">
                    <td className="px-5 py-4">
                      <Link
                        href={`/campaigns/${camp.id}`}
                        className="font-bold text-gray-900 hover:text-[#673DE6] hover:underline flex items-center gap-2 group"
                      >
                        <span className="text-base group-hover:scale-110 transition">📢</span>
                        <span className="text-sm font-bold text-gray-900 group-hover:text-[#673DE6]">
                          {camp.name}
                        </span>
                      </Link>
                      {camp.description && (
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate max-w-xs">{camp.description}</p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-500">{camp.mailbox?.emailAddress ?? "Default"}</td>
                    <td className="px-5 py-4 font-bold">{camp.counters.total}</td>
                    <td className="px-5 py-4 text-emerald-600 font-semibold">{camp.counters.sent}</td>
                    <td className="px-5 py-4 text-red-500 font-semibold">{camp.counters.failed}</td>
                    <td className="px-5 py-4">
                      <Badge
                        tone={
                          camp.status === "READY"
                            ? "green"
                            : camp.status === "SCHEDULED" || camp.status === "SENDING"
                            ? "blue"
                            : camp.status === "PAUSED"
                            ? "amber"
                            : "neutral"
                        }
                      >
                        {camp.status}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-gray-400 text-xs">
                      {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(camp.createdAt))}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <Link
                          className="px-3.5 py-1.5 bg-[#673DE6] hover:bg-[#5025D1] text-white text-xs font-bold rounded-xl shadow-2xs transition flex items-center gap-1.5"
                          href={`/campaigns/${camp.id}`}
                        >
                          <span>📋</span> View Brands ({camp.counters.total}) &rarr;
                        </Link>
                        {/* Action Buttons based on status */}
                        {["SCHEDULED", "SENDING", "ACTIVE"].includes(camp.status) && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                if (
                                  !confirm(
                                    `🚀 Forward and dispatch campaign "${camp.name}" immediately?\n\nEmails will start sending in real time without waiting for scheduled time.`
                                  )
                                ) {
                                  return;
                                }
                                setBusy(true);
                                try {
                                  const res = await fetch(`/api/campaigns/${camp.id}/forward`, { method: "POST" });
                                  const data = await res.json();
                                  if (!res.ok) throw new Error(data.error || "Failed to forward campaign");
                                  setMessage({ type: "success", text: data.message || `🚀 Campaign "${camp.name}" forwarded!` });
                                  await loadInitialData();
                                  if (typeof window !== "undefined") {
                                    window.dispatchEvent(new CustomEvent("mail-counts-updated"));
                                  }
                                } catch (err: any) {
                                  alert(err.message || "Failed to forward");
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Forward and dispatch all emails immediately in real time"
                            >
                              <span>🚀</span> Forward Now
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  const res = await fetch(`/api/campaigns/${camp.id}/control`, {
                                    method: "POST",
                                    headers: { "content-type": "application/json" },
                                    body: JSON.stringify({ action: "pause" }),
                                  });
                                  if (!res.ok) throw new Error("Failed to pause campaign");
                                  setMessage({ type: "success", text: `⏸️ Campaign "${camp.name}" stopped/paused.` });
                                  await loadInitialData();
                                  if (typeof window !== "undefined") {
                                    window.dispatchEvent(new CustomEvent("mail-counts-updated"));
                                  }
                                } catch (err: any) {
                                  alert(err.message || "Failed to pause");
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Pause sending emails temporarily"
                            >
                              <span>⏸️</span> Pause
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleOpenEditModal(camp)}
                              className="px-3 py-1.5 bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Edit campaign settings, mailbox, or template"
                            >
                              <span>✏️</span> Edit
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                if (!confirm(`Permanently stop campaign "${camp.name}"? Remaining scheduled emails will not be sent.`)) return;
                                setBusy(true);
                                try {
                                  const res = await fetch(`/api/campaigns/${camp.id}/control`, {
                                    method: "POST",
                                    headers: { "content-type": "application/json" },
                                    body: JSON.stringify({ action: "cancel" }),
                                  });
                                  if (!res.ok) throw new Error("Failed to stop campaign");
                                  setMessage({ type: "success", text: `🛑 Campaign "${camp.name}" stopped permanently.` });
                                  await loadInitialData();
                                  if (typeof window !== "undefined") {
                                    window.dispatchEvent(new CustomEvent("mail-counts-updated"));
                                  }
                                } catch (err: any) {
                                  alert(err.message || "Failed to stop");
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-xl border border-amber-200 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50 hover:scale-105 active:scale-95"
                              title="Permanently stop campaign and cancel remaining emails"
                            >
                              <span>🛑</span> Stop
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleDeleteCampaign(camp.id, camp.name, camp.status)}
                              className="px-2.5 py-1.5 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Stop and delete this campaign immediately"
                            >
                              <span>🗑️</span> Delete
                            </button>
                          </>
                        )}

                        {camp.status === "PAUSED" && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  const res = await fetch(`/api/campaigns/${camp.id}/control`, {
                                    method: "POST",
                                    headers: { "content-type": "application/json" },
                                    body: JSON.stringify({ action: "resume" }),
                                  });
                                  if (!res.ok) throw new Error("Failed to continue campaign");
                                  await fetch("/api/campaigns/emergency-resume", { method: "POST" }).catch(() => {});
                                  setMessage({ type: "success", text: `▶️ Campaign "${camp.name}" continued! Sending has resumed.` });
                                  await loadInitialData();
                                  if (typeof window !== "undefined") {
                                    window.dispatchEvent(new CustomEvent("mail-counts-updated"));
                                  }
                                } catch (err: any) {
                                  alert(err.message || "Failed to continue campaign");
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Continue sending emails for this campaign"
                            >
                              <span>▶️</span> Continue
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleOpenEditModal(camp)}
                              className="px-3 py-1.5 bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Edit campaign settings, mailbox, or template"
                            >
                              <span>✏️</span> Edit
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                if (!confirm(`Permanently stop campaign "${camp.name}"? Remaining scheduled emails will not be sent.`)) return;
                                setBusy(true);
                                try {
                                  const res = await fetch(`/api/campaigns/${camp.id}/control`, {
                                    method: "POST",
                                    headers: { "content-type": "application/json" },
                                    body: JSON.stringify({ action: "cancel" }),
                                  });
                                  if (!res.ok) throw new Error("Failed to stop campaign");
                                  setMessage({ type: "success", text: `🛑 Campaign "${camp.name}" stopped permanently.` });
                                  await loadInitialData();
                                  if (typeof window !== "undefined") {
                                    window.dispatchEvent(new CustomEvent("mail-counts-updated"));
                                  }
                                } catch (err: any) {
                                  alert(err.message || "Failed to stop");
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-xl border border-amber-200 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50 hover:scale-105 active:scale-95"
                              title="Permanently stop campaign and cancel remaining emails"
                            >
                              <span>🛑</span> Stop
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleDeleteCampaign(camp.id, camp.name, camp.status)}
                              className="px-2.5 py-1.5 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Delete this paused campaign completely"
                            >
                              <span>🗑️</span> Delete
                            </button>
                          </>
                        )}

                        {(camp.status === "DRAFT" || camp.status === "READY") && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleDispatchSavedCampaign(camp.id, camp.name)}
                              className="px-3.5 py-1.5 bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Send campaign emails to all saved contacts now"
                            >
                              <span>🚀</span> Send Now
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleOpenScheduleModal(camp)}
                              className="px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Schedule this draft campaign for future automated delivery"
                            >
                              <span>🕒</span> Schedule
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleOpenEditModal(camp)}
                              className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-[#673DE6] text-xs font-bold rounded-xl border border-purple-200 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50 hover:scale-105 active:scale-95"
                              title="Edit campaign settings, mailbox, or template"
                            >
                              <span>✏️</span> Edit
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleDeleteCampaign(camp.id, camp.name, camp.status)}
                              className="px-2.5 py-1.5 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Delete this draft campaign"
                            >
                              <span>🗑️</span> Delete
                            </button>
                          </>
                        )}

                        {["COMPLETED", "CANCELLED"].includes(camp.status) && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleOpenEditModal(camp)}
                              className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-[#673DE6] text-xs font-bold rounded-xl border border-purple-200 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50 hover:scale-105 active:scale-95"
                              title="Edit campaign details"
                            >
                              <span>✏️</span> Edit
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleDeleteCampaign(camp.id, camp.name, camp.status)}
                              className="px-2.5 py-1.5 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Delete this campaign"
                            >
                              <span>🗑️</span> Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
        </div>
      )}

      {/* Schedule Draft Campaign Modal */}
      {scheduleModalOpen && targetDraftCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-gray-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-gradient-to-r from-blue-50 via-white to-purple-50 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="p-2 bg-blue-600 text-white rounded-xl text-base leading-none">
                  🕒
                </span>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Schedule Draft Send</h3>
                  <p className="text-[11px] text-gray-500">Pick date, time & interval for {targetDraftCampaign.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 rounded-lg p-1 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 text-xs flex items-center justify-between">
                <div>
                  <span className="font-bold text-gray-800">Recipients:</span>
                  <span className="ml-1 text-blue-700 font-bold">{targetDraftCampaign.counters.total} Brands</span>
                </div>
                <div className="text-[11px] text-gray-500 font-medium">Timezone: Asia/Karachi (PKT)</div>
              </div>

              {/* Sender Mailbox */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Sender Hostinger Mailbox</label>
                <select
                  value={draftScheduleMailboxId}
                  onChange={(e) => setDraftScheduleMailboxId(e.target.value)}
                  className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {mailboxes.map((mb) => (
                    <option key={mb.id} value={mb.id}>
                      {mb.displayName ? `${mb.displayName} (${mb.emailAddress})` : mb.emailAddress}
                    </option>
                  ))}
                </select>
              </div>

              {/* Schedule Date & Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Send Date</label>
                  <input
                    type="date"
                    value={draftScheduleDate}
                    onChange={(e) => setDraftScheduleDate(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Send Time</label>
                  <input
                    type="time"
                    value={draftScheduleTime}
                    onChange={(e) => setDraftScheduleTime(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              {/* Interval between emails */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Delay Between Consecutive Emails
                </label>
                <select
                  value={draftScheduleIntervalSec}
                  onChange={(e) => setDraftScheduleIntervalSec(Number(e.target.value))}
                  className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value={0}>0 seconds (Instant burst send)</option>
                  <option value={15}>15 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={60}>60 seconds / 1 minute (Recommended for Hostinger)</option>
                  <option value={120}>120 seconds / 2 minutes</option>
                  <option value={300}>300 seconds / 5 minutes</option>
                </select>
                <p className="text-[11px] text-gray-400 mt-1">
                  Automatically spreads outgoing emails to protect sender reputation.
                </p>
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={schedulingBusy}
                onClick={handleConfirmScheduleDraft}
                className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {schedulingBusy ? (
                  <>
                    <span className="animate-spin inline-block h-3 w-3 border-2 border-white border-t-transparent rounded-full"></span>
                    Scheduling...
                  </>
                ) : (
                  <>
                    <span>🕒</span> Confirm &amp; Schedule
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Campaign Modal (For Draft, In-Progress, and Paused campaigns) */}
      {editModalOpen && targetEditCampaign && (
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
                        targetEditCampaign.status === "SENDING" || targetEditCampaign.status === "SCHEDULED"
                          ? "bg-blue-100 text-blue-700"
                          : targetEditCampaign.status === "PAUSED"
                          ? "bg-amber-100 text-amber-700"
                          : targetEditCampaign.status === "COMPLETED"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-700"
                      }`}>
                        {targetEditCampaign.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500">Update sender, template, intervals &amp; sheet settings</p>
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
                {targetEditCampaign.status === "PAUSED" ? (
                  <div className="space-y-2.5">
                    <div className="flex items-start gap-2 text-amber-900 font-medium leading-relaxed">
                      <span className="text-base">⏸️</span>
                      <div>
                        <strong>Campaign is Currently PAUSED:</strong> Email dispatch is frozen. You can edit settings below, or use the quick action buttons:
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-amber-200/50">
                      <button
                        type="button"
                        disabled={busy || editSaving}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const res = await fetch(`/api/campaigns/${targetEditCampaign.id}/control`, {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ action: "resume" }),
                            });
                            if (!res.ok) throw new Error("Failed to resume campaign");
                            setMessage({ type: "success", text: `▶️ Campaign "${targetEditCampaign.name}" resumed.` });
                            setEditModalOpen(false);
                            await loadInitialData();
                          } catch (err: any) {
                            alert(err.message || "Failed to resume");
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg shadow-2xs transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <span>▶️</span> Resume Sending
                      </button>
                      <button
                        type="button"
                        disabled={busy || editSaving}
                        onClick={async () => {
                          if (!confirm(`Permanently stop campaign "${targetEditCampaign.name}"? Remaining scheduled emails will not be sent.`)) return;
                          setBusy(true);
                          try {
                            const res = await fetch(`/api/campaigns/${targetEditCampaign.id}/control`, {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ action: "cancel" }),
                            });
                            if (!res.ok) throw new Error("Failed to stop campaign");
                            setMessage({ type: "success", text: `🛑 Campaign "${targetEditCampaign.name}" stopped permanently.` });
                            setEditModalOpen(false);
                            await loadInitialData();
                          } catch (err: any) {
                            alert(err.message || "Failed to stop");
                          } finally {
                            setBusy(false);
                          }
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
                          await handleDeleteCampaign(targetEditCampaign.id, targetEditCampaign.name, targetEditCampaign.status);
                        }}
                        className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold rounded-lg shadow-2xs transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <span>🗑️</span> Delete Campaign
                      </button>
                    </div>
                  </div>
                ) : targetEditCampaign.status === "SENDING" || targetEditCampaign.status === "SCHEDULED" ? (
                  <div className="space-y-2.5">
                    <div className="flex items-start gap-2 text-purple-900 font-medium leading-relaxed">
                      <span className="text-base">⚡</span>
                      <div>
                        <strong>Active Mid-Campaign Editing:</strong> Modifying the sender mailbox, template, or interval will take effect immediately on all <strong>{targetEditCampaign.counters.pending} pending/unsent</strong> emails.
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-purple-200/50">
                      <button
                        type="button"
                        disabled={busy || editSaving}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const res = await fetch(`/api/campaigns/${targetEditCampaign.id}/control`, {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ action: "pause" }),
                            });
                            if (!res.ok) throw new Error("Failed to pause campaign");
                            setMessage({ type: "success", text: `⏸️ Campaign "${targetEditCampaign.name}" paused.` });
                            setEditModalOpen(false);
                            await loadInitialData();
                          } catch (err: any) {
                            alert(err.message || "Failed to pause");
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold rounded-lg shadow-2xs transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <span>⏸️</span> Pause Campaign
                      </button>
                      <button
                        type="button"
                        disabled={busy || editSaving}
                        onClick={async () => {
                          if (!confirm(`Permanently stop campaign "${targetEditCampaign.name}"? Remaining scheduled emails will not be sent.`)) return;
                          setBusy(true);
                          try {
                            const res = await fetch(`/api/campaigns/${targetEditCampaign.id}/control`, {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ action: "cancel" }),
                            });
                            if (!res.ok) throw new Error("Failed to stop campaign");
                            setMessage({ type: "success", text: `🛑 Campaign "${targetEditCampaign.name}" stopped permanently.` });
                            setEditModalOpen(false);
                            await loadInitialData();
                          } catch (err: any) {
                            alert(err.message || "Failed to stop");
                          } finally {
                            setBusy(false);
                          }
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
                          await handleDeleteCampaign(targetEditCampaign.id, targetEditCampaign.name, targetEditCampaign.status);
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
                    placeholder="e.g. Campaign - 21 Oct 2026"
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
                    placeholder="e.g. Outreach batch for Home & Kitchen brands"
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
                        {tpl.name} {tpl.isDefault ? "★ (Active Global)" : ""} - Subject: {tpl.subject.slice(0, 45)}...
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

      {/* Quick Connect / Edit Hostinger Mailbox Modal (Step 3 In-Place Management) */}
      {mailboxModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-purple-100 overflow-hidden space-y-0 animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-purple-50 via-white to-indigo-50 border-b border-purple-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="p-2 bg-[#673DE6] text-white rounded-xl text-base leading-none shadow-xs">
                  ✉️
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-gray-900 tracking-tight">
                    {mailboxModalMode === "add" ? "Connect Hostinger Mailbox" : "Edit Hostinger Mailbox Settings"}
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    Real-time verification • Isolated for {currentUser?.email || "your account"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMailboxModalOpen(false)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 font-bold transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveMailboxForm} className="p-6 space-y-4 text-xs">
              {mailboxFormError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-medium leading-relaxed">
                  <strong>Verification Error:</strong> {mailboxFormError}
                </div>
              )}

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Email Address <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={mailboxFormEmail}
                  onChange={(e) => {
                    setMailboxFormEmail(e.target.value);
                    if (mailboxModalMode === "add" && !mailboxFormUsername) {
                      setMailboxFormUsername(e.target.value);
                    }
                  }}
                  placeholder="e.g. sales@swiftorbits.com"
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none font-bold text-gray-900 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Display Name / Sender Name (Optional)
                </label>
                <input
                  type="text"
                  value={mailboxFormDisplayName}
                  onChange={(e) => setMailboxFormDisplayName(e.target.value)}
                  placeholder="e.g. Swift Orbits Sales"
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none text-gray-800 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Hostinger Email Password {mailboxModalMode === "add" && <span className="text-rose-500">*</span>}
                  {mailboxModalMode === "edit" && <span className="text-gray-400 font-normal ml-1">(Leave blank to keep current)</span>}
                </label>
                <input
                  type="password"
                  required={mailboxModalMode === "add"}
                  value={mailboxFormPassword}
                  onChange={(e) => setMailboxFormPassword(e.target.value)}
                  placeholder={mailboxModalMode === "add" ? "Enter your Hostinger email password" : "•••••••• (Keep unchanged)"}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none text-gray-900 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Login Username (Hostinger requires full email address)
                </label>
                <input
                  type="text"
                  required
                  value={mailboxFormUsername}
                  onChange={(e) => setMailboxFormUsername(e.target.value)}
                  placeholder="e.g. sales@swiftorbits.com"
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none text-gray-900 text-xs font-mono"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Ensure the spelling matches your Hostinger account exactly (avoid missing letters).
                </p>
              </div>

              {/* Hostinger Server Specs */}
              <div className="p-3 bg-purple-50/60 rounded-xl border border-purple-100 flex items-center justify-between text-[11px] text-purple-900">
                <span className="font-semibold">Hostinger Mail Server Config:</span>
                <span className="font-mono text-[10px]">smtp.hostinger.com:465 (TLS) | imap.hostinger.com:993</span>
              </div>

              {/* Footer */}
              <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setMailboxModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mailboxFormBusy || !mailboxFormEmail.trim()}
                  className="px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] rounded-xl shadow-xs transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {mailboxFormBusy ? (
                    <>
                      <span className="animate-spin inline-block h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                      Testing &amp; Connecting...
                    </>
                  ) : (
                    <>
                      <span>⚡</span>
                      <span>Verify &amp; Connect in Real Time</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Final Pre-Send Review Modal (Mandatory check before any send) */}
      {reviewModalOpen && reviewModalData && (
        <PreSendReviewModal
          isOpen={reviewModalOpen}
          onClose={() => setReviewModalOpen(false)}
          onConfirm={reviewModalData.onConfirmExecute}
          isConfirming={reviewConfirming}
          campaignTitle={reviewModalData.campaignTitle}
          senderMailbox={reviewModalData.senderMailbox}
          totalRecipients={reviewModalData.totalRecipients}
          sendMode={reviewModalData.sendMode}
          scheduledTime={reviewModalData.scheduledTime}
          delayAmount={reviewModalData.delayAmount}
          delayUnit={reviewModalData.delayUnit}
          subjectTemplate={reviewModalData.subjectTemplate}
          bodyTemplate={reviewModalData.bodyTemplate}
          followUpEnabled={reviewModalData.followUpEnabled}
          followUpDays={reviewModalData.followUpDays}
          recipients={reviewModalData.recipients}
          formAutomationEnabled={formAutomationEnabled}
          formTemplateName={reviewModalData.formTemplateName}
          formScheduleMode={formScheduleMode}
          formScheduledTime={reviewModalData.formScheduledTime}
          formConcurrency={formConcurrency}
          onUpdateRecipientFormUrl={(idx, url) => {
            const rec = reviewModalData.recipients[idx];
            if (!rec) return;
            const key = rec.brandEmail || rec.brandName || String(idx);
            setFormOverrides((prev) => ({
              ...prev,
              [key]: { ...prev[key], targetUrl: url },
            }));
            setReviewModalData((prev: any) => {
              if (!prev) return prev;
              const nextRecs = [...prev.recipients];
              nextRecs[idx] = { ...nextRecs[idx], formUrl: url };
              return { ...prev, recipients: nextRecs };
            });
          }}
          onToggleExcludeForm={(idx) => {
            const rec = reviewModalData.recipients[idx];
            if (!rec) return;
            const key = rec.brandEmail || rec.brandName || String(idx);
            const nextExcluded = !rec.formExcluded;
            setFormOverrides((prev) => ({
              ...prev,
              [key]: { ...prev[key], excluded: nextExcluded },
            }));
            setReviewModalData((prev: any) => {
              if (!prev) return prev;
              const nextRecs = [...prev.recipients];
              nextRecs[idx] = { ...nextRecs[idx], formExcluded: nextExcluded };
              return { ...prev, recipients: nextRecs };
            });
          }}
          onUpdateRecipientFormValues={(idx, values) => {
            const rec = reviewModalData.recipients[idx];
            if (!rec) return;
            const key = rec.brandEmail || rec.brandName || String(idx);
            setFormOverrides((prev) => ({
              ...prev,
              [key]: { ...prev[key], resolvedValues: values },
            }));
            setReviewModalData((prev: any) => {
              if (!prev) return prev;
              const nextRecs = [...prev.recipients];
              nextRecs[idx] = { ...nextRecs[idx], formResolvedValues: values };
              return { ...prev, recipients: nextRecs };
            });
          }}
          onUpdateEmailTemplate={(subj, bodyText) => {
            setSubject(subj);
            setBody(bodyText);
            setReviewModalData((prev: any) => {
              if (!prev) return prev;
              return { ...prev, subjectTemplate: subj, bodyTemplate: bodyText };
            });
          }}
        />
      )}
    </div>
  );
}
