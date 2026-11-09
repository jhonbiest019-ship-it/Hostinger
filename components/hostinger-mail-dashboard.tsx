"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatEmailBodyToHtml, renderTemplate } from "@/lib/email/template";

export interface MailMessage {
  id: string;
  mailboxId?: string | null;
  fromAddress: string | null;
  toAddress: string;
  subject: string;
  body: string;
  receivedAt: string | null;
  createdAt?: string;
  threadId: string | null;
  status?: string;
  direction?: string;
  campaign?: { id: string; name: string } | null;
  contact?: { name: string; fullName: string | null; email: string } | null;
  mailbox?: { emailAddress: string } | null;
  isRead?: boolean;
  isDraftCampaign?: boolean;
  campaignId?: string;
}

interface Counts {
  inbox: number;
  drafts: number;
  scheduled: number;
  sent: number;
  spam: number;
  trash: number;
}

export function HostingerMailDashboard() {
  const router = useRouter();

  const [folder, setFolder] = useState<"inbox" | "drafts" | "scheduled" | "sent" | "spam" | "trash">("inbox");
  const [filter, setFilter] = useState<"all" | "unread" | "read" | "starred">("all");
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [counts, setCounts] = useState<Counts>({ inbox: 0, drafts: 0, scheduled: 0, sent: 0, spam: 0, trash: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<MailMessage | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [starredIds, setStarredIds] = useState<string[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [bannerVisible, setBannerVisible] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notification, setNotification] = useState("");

  const handleBack = useCallback(() => {
    setSelectedMessage(null);
    if (typeof window !== "undefined") {
      const prev = sessionStorage.getItem("prev_workspace_route");
      if (prev && prev !== "/dashboard" && prev !== "/inbox") {
        router.push(prev);
        return;
      }
      if (window.history.length > 2) {
        router.back();
        return;
      }
    }
    router.push("/campaigns");
  }, [router]);

  // Modals
  const [composeOpen, setComposeOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Schedule Draft Modal
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<{ campaignId: string; subject: string } | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleIntervalSec, setScheduleIntervalSec] = useState<number>(60);
  const [scheduleMailboxId, setScheduleMailboxId] = useState("");
  const [schedulingBusy, setSchedulingBusy] = useState(false);

  // Active Sending Real-Time Banner
  const [activeSendingBanner, setActiveSendingBanner] = useState<{
    visible: boolean;
    title: string;
    details: string;
    status: "sending" | "completed";
  } | null>(null);

  // Compose form
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; subject: string; body: string; isDefault?: boolean }>>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  // Hostinger Webmail Rich Compose Toolbar states
  const [composeDraftId, setComposeDraftId] = useState<string | null>(null);
  const [formatToolbarOpen, setFormatToolbarOpen] = useState(false);
  const [composePreviewMode, setComposePreviewMode] = useState(false);
  const [scheduleMenuOpen, setScheduleMenuOpen] = useState(false);
  const [scheduleSendModalOpen, setScheduleSendModalOpen] = useState(false);
  const [scheduleSendDate, setScheduleSendDate] = useState("");
  const [scheduleSendTime, setScheduleSendTime] = useState("");
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ name: string; size: number; type: string }>>([]);
  const [draftNotice, setDraftNotice] = useState("");
  const [draftSaving, setDraftSaving] = useState(false);
  const [showAiPromptBar, setShowAiPromptBar] = useState(true);

  const aiInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const scheduleMenuRef = useRef<HTMLDivElement>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);

  // Hostinger Mailboxes for composing and switching sender
  const [mailboxes, setMailboxes] = useState<Array<{ id: string; emailAddress: string; displayName?: string | null; status: string; smtpStatus: string }>>([]);
  const [composeMailboxId, setComposeMailboxId] = useState("");
  const [mailboxDropdownOpen, setMailboxDropdownOpen] = useState(false);
  const mailboxDropdownRef = useRef<HTMLDivElement>(null);
  const messagesCacheRef = useRef<Record<string, { messages: MailMessage[]; counts?: Counts; readIds: string[] }>>({});

  const activeMailbox = useMemo(() => {
    return mailboxes.find((m) => m.id === composeMailboxId) || mailboxes[0] || null;
  }, [mailboxes, composeMailboxId]);

  // Close mailbox dropdown when clicking outside or pressing Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (mailboxDropdownRef.current && !mailboxDropdownRef.current.contains(event.target as Node)) {
        setMailboxDropdownOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMailboxDropdownOpen(false);
      }
    }
    if (mailboxDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mailboxDropdownOpen]);

  // Close compose popups when clicking outside
  useEffect(() => {
    function handleComposePopupsClickOutside(event: MouseEvent) {
      if (scheduleMenuRef.current && !scheduleMenuRef.current.contains(event.target as Node)) {
        setScheduleMenuOpen(false);
      }
      if (templateMenuRef.current && !templateMenuRef.current.contains(event.target as Node)) {
        setTemplateMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleComposePopupsClickOutside);
    return () => document.removeEventListener("mousedown", handleComposePopupsClickOutside);
  }, []);

  // Last scheduled brand for auto-populating template & recipient
  const [lastScheduledBrand, setLastScheduledBrand] = useState<{
    brandName: string;
    email: string;
    category?: string;
    campaignName?: string;
  } | null>(null);

  // AI assistant form
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  // Fetch last scheduled brand whenever dashboard mounts or compose opens
  useEffect(() => {
    fetch("/api/scheduled/last-brand")
      .then((r) => r.json())
      .then((data) => {
        if (data.lastBrand) {
          setLastScheduledBrand(data.lastBrand);
        }
      })
      .catch(() => {});
  }, [composeOpen]);

  function applyTemplateWithBrand(
    tplSubject: string,
    tplBody: string,
    brand?: { brandName: string; email: string; category?: string } | null
  ) {
    const bName = brand?.brandName || lastScheduledBrand?.brandName || "";
    const bEmail = brand?.email || lastScheduledBrand?.email || composeTo || "";
    const bCategory = brand?.category || lastScheduledBrand?.category || "";

    let subj = tplSubject || "";
    let bdy = tplBody || "";

    if (bName) {
      subj = subj
        .replace(/{{\s*brandName\s*}}/gi, bName)
        .replace(/{{\s*brand\s*}}/gi, bName)
        .replace(/{{\s*name\s*}}/gi, bName);

      bdy = bdy
        .replace(/{{\s*brandName\s*}}/gi, bName)
        .replace(/{{\s*brand\s*}}/gi, bName)
        .replace(/{{\s*name\s*}}/gi, bName);
    }
    if (bEmail) {
      subj = subj.replace(/{{\s*(email|brandEmail)\s*}}/gi, bEmail);
      bdy = bdy.replace(/{{\s*(email|brandEmail)\s*}}/gi, bEmail);
    }
    if (bCategory) {
      subj = subj.replace(/{{\s*(productCategory|category)\s*}}/gi, bCategory);
      bdy = bdy.replace(/{{\s*(productCategory|category)\s*}}/gi, bCategory);
    }

    return { subj, bdy };
  }

  function handleUseScheduledBrand() {
    if (!lastScheduledBrand) return;
    if (lastScheduledBrand.email) setComposeTo(lastScheduledBrand.email);
    if (selectedTemplateId) {
      const found = templates.find((t) => t.id === selectedTemplateId);
      if (found) {
        const { subj, bdy } = applyTemplateWithBrand(found.subject, found.body, lastScheduledBrand);
        setComposeSubject(subj);
        setComposeBody(bdy);
      }
    } else {
      setComposeSubject((prev) =>
        prev && prev.trim()
          ? prev
              .replace(/{{\s*brandName\s*}}/gi, lastScheduledBrand.brandName)
              .replace(/{{\s*brand\s*}}/gi, lastScheduledBrand.brandName)
          : `Partnership Proposal with ${lastScheduledBrand.brandName}`
      );
      setComposeBody((prev) =>
        prev && prev.trim()
          ? prev
              .replace(/{{\s*brandName\s*}}/gi, lastScheduledBrand.brandName)
              .replace(/{{\s*brand\s*}}/gi, lastScheduledBrand.brandName)
          : `Hi ${lastScheduledBrand.brandName} Team,\n\nWe would love to discuss a partnership with ${lastScheduledBrand.brandName}.`
      );
    }
  }

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((data) => {
        if (data.templates) {
          setTemplates(data.templates);
          const activeTpl = data.templates.find((t: any) => t.isDefault) || data.templates[0];
          if (activeTpl) {
            setSelectedTemplateId(activeTpl.id);
            const { subj, bdy } = applyTemplateWithBrand(activeTpl.subject, activeTpl.body, lastScheduledBrand);
            setComposeSubject(subj);
            setComposeBody(bdy);
          }
        }
      })
      .catch(() => {});
  }, [lastScheduledBrand]);

  const refreshMailboxes = useCallback(async () => {
    try {
      const res = await fetch("/api/mailboxes");
      const data = await res.json();
      const mbs = (data.mailboxes || []).filter(
        (m: any) => m.status === "ACTIVE" && m.smtpStatus === "CONNECTED"
      );
      const list = mbs.length ? mbs : data.mailboxes || [];
      setMailboxes(list);

      const savedId = typeof window !== "undefined" ? localStorage.getItem("active_sender_mailbox_id") : null;
      let targetId = "";
      if (savedId && list.some((m: any) => m.id === savedId)) {
        targetId = savedId;
      } else if (list.length > 0) {
        try {
          const actRes = await fetch("/api/mailboxes/active");
          const actData = await actRes.json();
          if (actData.activeMailboxId && list.some((m: any) => m.id === actData.activeMailboxId)) {
            targetId = actData.activeMailboxId;
          } else {
            targetId = list[0].id;
          }
        } catch {
          targetId = list[0].id;
        }
      }

      if (targetId) {
        setComposeMailboxId(targetId);
        if (typeof window !== "undefined") localStorage.setItem("active_sender_mailbox_id", targetId);
      }
    } catch {}
  }, []);

  async function handleSwitchMailbox(newId: string) {
    if (!newId || newId === composeMailboxId) return;
    setComposeMailboxId(newId);
    setSelectedMessage(null);
    setSelectedIds([]);
    messagesCacheRef.current = {};
    setMessages([]);
    setLoading(true);
    if (typeof window !== "undefined") {
      localStorage.setItem("active_sender_mailbox_id", newId);
      window.dispatchEvent(new CustomEvent("sender-mailbox-changed", { detail: { mailboxId: newId } }));
    }
    try {
      await fetch("/api/mailboxes/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mailboxId: newId }),
      });
    } catch {}
    void loadData(folder, search, newId);
  }

  useEffect(() => {
    void refreshMailboxes();

    const onMailboxesUpdated = () => void refreshMailboxes();
    const onSenderChanged = (e: any) => {
      const id = e.detail?.mailboxId;
      if (id && id !== composeMailboxId) {
        setComposeMailboxId(id);
        setSelectedMessage(null);
        setSelectedIds([]);
        setMessages([]);
        void loadData(folder, search, id);
      }
    };

    window.addEventListener("mailboxes-updated", onMailboxesUpdated);
    window.addEventListener("sender-mailbox-changed", onSenderChanged);
    return () => {
      window.removeEventListener("mailboxes-updated", onMailboxesUpdated);
      window.removeEventListener("sender-mailbox-changed", onSenderChanged);
    };
  }, [refreshMailboxes, composeMailboxId, folder, search]);

  useEffect(() => {
    if (composeOpen) {
      void refreshMailboxes();
    }
  }, [composeOpen, refreshMailboxes]);

  function handleApplyTemplate(id: string) {
    setSelectedTemplateId(id);
    const found = templates.find((t) => t.id === id);
    if (found) {
      const { subj, bdy } = applyTemplateWithBrand(found.subject, found.body, lastScheduledBrand);
      setComposeSubject(subj);
      setComposeBody(bdy);
    }
  }

  async function loadData(
    targetFolder = folder,
    searchTerm = search,
    targetMailboxId = composeMailboxId,
    silent = false
  ) {
    if (!targetMailboxId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const cacheKey = `${targetMailboxId}:${targetFolder}:${searchTerm}`;
    const cached = messagesCacheRef.current[cacheKey];

    // Instant SWR: serve cached messages immediately with 0ms latency!
    if (cached) {
      setMessages(cached.messages);
      if (cached.counts) setCounts(cached.counts);
      if (cached.readIds) setReadIds(cached.readIds);
      setLoading(false);
    } else if (!silent) {
      setLoading(true);
    }

    try {
      const url = new URL("/api/inbox", window.location.origin);
      url.searchParams.set("folder", targetFolder);
      url.searchParams.set("mailboxId", targetMailboxId);
      if (searchTerm) url.searchParams.set("search", searchTerm);

      const res = await fetch(url.toString(), { credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        const msgs = data.messages || [];
        setMessages(msgs);
        const persistentRead = msgs.filter((m: any) => m.isRead).map((m: any) => m.id);
        const updatedReadIds = persistentRead;
        setReadIds(updatedReadIds);
        if (data.counts) {
          setCounts(data.counts);
          window.dispatchEvent(new CustomEvent("mail-counts-updated", { detail: data.counts }));
        }

        // Save into instant memory cache
        messagesCacheRef.current[cacheKey] = {
          messages: msgs,
          counts: data.counts,
          readIds: updatedReadIds,
        };
      }
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }

  // React to URL ?folder= changes (e.g. clicking Trash in sidebar)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("folder");
      if (p && ["inbox", "drafts", "scheduled", "sent", "spam", "trash"].includes(p)) {
        setFolder(p as any);
        setSelectedMessage(null);
      }
    }
  }, []);

  useEffect(() => {
    if (composeMailboxId) {
      void loadData(folder, search, composeMailboxId);
      // Fast initial sync with Hostinger on mailbox load
      void fetch("/api/inbox/sync", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mailboxId: composeMailboxId }),
      }).then(() => void loadData(folder, search, composeMailboxId, true)).catch(() => {});
    }

    // Real-time 8-second sync interval with Hostinger
    const interval = setInterval(() => {
      if (composeMailboxId && typeof document !== "undefined" && document.visibilityState === "visible") {
        void loadData(folder, search, composeMailboxId, true);
        void fetch("/api/inbox/sync", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mailboxId: composeMailboxId }),
        }).then(() => void loadData(folder, search, composeMailboxId, true)).catch(() => {});
      }
    }, 8000);

    // Fast sync when window gets focus (user returns to browser tab)
    const onWindowFocus = () => {
      if (composeMailboxId) {
        void loadData(folder, search, composeMailboxId, true);
        void fetch("/api/inbox/sync", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mailboxId: composeMailboxId }),
        }).then(() => void loadData(folder, search, composeMailboxId, true)).catch(() => {});
      }
    };
    window.addEventListener("focus", onWindowFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [folder, search, composeMailboxId]);

  // Monitor real-time background sending activity
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
            details: `All emails have been dispatched successfully and recorded in Hostinger Sent box.`,
            status: "completed",
          });
          setTimeout(() => setActiveSendingBanner(null), 6000);
        }
      } catch {
        // ignore
      }
    }
    void checkActiveSending();
    timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void checkActiveSending();
      }
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  // Sync with Hostinger IMAP
  async function handleSync() {
    if (!composeMailboxId) return;
    const currentMailbox = mailboxes.find((m) => m.id === composeMailboxId);
    try {
      setSyncing(true);
      setNotification(`Syncing ${currentMailbox?.emailAddress || "mailbox"} with Hostinger...`);
      const res = await fetch("/api/inbox/sync", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mailboxId: composeMailboxId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotification(data.error || "Sync error.");
      } else {
        setNotification(`✓ Real-time sync complete for ${currentMailbox?.emailAddress || "mailbox"}.`);
      }
      await loadData(folder, search, composeMailboxId);
    } catch {
      setNotification("Unable to reach sync service.");
    } finally {
      setSyncing(false);
      setTimeout(() => setNotification(""), 4000);
    }
  }

  // Toggle star
  function toggleStar(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setStarredIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  // Toggle select
  function toggleSelect(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  function handleSelectAll() {
    if (selectedIds.length === filteredMessages.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredMessages.map((m) => m.id));
    }
  }

  // Delete message (moves to trash or deletes permanently if already in trash)
  async function handleDelete(id: string) {
    try {
      const isAlreadyTrash = folder === "trash";
      const res = await fetch("/api/inbox", {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, permanent: isAlreadyTrash, mailboxId: composeMailboxId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete message.");
      setMessages((prev) => prev.filter((m) => m.id !== id));
      if (selectedMessage?.id === id) setSelectedMessage(null);
      setNotification(isAlreadyTrash ? "Message permanently deleted." : "Message moved to Trash.");
      setTimeout(() => setNotification(""), 3000);
      await loadData(folder, search, composeMailboxId);
    } catch {
      setNotification("Unable to delete message.");
      setTimeout(() => setNotification(""), 3000);
    }
  }

  // Restore message from trash back to inbox
  async function handleRestore(id: string) {
    try {
      const res = await fetch("/api/inbox/restore", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, mailboxId: composeMailboxId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to restore message.");
      setMessages((prev) => prev.filter((m) => m.id !== id));
      if (selectedMessage?.id === id) setSelectedMessage(null);
      setNotification("Message restored to Inbox.");
      setTimeout(() => setNotification(""), 3000);
      await loadData(folder, search, composeMailboxId);
    } catch {
      setNotification("Unable to restore message.");
      setTimeout(() => setNotification(""), 3000);
    }
  }

  // Real-time persistent mark read / unread
  async function markAsRead(id: string, read = true) {
    try {
      setReadIds((prev) => (read ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));
      const res = await fetch("/api/inbox/read", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, read, mailboxId: composeMailboxId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.counts) {
          setCounts(data.counts);
          window.dispatchEvent(new CustomEvent("mail-counts-updated", { detail: data.counts }));
        }
      }
    } catch {
      // ignore
    }
  }

  // Mark all inbox messages as read
  async function handleMarkAllAsRead() {
    try {
      const allIds = messages.map((m) => m.id);
      setReadIds(allIds);
      const res = await fetch("/api/inbox/read", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true, mailboxId: composeMailboxId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.counts) {
          setCounts(data.counts);
          window.dispatchEvent(new CustomEvent("mail-counts-updated", { detail: data.counts }));
        }
        setNotification("All inbox messages marked as read.");
        setTimeout(() => setNotification(""), 3000);
      }
    } catch {
      // ignore
    }
  }

  // Open schedule modal for draft campaign
  function handleOpenScheduleModal(campaignId: string, subjectTitle: string) {
    setScheduleTarget({ campaignId, subject: subjectTitle });
    const now = new Date();
    const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
    setScheduleDate(nextHour.toISOString().slice(0, 10));
    setScheduleTime(nextHour.toTimeString().slice(0, 5));
    setScheduleIntervalSec(60);
    setScheduleMailboxId(composeMailboxId || mailboxes[0]?.id || "");
    setScheduleModalOpen(true);
  }

  // Confirm scheduling draft campaign
  async function handleConfirmScheduleDraft() {
    if (!scheduleTarget) return;
    if (!scheduleDate || !scheduleTime) {
      alert("Please select both a valid date and time.");
      return;
    }
    setSchedulingBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${scheduleTarget.campaignId}/schedule`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "schedule",
          date: scheduleDate,
          time: scheduleTime,
          timezone: "Asia/Karachi",
          delaySeconds: scheduleIntervalSec,
          mailboxId: scheduleMailboxId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to schedule draft campaign.");
      setScheduleModalOpen(false);
      setNotification(`✓ Draft scheduled for ${scheduleDate} at ${scheduleTime} (${scheduleIntervalSec}s interval)!`);
      setTimeout(() => setNotification(""), 4000);
      setActiveSendingBanner({
        visible: true,
        title: "🕒 Campaign Scheduled",
        details: `"${scheduleTarget.subject}" is scheduled for ${scheduleDate} at ${scheduleTime} with ${scheduleIntervalSec}s spacing.`,
        status: "completed",
      });
      await loadData(folder, search);
      window.dispatchEvent(new CustomEvent("mail-counts-updated"));
    } catch (err: any) {
      alert(err.message || "Failed to schedule draft campaign.");
    } finally {
      setSchedulingBusy(false);
    }
  }

  // Direct send for real draft email
  async function handleSendDraftDirectly(msg: MailMessage) {
    if (!msg.toAddress) {
      alert("Draft has no recipient address. Click 'Edit' to add a recipient.");
      return;
    }
    const targetMailboxId = msg.mailboxId || composeMailboxId || mailboxes[0]?.id;
    if (!targetMailboxId) {
      alert("No active verified sender mailbox available.");
      return;
    }

    setNotification("Sending draft email...");
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mailboxId: targetMailboxId,
          recipient: msg.toAddress,
          subject: msg.subject || "Draft Message",
          body: msg.body || "",
          draftId: msg.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send draft.");

      // Delete the draft record now that it has been sent
      await fetch("/api/inbox", {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: msg.id, permanent: true }),
      });

      setNotification("✓ Draft email sent successfully!");
      setTimeout(() => setNotification(""), 4000);
      setSelectedMessage(null);
      await loadData(folder, search);
      window.dispatchEvent(new CustomEvent("mail-counts-updated"));
    } catch (err: any) {
      alert(err.message || "Failed to send draft.");
      setNotification("");
    }
  }

  // Real-time dispatch of draft campaign
  async function handleDispatchDraftCampaign(campaignId: string, subjectTitle?: string) {
    try {
      setNotification("Dispatching draft campaign real-time...");
      setActiveSendingBanner({
        visible: true,
        title: "⚡ Email Sending Started!",
        details: `Draft "${subjectTitle || "Campaign"}" is now actively dispatching emails through Hostinger SMTP.`,
        status: "sending",
      });
      const res = await fetch(`/api/campaigns/${campaignId}/schedule`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "sendNow" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to dispatch draft campaign.");
      setNotification(`✓ Draft campaign sent! ${data.queued ?? "Saved"} emails are now sending.`);
      setTimeout(() => setNotification(""), 4000);
      setActiveSendingBanner({
        visible: true,
        title: `⚡ Email Sending in Progress: "${subjectTitle || "Campaign"}"`,
        details: `${data.queued} emails dispatched to Hostinger SMTP. Actively sending...`,
        status: "sending",
      });
      await loadData(folder, search);
      window.dispatchEvent(new CustomEvent("mail-counts-updated"));
    } catch (err: any) {
      setNotification(err.message || "Unable to dispatch campaign.");
      setTimeout(() => setNotification(""), 4000);
      setActiveSendingBanner(null);
    }
  }

  // Empty entire trash
  async function handleEmptyTrash() {
    if (!confirm("Are you sure you want to permanently delete all messages in Trash? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/inbox", {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "__all_trash__", mailboxId: composeMailboxId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to empty trash.");
      setMessages([]);
      setSelectedMessage(null);
      setNotification("Trash emptied successfully.");
      setTimeout(() => setNotification(""), 3000);
      await loadData(folder, search, composeMailboxId);
    } catch {
      setNotification("Unable to empty trash.");
      setTimeout(() => setNotification(""), 3000);
    }
  }

  // Filter messages by tab
  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      const isStarred = starredIds.includes(msg.id);
      const isRead = readIds.includes(msg.id) || msg.status === "SENT";

      if (filter === "starred") return isStarred;
      if (filter === "unread") return !isRead;
      if (filter === "read") return isRead;
      return true;
    });
  }, [messages, filter, starredIds, readIds]);

  // Format date like 'Oct 18'
  function formatDate(isoDate?: string | null) {
    if (!isoDate) return "Oct 18";
    try {
      const d = new Date(isoDate);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return "Oct 18";
    }
  }

  // Send message in 100% real-time via Hostinger SMTP
  async function handleSend() {
    if (!composeTo.trim() || !composeSubject.trim()) {
      alert("Please fill in recipient and subject.");
      return;
    }

    const targetMailboxId = composeMailboxId || mailboxes[0]?.id;
    if (!targetMailboxId) {
      alert("Please connect and verify a Hostinger mailbox first in Mailboxes section.");
      return;
    }

    const selectedSender = mailboxes.find((m) => m.id === targetMailboxId);

    // Ensure brand name from last scheduled brand is cleanly populated if template tag remains
    const finalSubject = composeSubject
      .replace(/{{\s*brandName\s*}}/gi, lastScheduledBrand?.brandName || "Brand")
      .replace(/{{\s*brand\s*}}/gi, lastScheduledBrand?.brandName || "Brand")
      .trim();

    const finalBody = composeBody
      .replace(/{{\s*brandName\s*}}/gi, lastScheduledBrand?.brandName || "Brand")
      .replace(/{{\s*brand\s*}}/gi, lastScheduledBrand?.brandName || "Brand")
      .trim();

    setComposeSending(true);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mailboxId: targetMailboxId,
          recipient: composeTo.trim(),
          subject: finalSubject,
          body: finalBody,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        alert(result.error || "Failed to send email.");
      } else {
        alert(`✓ Email sent in real time from ${selectedSender?.emailAddress || "your mailbox"} to ${composeTo.trim()}!`);
        handleResetCompose();
        await loadData(folder, search);
      }
    } catch (err: any) {
      alert(err.message || "Sending failed.");
    } finally {
      setComposeSending(false);
    }
  }

  // AI draft generator with real-time prompt parsing
  function handleGenerateAI() {
    if (!aiPrompt.trim()) return;
    setAiGenerating(true);
    setTimeout(() => {
      const p = aiPrompt.trim().toLowerCase();
      const bName = lastScheduledBrand?.brandName || (composeTo ? composeTo.split("@")[0] : "Team");
      let subj = "";
      let body = "";

      if (p.includes("wholesale") || p.includes("partnership") || p.includes("retail") || p.includes("distribut")) {
        subj = `Wholesale Partnership Opportunity — ${bName}`;
        body = `Hi ${bName},\n\nI hope you're having a great week.\n\nI'm reaching out because we're very impressed by your product catalog and brand reputation. We manage an active retail and distribution network and are currently expanding our direct partner portfolio.\n\nWe would love to discuss opening a wholesale account with ${bName} to collaborate on mutually beneficial terms.\n\nCould you please share your latest wholesale pricing, catalog, and minimum order requirements (MOQ)?\n\nLooking forward to speaking with you.\n\nBest regards,\nDavid Lucas\nPartnership & Outreach Director`;
      } else if (p.includes("follow") || p.includes("reminder") || p.includes("update") || p.includes("check")) {
        subj = `Following up regarding our collaboration: ${bName}`;
        body = `Hi ${bName},\n\nFollowing up on our earlier note to see if you had a moment to review.\n\nI understand you must be very busy, so I'll keep this brief. We are keen to discuss a collaboration and would welcome a brief 5-minute call at your earliest convenience.\n\nLooking forward to your thoughts.\n\nWarm regards,\nDavid Lucas`;
      } else if (p.includes("order") || p.includes("price") || p.includes("quote") || p.includes("inquiry")) {
        subj = `Catalog & Pricing Inquiry: ${bName}`;
        body = `Hello ${bName},\n\nI am contacting you regarding ${aiPrompt.trim()}.\n\nCould you please provide your current price list, shipping options, and estimated lead times? We are looking to place an order shortly upon review.\n\nThank you for your assistance.\n\nBest regards,\nDavid Lucas`;
      } else {
        const capitalPrompt = aiPrompt.trim().charAt(0).toUpperCase() + aiPrompt.trim().slice(1);
        subj = `${capitalPrompt.slice(0, 48)}`;
        body = `Hi ${bName},\n\nI hope you are doing well.\n\nI'm writing regarding ${aiPrompt.trim()}.\n\nWe would love to connect and explore how we can coordinate on this effectively. Please let me know what day and time suits you best for a brief chat.\n\nBest regards,\nDavid Lucas`;
      }

      setComposeSubject(subj);
      setComposeBody(body);
      setAiGenerating(false);
      setAiModalOpen(false);
      setComposeOpen(true);
      setDraftNotice("✨ AI drafted message successfully!");
      setTimeout(() => setDraftNotice(""), 3500);
    }, 600);
  }

  // Formatting Bar helper
  function applyFormatting(prefix: string, suffix: string = prefix, placeholder: string = "") {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.slice(start, end) || placeholder;
    const replacement = `${prefix}${selected}${suffix}`;
    const newBody = text.slice(0, start) + replacement + text.slice(end);
    setComposeBody(newBody);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  }

  function handleInsertLink() {
    const url = window.prompt("Enter link URL (e.g. https://example.com):", "https://");
    if (!url) return;
    const text = window.prompt("Enter link display text (optional):", url);
    applyFormatting(`[${text || url}](`, ")", url);
  }

  function handleAttachFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type,
    }));
    if (files.length > 0) {
      setAttachments((prev) => [...prev, ...files]);
      setDraftNotice(`✓ ${files.length} file(s) attached`);
      setTimeout(() => setDraftNotice(""), 3000);
    }
    if (e.target) e.target.value = "";
  }

  function handleAttachImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type || "image/png",
    }));
    if (files.length > 0) {
      setAttachments((prev) => [...prev, ...files]);
      setDraftNotice(`✓ ${files.length} image(s) attached`);
      setTimeout(() => setDraftNotice(""), 3000);
    }
    if (e.target) e.target.value = "";
  }

  function handleInsertSignature() {
    const sig = `\n\n--\nDavid Lucas          |  📞 352-695-1331\nSales Manager        |  ✉️ sales@qayyumestore.com\nQAYYUM ESTORE        |  📍 7901 4TH ST N STE 20723`;
    if (composeBody.includes("David Lucas") && composeBody.includes("352-695-1331")) {
      setDraftNotice("Signature already in email");
      setTimeout(() => setDraftNotice(""), 2500);
      return;
    }
    setComposeBody((prev) => (prev ? prev.trimEnd() + sig : sig.trimStart()));
    setDraftNotice("✓ David Lucas signature added");
    setTimeout(() => setDraftNotice(""), 2500);
  }

  async function handleSaveDraft() {
    if (!composeTo.trim() && !composeSubject.trim() && !composeBody.trim()) {
      setDraftNotice("Cannot save empty draft");
      setTimeout(() => setDraftNotice(""), 2500);
      return;
    }
    const targetMailboxId = composeMailboxId || mailboxes[0]?.id;
    if (!targetMailboxId) {
      setDraftNotice("No active sender mailbox");
      setTimeout(() => setDraftNotice(""), 2500);
      return;
    }
    setDraftSaving(true);
    setDraftNotice("Saving draft...");
    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mailboxId: targetMailboxId,
          toAddress: composeTo.trim(),
          subject: composeSubject.trim() || "(No Subject)",
          body: composeBody,
          draftId: composeDraftId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save draft");
      if (data.draftId) setComposeDraftId(data.draftId);
      setDraftNotice("✓ Draft saved!");
      setTimeout(() => setDraftNotice(""), 3000);
      await loadData(folder, search);
      window.dispatchEvent(new CustomEvent("mail-counts-updated"));
    } catch (err: any) {
      setDraftNotice(err.message || "Failed to save draft");
      setTimeout(() => setDraftNotice(""), 3000);
    } finally {
      setDraftSaving(false);
    }
  }

  async function handleExecuteScheduleSend() {
    if (!composeTo.trim()) {
      alert("Please enter recipient email.");
      return;
    }
    if (!scheduleSendDate || !scheduleSendTime) {
      alert("Please choose a schedule date and time.");
      return;
    }
    const targetMailboxId = composeMailboxId || mailboxes[0]?.id;
    if (!targetMailboxId) {
      alert("No active sender mailbox available.");
      return;
    }
    const scheduledDateTime = `${scheduleSendDate}T${scheduleSendTime}`;
    setComposeSending(true);
    try {
      const res = await fetch("/api/scheduled/direct", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipientEmail: composeTo.trim(),
          scheduleTime: scheduledDateTime,
          subject: composeSubject.trim() || "Outreach Proposal",
          body: composeBody.trim() || "",
          mailboxId: targetMailboxId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to schedule send.");
      alert(`✓ Email scheduled for ${scheduledDateTime} to ${composeTo.trim()}!`);
      setScheduleSendModalOpen(false);
      handleResetCompose();
      await loadData(folder, search);
      window.dispatchEvent(new CustomEvent("mail-counts-updated"));
    } catch (err: any) {
      alert(err.message || "Scheduling failed.");
    } finally {
      setComposeSending(false);
    }
  }

  function handleResetCompose() {
    setComposeTo("");
    setComposeSubject("");
    setComposeBody("");
    setAttachments([]);
    setComposeDraftId(null);
    setFormatToolbarOpen(false);
    setComposePreviewMode(false);
    setScheduleMenuOpen(false);
    setTemplateMenuOpen(false);
    setDraftNotice("");
    setComposeOpen(false);
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-65px)] bg-white">
      {/* Notification Toast */}
      {notification && (
        <div className="fixed top-20 right-6 z-50 rounded-xl bg-gray-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xl animate-fade-in">
          {notification}
        </div>
      )}

      {/* Main Mailbox View */}
      <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-full">
        {/* Active Mailbox Selector & Isolation Bar (Thin Compact Line) */}
        <div className="mb-4 rounded-xl border border-gray-200/80 bg-white px-3 py-1.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2 min-h-[34px]">
            {/* Active Mailbox Dropdown Tab */}
            <div className="flex items-center gap-2 relative" ref={mailboxDropdownRef}>
              {mailboxes.length === 0 ? (
                <span className="text-xs text-amber-600 font-medium">No mailboxes connected</span>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMailboxDropdownOpen((prev) => !prev)}
                    className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-gray-50/80 hover:bg-purple-50/60 border border-gray-200 hover:border-[#673DE6]/40 text-gray-900 text-xs font-semibold transition-all cursor-pointer group"
                    title="Click to switch active mailbox"
                  >
                    <span className="flex items-center justify-center w-5 h-5 rounded-md bg-[#673DE6] text-white text-[10px] font-bold shadow-2xs shrink-0">
                      {(activeMailbox?.emailAddress || "@").charAt(0).toUpperCase()}
                    </span>

                    <span className="font-semibold text-gray-900 text-xs truncate max-w-[200px] sm:max-w-[320px]">
                      {activeMailbox?.emailAddress || "Select Mailbox"}
                    </span>

                    <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" />
                      Active
                    </span>

                    <svg
                      className={`w-3.5 h-3.5 text-gray-400 group-hover:text-gray-700 transition-transform duration-200 ml-0.5 ${
                        mailboxDropdownOpen ? "rotate-180" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Dropdown Menu displaying all connected IDs */}
                  {mailboxDropdownOpen && (
                    <div className="absolute left-0 top-full mt-1.5 w-80 sm:w-96 rounded-2xl bg-white border border-gray-200 shadow-2xl z-50 overflow-hidden animate-fade-in">
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-gray-700">
                            Switch Active Mailbox
                          </p>
                          <p className="text-[11px] text-gray-400">
                            Select an account to view its isolated Inbox &amp; Sent
                          </p>
                        </div>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-[#673DE6] border border-purple-100">
                          {mailboxes.length} connected
                        </span>
                      </div>

                      <div className="p-2 space-y-1 max-h-72 overflow-y-auto">
                        {mailboxes.map((mb) => {
                          const isActive = mb.id === composeMailboxId;
                          return (
                            <button
                              key={mb.id}
                              type="button"
                              onClick={() => {
                                handleSwitchMailbox(mb.id);
                                setMailboxDropdownOpen(false);
                              }}
                              className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition cursor-pointer ${
                                isActive
                                  ? "bg-purple-50/80 text-[#673DE6] font-semibold border border-purple-200"
                                  : "text-gray-700 hover:bg-gray-50 hover:text-gray-900 border border-transparent"
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div
                                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                                    isActive
                                      ? "bg-[#673DE6] text-white shadow-xs"
                                      : "bg-gray-100 text-gray-600"
                                  }`}
                                >
                                  {mb.emailAddress.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0 truncate">
                                  <p className="text-xs font-semibold truncate leading-tight">
                                    {mb.emailAddress}
                                  </p>
                                  <p className="text-[11px] text-gray-400 truncate mt-0.5">
                                    {mb.displayName ? `${mb.displayName} • ` : ""}Hostinger IMAP
                                  </p>
                                </div>
                              </div>

                              <div className="shrink-0 flex items-center gap-1.5">
                                {isActive ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#673DE6] bg-white px-2 py-0.5 rounded-md border border-purple-200 shadow-2xs">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    Active ✓
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-gray-400 group-hover:text-gray-600 font-medium">
                                    Select
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="px-3 py-2.5 bg-gray-50/80 border-t border-gray-100 flex items-center justify-between text-xs">
                        <Link
                          href="/mailboxes"
                          onClick={() => setMailboxDropdownOpen(false)}
                          className="text-[#673DE6] hover:text-[#5025D1] font-semibold text-[11px] flex items-center gap-1"
                        >
                          <span>⚙️</span> Manage Mailboxes
                        </Link>
                        <span className="text-[10px] text-gray-400">Isolated real-time sync</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right: Sync Hostinger Button */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing || !composeMailboxId}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-medium transition cursor-pointer shadow-2xs disabled:opacity-50"
                title="Synchronize active mailbox with Hostinger IMAP real-time"
              >
                <svg
                  className={`w-3 h-3 ${syncing ? "animate-spin text-[#673DE6]" : "text-gray-500"}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span>{syncing ? "Syncing..." : "Sync Hostinger"}</span>
              </button>
            </div>
          </div>
        </div>

        {mailboxes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 p-12 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-purple-100 text-[#673DE6] flex items-center justify-center text-xl mb-3">
              📬
            </div>
            <h3 className="text-base font-semibold text-gray-900">No Hostinger Mailbox Connected</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
              Connect your Hostinger email account in the Mailboxes section to begin sending and receiving synchronized emails.
            </p>
            <div className="mt-4">
              <a
                href="/mailboxes"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#673DE6] hover:bg-[#5025D1] text-white text-xs font-semibold transition"
              >
                Go to Mailboxes →
              </a>
            </div>
          </div>
        ) : !composeMailboxId ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 p-12 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-purple-100 text-[#673DE6] flex items-center justify-center text-xl mb-3">
              ✉️
            </div>
            <h3 className="text-base font-semibold text-gray-900">Select an Active Mailbox</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
              Please choose a connected mailbox above to view its isolated Inbox and Sent messages.
            </p>
          </div>
        ) : selectedMessage ? (
          /* Email Detail / Reading View */
          <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4 flex-wrap gap-3">
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 hover:text-black text-xs font-semibold shadow-2xs transition cursor-pointer"
                  title="Back to previous page"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  <span>Back</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedMessage(null)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition cursor-pointer"
                  title="Return to message list"
                >
                  <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  <span>Back to {folder.charAt(0).toUpperCase() + folder.slice(1)} List</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                {/* Draft Folder Actions: Edit & Send, Send Now, Discard */}
                {folder === "drafts" ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setComposeTo(selectedMessage.toAddress || "");
                        setComposeSubject(selectedMessage.subject || "");
                        setComposeBody(selectedMessage.body || "");
                        setComposeOpen(true);
                      }}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#673DE6] hover:bg-[#5025D1] text-white text-xs font-bold shadow-xs transition cursor-pointer"
                    >
                      <span>✏️</span>
                      <span>Edit &amp; Send</span>
                    </button>
                    <button
                      onClick={() => void handleSendDraftDirectly(selectedMessage)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition cursor-pointer"
                    >
                      <span>⚡</span>
                      <span>Send Now</span>
                    </button>
                    <button
                      onClick={() => void handleDelete(selectedMessage.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold cursor-pointer"
                      title="Discard draft"
                    >
                      <span>🗑️</span>
                      <span>Discard</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      void markAsRead(selectedMessage.id, false);
                      setSelectedMessage(null);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold cursor-pointer"
                    title="Mark as unread"
                  >
                    <span>✉️</span>
                    <span>Mark unread</span>
                  </button>
                )}

                <button
                  onClick={() => toggleStar({ stopPropagation: () => {} } as any, selectedMessage.id)}
                  className={`p-2 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer ${
                    starredIds.includes(selectedMessage.id) ? "text-amber-500" : "text-gray-400"
                  }`}
                  title={starredIds.includes(selectedMessage.id) ? "Unstar" : "Star"}
                >
                  <span className="text-xs">{starredIds.includes(selectedMessage.id) ? "★" : "☆"}</span>
                </button>

                {folder !== "drafts" && (
                  <button
                    onClick={() => handleDelete(selectedMessage.id)}
                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-400 hover:text-red-600 transition cursor-pointer"
                    title={folder === "trash" ? "Delete permanently" : "Move to Trash"}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
                {folder === "trash" && (
                  <button
                    onClick={() => void handleRestore(selectedMessage.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-emerald-50 text-gray-700 hover:text-emerald-700 text-xs font-semibold cursor-pointer"
                    title="Restore message to Inbox"
                  >
                    <span>↩️</span>
                    <span>Restore</span>
                  </button>
                )}
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                  {selectedMessage.subject || "(No Subject)"}
                </h1>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {formatDate(selectedMessage.receivedAt || selectedMessage.createdAt)}
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between border-b border-gray-100 pb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white font-bold text-sm flex items-center justify-center">
                    {(selectedMessage.fromAddress || "H").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {selectedMessage.fromAddress || "Unknown sender"}
                    </p>
                    <p className="text-xs text-gray-500">
                      to {selectedMessage.toAddress || selectedMessage.mailbox?.emailAddress || "me"}
                    </p>
                  </div>
                </div>
                {selectedMessage.campaign && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-50 text-[#673DE6] border border-purple-100">
                    {selectedMessage.campaign.name}
                  </span>
                )}
              </div>

              <div className="mt-6 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap font-sans min-h-[160px]">
                {selectedMessage.body}
              </div>

              {/* Quick Reply / Action Bar */}
              <div className="mt-8 pt-6 border-t border-gray-100 flex items-center gap-3">
                {folder === "drafts" ? (
                  <>
                    <button
                      onClick={() => {
                        setComposeTo(selectedMessage.toAddress || "");
                        setComposeSubject(selectedMessage.subject || "");
                        setComposeBody(selectedMessage.body || "");
                        setComposeOpen(true);
                      }}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#673DE6] text-white px-4 py-2 text-xs font-semibold hover:bg-[#5025D1] shadow-sm cursor-pointer"
                    >
                      <span>✏️</span> Edit in Composer
                    </button>
                    <button
                      onClick={() => void handleSendDraftDirectly(selectedMessage)}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-4 py-2 text-xs font-semibold hover:bg-emerald-700 shadow-sm cursor-pointer"
                    >
                      <span>⚡</span> Send Now
                    </button>
                  </>
                ) : folder === "sent" ? (
                  <>
                    <button
                      onClick={() => {
                        setComposeTo(selectedMessage.toAddress || "");
                        setComposeSubject(`Follow-up: ${selectedMessage.subject}`);
                        setComposeOpen(true);
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-sm cursor-pointer"
                    >
                      <span>✉️</span> New Email to Recipient
                    </button>
                    <button
                      onClick={() => {
                        setComposeSubject(`Fwd: ${selectedMessage.subject}`);
                        setComposeBody(
                          `\n\n---------- Forwarded message ---------\nTo: ${selectedMessage.toAddress}\nSubject: ${selectedMessage.subject}\n\n${selectedMessage.body}`
                        );
                        setComposeOpen(true);
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-sm cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                      Forward
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setComposeTo(selectedMessage.fromAddress || "");
                        setComposeSubject(`Re: ${selectedMessage.subject}`);
                        setComposeOpen(true);
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-sm cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                      Reply
                    </button>
                    <button
                      onClick={() => {
                        setComposeSubject(`Fwd: ${selectedMessage.subject}`);
                        setComposeBody(
                          `\n\n---------- Forwarded message ---------\nFrom: ${selectedMessage.fromAddress}\nSubject: ${selectedMessage.subject}\n\n${selectedMessage.body}`
                        );
                        setComposeOpen(true);
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-sm cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                      Forward
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Normal List View */
          <div>
            {/* Header: Title & Pagination */}
            <div className="flex items-center justify-between pb-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 hover:text-black text-xs font-semibold shadow-2xs transition cursor-pointer"
                  title="Back to previous page"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  <span>Back</span>
                </button>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900 capitalize">
                  {folder}
                </h1>
              </div>

              <div className="flex items-center gap-4 text-gray-500">
                {/* Sort icon */}
                <button
                  onClick={() => setMessages((prev) => [...prev].reverse())}
                  className="p-1 hover:text-black transition"
                  title="Reverse sort order"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M6 12h12M10 17h4" />
                  </svg>
                </button>

                {/* Pagination */}
                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                  <button className="p-1 hover:text-black disabled:opacity-30" disabled>
                    ‹
                  </button>
                  <span>1 / 1</span>
                  <button className="p-1 hover:text-black disabled:opacity-30" disabled>
                    ›
                  </button>
                </div>
              </div>
            </div>

            {/* Filter Pills Bar */}
            <div className="flex items-center gap-2 sm:gap-3 py-2 flex-wrap">
              <div className="flex items-center gap-1 mr-2">
                <input
                  type="checkbox"
                  checked={filteredMessages.length > 0 && selectedIds.length === filteredMessages.length}
                  onChange={handleSelectAll}
                  className="w-4 h-4 rounded border-gray-300 text-[#673DE6] focus:ring-[#673DE6] cursor-pointer"
                />
                <span className="text-gray-400 text-xs">⌵</span>
              </div>

              <button
                onClick={() => setFilter("all")}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                  filter === "all"
                    ? "bg-[#18181B] text-white"
                    : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                All mail
              </button>

              <button
                onClick={() => setFilter("unread")}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                  filter === "unread"
                    ? "bg-[#18181B] text-white"
                    : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                Unread
              </button>

              <button
                onClick={() => setFilter("read")}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                  filter === "read"
                    ? "bg-[#18181B] text-white"
                    : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                Read
              </button>

              <button
                onClick={() => setFilter("starred")}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                  filter === "starred"
                    ? "bg-[#18181B] text-white"
                    : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                Starred
              </button>

              {folder === "trash" && filteredMessages.length > 0 && (
                <button
                  onClick={() => void handleEmptyTrash()}
                  className="ml-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition border border-red-200"
                >
                  <span>🗑️</span>
                  <span>Empty Trash ({filteredMessages.length})</span>
                </button>
              )}

              {/* Mark all as read button for Inbox */}
              {folder === "inbox" && counts.inbox > 0 && (
                <button
                  onClick={() => void handleMarkAllAsRead()}
                  className="ml-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold text-[#673DE6] bg-purple-50 hover:bg-purple-100 transition border border-purple-200"
                  title="Mark all inbox messages as read"
                >
                  <span>✓✓</span>
                  <span>Mark all as read</span>
                </button>
              )}

              {/* Bulk actions when messages are selected */}
              {selectedIds.length > 0 && (
                <div className="ml-auto flex items-center gap-1.5 bg-gray-50 border border-gray-200 px-3 py-1 rounded-full">
                  <span className="text-[11px] font-bold text-gray-700">{selectedIds.length} selected:</span>
                  <button
                    onClick={() => {
                      for (const id of selectedIds) void markAsRead(id, true);
                      setSelectedIds([]);
                    }}
                    className="text-xs font-semibold text-purple-700 hover:underline px-1.5"
                  >
                    Mark read
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={() => {
                      for (const id of selectedIds) void markAsRead(id, false);
                      setSelectedIds([]);
                    }}
                    className="text-xs font-semibold text-gray-700 hover:underline px-1.5"
                  >
                    Mark unread
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={() => {
                      for (const id of selectedIds) void handleDelete(id);
                      setSelectedIds([]);
                    }}
                    className="text-xs font-semibold text-red-600 hover:underline px-1.5"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            {/* Real-time Email Sending Status Indicator */}
            {activeSendingBanner && (
              <div
                className={`mt-3 p-3.5 rounded-2xl border shadow-sm transition-all flex items-center justify-between gap-3 ${
                  activeSendingBanner.status === "sending"
                    ? "bg-purple-50/90 border-purple-200 text-purple-950"
                    : "bg-emerald-50/90 border-emerald-200 text-emerald-950"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3 w-3 shrink-0">
                    {activeSendingBanner.status === "sending" && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                    )}
                    <span
                      className={`relative inline-flex rounded-full h-3 w-3 ${
                        activeSendingBanner.status === "sending" ? "bg-[#673DE6]" : "bg-emerald-500"
                      }`}
                    ></span>
                  </span>
                  <div>
                    <p className="text-xs font-bold flex items-center gap-2">
                      {activeSendingBanner.title}
                      {activeSendingBanner.status === "sending" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#673DE6] text-white">
                          <span className="animate-spin inline-block h-2.5 w-2.5 border-2 border-white border-t-transparent rounded-full"></span>
                          Sending Active
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-gray-600 mt-0.5">{activeSendingBanner.details}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSendingBanner(null)}
                  className="text-gray-400 hover:text-gray-700 text-xs px-2 py-1 rounded cursor-pointer"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Promotional Banner: Connect your inbox to ChatGPT */}
            {bannerVisible && (
              <div className="mt-3 flex items-center justify-between rounded-2xl bg-[#F4EFFE] border border-[#E3D3FC] p-3 sm:p-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#18181B] flex items-center justify-center shrink-0">
                    {/* OpenAI / ChatGPT logo */}
                    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1683a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4947zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464z" />
                    </svg>
                  </div>
                  <p className="text-xs sm:text-sm text-gray-800">
                    <span className="font-semibold text-gray-900">Connect your inbox to ChatGPT.</span>{" "}
                    Draft, summarize, and reply smarter.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setAiModalOpen(true)}
                    className="rounded-xl bg-[#673DE6] hover:bg-[#5025D1] px-4 py-2 text-xs font-semibold text-white shadow-sm transition"
                  >
                    Try it
                  </button>
                  <button
                    onClick={() => setBannerVisible(false)}
                    className="text-gray-400 hover:text-gray-600 text-sm p-1"
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Email List Table */}
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-100 bg-white">
              {loading && messages.length === 0 ? (
                <div className="divide-y divide-gray-100 p-2 space-y-2 animate-pulse">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                      <div className="w-4 h-4 bg-gray-200 rounded shrink-0"></div>
                      <div className="w-4 h-4 bg-gray-200 rounded shrink-0"></div>
                      <div className="w-32 sm:w-40 h-3.5 bg-gray-200 rounded shrink-0"></div>
                      <div className="flex-1 h-3.5 bg-gray-100 rounded"></div>
                      <div className="w-12 h-3 bg-gray-200 rounded shrink-0"></div>
                    </div>
                  ))}
                </div>
              ) : filteredMessages.length === 0 ? (
                <div className="p-16 text-center">
                  <div className="w-12 h-12 mx-auto rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-3">
                    ✉️
                  </div>
                  <p className="text-sm font-semibold text-gray-800">No messages in {folder}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {folder === "inbox"
                      ? "Click 'Sync' in the sidebar to check your connected Hostinger mailboxes."
                      : "No items found."}
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <button
                      onClick={handleSync}
                      className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      {syncing ? "Syncing..." : "Sync Inbox"}
                    </button>
                    <button
                      onClick={() => setComposeOpen(true)}
                      className="rounded-xl bg-[#673DE6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#5025D1]"
                    >
                      Compose Email
                    </button>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredMessages.map((msg) => {
                    const isStarred = starredIds.includes(msg.id);
                    const isSelected = selectedIds.includes(msg.id);
                    const isUnread = !readIds.includes(msg.id) && msg.status !== "SENT";

                    return (
                      <div
                        key={msg.id}
                        onClick={() => {
                          if (!readIds.includes(msg.id)) {
                            void markAsRead(msg.id, true);
                          }
                          setSelectedMessage(msg);
                        }}
                        className={`group flex items-center gap-3 px-4 py-3.5 hover:bg-[#F8F9FA] transition cursor-pointer ${
                          isSelected ? "bg-purple-50/50" : ""
                        }`}
                      >
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleSelect(e as any, msg.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 rounded border-gray-300 text-[#673DE6] focus:ring-[#673DE6] cursor-pointer"
                        />

                        {/* Star Icon */}
                        <button
                          onClick={(e) => toggleStar(e, msg.id)}
                          className={`text-base hover:scale-110 transition ${
                            isStarred ? "text-amber-400" : "text-gray-300 hover:text-gray-500"
                          }`}
                        >
                          {isStarred ? "★" : "☆"}
                        </button>

                        {/* Sender / Recipient */}
                        <div className="w-40 sm:w-56 shrink-0 truncate">
                          <span
                            className={`text-sm tracking-tight ${
                              isUnread ? "font-bold text-gray-900" : "font-normal text-gray-700"
                            }`}
                          >
                            {folder === "drafts" ? (
                              <span className="text-[#673DE6] font-semibold">
                                Draft: {msg.toAddress || "(No recipient)"}
                              </span>
                            ) : folder === "sent" ? (
                              <span className="text-gray-700 font-medium">To: {msg.toAddress || "(No recipient)"}</span>
                            ) : (
                              msg.fromAddress || msg.contact?.fullName || msg.contact?.name || "Unknown Sender"
                            )}
                          </span>
                        </div>

                        {/* Unread Purple Dot Indicator */}
                        <div className="w-3 flex items-center justify-center shrink-0">
                          {isUnread && <span className="w-2 h-2 rounded-full bg-[#673DE6]" />}
                        </div>

                        {/* Subject & Preview */}
                        <div className="flex-1 min-w-0 truncate text-sm">
                          <span
                            className={`tracking-tight ${
                              isUnread ? "font-bold text-gray-900" : "font-normal text-gray-700"
                            }`}
                          >
                            {msg.subject || "(No Subject)"}
                          </span>
                          <span className="text-gray-400 ml-2 font-normal hidden md:inline">
                            - {msg.body?.slice(0, 60)}
                          </span>
                        </div>

                        {/* Real Draft Email Action Buttons */}
                        {folder === "drafts" && (
                          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => {
                                setComposeTo(msg.toAddress || "");
                                setComposeSubject(msg.subject || "");
                                setComposeBody(msg.body || "");
                                setComposeOpen(true);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-[#673DE6] hover:bg-[#5025D1] text-white text-xs font-bold shadow-2xs transition flex items-center gap-1 cursor-pointer"
                              title="Edit draft in composer"
                            >
                              <span>✏️</span> Edit
                            </button>
                            <button
                              onClick={() => void handleSendDraftDirectly(msg)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-2xs transition flex items-center gap-1 cursor-pointer"
                              title="Send draft now"
                            >
                              <span>⚡</span> Send
                            </button>
                            <button
                              onClick={() => void handleDelete(msg.id)}
                              className="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold border border-red-200 transition cursor-pointer"
                              title="Delete draft"
                            >
                              🗑️
                            </button>
                          </div>
                        )}

                        {/* Date */}
                        <div className="shrink-0 text-right w-16">
                          <span className="text-xs text-gray-500 font-medium">
                            {formatDate(msg.receivedAt || msg.createdAt)}
                          </span>
                        </div>

                        {/* Quick hover action (read/unread toggle / restore / delete) */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                          {folder !== "drafts" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void markAsRead(msg.id, !readIds.includes(msg.id));
                              }}
                              className="p-1 text-gray-400 hover:text-[#673DE6] transition cursor-pointer"
                              title={readIds.includes(msg.id) ? "Mark as unread" : "Mark as read"}
                            >
                              <span className="text-xs">{readIds.includes(msg.id) ? "✉️" : "📭"}</span>
                            </button>
                          )}
                          {folder === "trash" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleRestore(msg.id);
                              }}
                              className="p-1 text-gray-500 hover:text-emerald-600 transition"
                              title="Restore message to Inbox"
                            >
                              <span className="text-sm">↩️</span>
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDelete(msg.id);
                            }}
                            className="p-1 text-gray-400 hover:text-red-600 transition"
                            title={folder === "trash" ? "Delete permanently" : "Move to Trash"}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Floating Compose Dialog */}
      {composeOpen && (
        <div className="fixed bottom-4 right-4 sm:right-6 w-[640px] max-w-[96vw] rounded-2xl bg-white shadow-2xl border border-gray-200 z-50 overflow-hidden flex flex-col animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between bg-[#18181B] px-5 py-3 text-white">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tracking-wide">New message</span>
              {composeDraftId && (
                <span className="text-[10px] bg-purple-500/30 text-purple-200 px-2 py-0.5 rounded-full font-mono">
                  Draft saved
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-gray-400">
              <button
                onClick={handleResetCompose}
                className="hover:text-white text-base leading-none p-1 transition cursor-pointer"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Form Fields */}
          <div className="p-4 space-y-2.5 max-h-[75vh] overflow-y-auto">
            {/* From: Clean Hostinger Sender Row (Same like Hostinger Webmail) */}
            <div className="flex items-center border-b border-gray-100 pb-2 gap-2 text-xs sm:text-sm">
              <span className="text-gray-500 font-semibold w-12 shrink-0">From:</span>
              <div className="flex-1 flex items-center justify-between gap-2 min-w-0">
                <select
                  value={composeMailboxId}
                  onChange={(e) => handleSwitchMailbox(e.target.value)}
                  className="bg-transparent font-medium text-gray-900 focus:outline-none cursor-pointer w-full truncate py-0.5 text-xs sm:text-sm hover:text-[#673DE6] transition-colors"
                >
                  {mailboxes.map((mb) => {
                    const disp = mb.displayName || "";
                    return (
                      <option key={mb.id} value={mb.id} className="text-gray-900 font-medium">
                        {disp ? `${disp} <${mb.emailAddress}>` : mb.emailAddress} {mb.smtpStatus === "CONNECTED" ? "✓" : ""}
                      </option>
                    );
                  })}
                </select>
                <span
                  className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200"
                  title="Real-time Active Hostinger Mailbox"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active
                </span>
              </div>
            </div>

            {/* Quick 1-click pills if user has multiple Hostinger accounts */}
            {mailboxes.length > 1 && (
              <div className="flex items-center gap-1.5 pt-0.5 text-[11px]">
                <span className="text-gray-400 font-medium shrink-0">Switch:</span>
                <div className="flex flex-wrap gap-1">
                  {mailboxes.map((mb) => {
                    const isSelected = mb.id === composeMailboxId;
                    return (
                      <button
                        key={mb.id}
                        type="button"
                        onClick={() => handleSwitchMailbox(mb.id)}
                        className={`px-2 py-0.5 rounded-md text-[11px] transition font-medium cursor-pointer ${
                          isSelected
                            ? "bg-[#673DE6] text-white font-bold shadow-xs"
                            : "bg-gray-100 text-gray-700 hover:bg-purple-50 hover:text-[#673DE6] border border-gray-200/60"
                        }`}
                      >
                        {mb.displayName || mb.emailAddress.split("@")[0]}
                        {isSelected ? " ✓" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* To: Recipient Email Row */}
            <div className="flex items-center border-b border-gray-100 py-2 gap-2 text-xs sm:text-sm">
              <span className="text-gray-500 font-semibold w-12 shrink-0">To:</span>
              <div className="flex-1 flex items-center justify-between gap-2 min-w-0">
                <input
                  type="email"
                  placeholder="recipient@example.com"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  className="w-full bg-transparent text-xs sm:text-sm focus:outline-none placeholder-gray-400 font-medium text-gray-900"
                />
                {composeTo && composeTo.includes("@") && (
                  <span className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-[#673DE6] bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md">
                    <span>📧</span> {composeTo}
                  </span>
                )}
              </div>
            </div>

            {/* Auto-update Brand from Last Scheduled Brand Banner */}
            {lastScheduledBrand && (
              <div className="flex items-center justify-between bg-purple-50/60 border border-purple-100/80 px-2.5 py-1.5 rounded-xl text-xs">
                <div className="flex items-center gap-1.5 min-w-0 truncate">
                  <span className="text-purple-600 font-bold shrink-0">🎯 Last Scheduled Brand:</span>
                  <span className="font-bold text-gray-900 truncate">{lastScheduledBrand.brandName}</span>
                  {lastScheduledBrand.email && (
                    <span className="text-gray-500 font-mono text-[10px] hidden sm:inline">
                      &lt;{lastScheduledBrand.email}&gt;
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleUseScheduledBrand}
                  className="shrink-0 text-[11px] font-bold text-[#673DE6] hover:text-[#5025D1] bg-white border border-purple-200 px-2 py-0.5 rounded-md shadow-2xs hover:bg-purple-50 cursor-pointer ml-2 transition"
                >
                  ⚡ Auto-fill Template & Recipient
                </button>
              </div>
            )}

            {/* Subject */}
            <div className="flex items-center border-b border-gray-100 py-1.5 gap-2 text-xs sm:text-sm">
              <span className="text-gray-500 font-semibold w-12 shrink-0">Subject:</span>
              <input
                type="text"
                placeholder="Email Subject"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                className="w-full bg-transparent text-xs sm:text-sm focus:outline-none placeholder-gray-400 font-medium text-gray-900"
              />
            </div>

            {/* Formatting Toolbar Strip (toggled by 'A' icon) */}
            {formatToolbarOpen && !composePreviewMode && (
              <div className="flex items-center flex-wrap gap-1 bg-gray-50 p-1.5 rounded-xl border border-gray-200 animate-in fade-in duration-100">
                <button
                  type="button"
                  onClick={() => applyFormatting("**", "**", "bold text")}
                  className="px-2 py-1 text-xs font-extrabold text-gray-700 hover:bg-white rounded-lg hover:shadow-2xs transition"
                  title="Bold (**text**)"
                >
                  B
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("*", "*", "italic text")}
                  className="px-2 py-1 text-xs italic font-serif text-gray-700 hover:bg-white rounded-lg hover:shadow-2xs transition"
                  title="Italic (*text*)"
                >
                  I
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("<u>", "</u>", "underlined text")}
                  className="px-2 py-1 text-xs underline text-gray-700 hover:bg-white rounded-lg hover:shadow-2xs transition"
                  title="Underline"
                >
                  U
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("~~", "~~", "strikethrough text")}
                  className="px-2 py-1 text-xs line-through text-gray-700 hover:bg-white rounded-lg hover:shadow-2xs transition"
                  title="Strikethrough"
                >
                  S
                </button>
                <div className="w-px h-4 bg-gray-300 mx-0.5" />
                <button
                  type="button"
                  onClick={() => applyFormatting("# ", "", "Heading 1")}
                  className="px-2 py-1 text-[11px] font-bold text-gray-700 hover:bg-white rounded-lg hover:shadow-2xs transition"
                  title="Heading 1"
                >
                  H1
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("## ", "", "Heading 2")}
                  className="px-2 py-1 text-[11px] font-bold text-gray-700 hover:bg-white rounded-lg hover:shadow-2xs transition"
                  title="Heading 2"
                >
                  H2
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("- ", "", "List item")}
                  className="px-2 py-1 text-xs text-gray-700 hover:bg-white rounded-lg hover:shadow-2xs transition"
                  title="Bullet list"
                >
                  • List
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("1. ", "", "List item")}
                  className="px-2 py-1 text-xs text-gray-700 hover:bg-white rounded-lg hover:shadow-2xs transition"
                  title="Numbered list"
                >
                  1. List
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("> ", "", "Quote text")}
                  className="px-2 py-1 text-xs text-gray-700 hover:bg-white rounded-lg hover:shadow-2xs transition"
                  title="Quote"
                >
                  &ldquo;
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("`", "`", "code")}
                  className="px-2 py-1 text-xs font-mono text-gray-700 hover:bg-white rounded-lg hover:shadow-2xs transition"
                  title="Code snippet"
                >
                  &lt;/&gt;
                </button>
              </div>
            )}

            {/* Email Body / Live Preview */}
            {composePreviewMode ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-purple-700 bg-purple-50 px-3 py-1.5 rounded-lg border border-purple-200">
                  <span className="font-bold flex items-center gap-1.5">
                    <span>👁️</span> Recipient Brand Live View (Exact HTML &amp; Signature Layout)
                  </span>
                  <button
                    type="button"
                    onClick={() => setComposePreviewMode(false)}
                    className="text-xs font-bold text-[#673DE6] hover:underline cursor-pointer"
                  >
                    Edit message &rarr;
                  </button>
                </div>
                <div
                  className="p-4 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm text-gray-900 leading-relaxed font-sans shadow-2xs overflow-x-auto min-h-[180px] max-h-[300px]"
                  dangerouslySetInnerHTML={{
                    __html: formatEmailBodyToHtml(
                      renderTemplate(composeBody, {
                        brandName: lastScheduledBrand?.brandName || "Brand Name",
                        productCategory: lastScheduledBrand?.category || "Product Category",
                        email: composeTo || "recipient@example.com",
                      })
                    ),
                  }}
                />
              </div>
            ) : (
              <div>
                <textarea
                  ref={textareaRef}
                  placeholder="Write your email here... (Supports **bold**, dynamic tags like {{brandName}}, and 2-column signature)"
                  rows={9}
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  className="w-full text-xs sm:text-sm resize-none focus:outline-none placeholder-gray-400 leading-relaxed pt-1 font-sans"
                />
              </div>
            )}

            {/* Attachments Chip List */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100">
                {attachments.map((att, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-gray-200 shadow-2xs transition"
                  >
                    <span>{att.type?.startsWith("image/") ? "🖼️" : "📎"}</span>
                    <span className="truncate max-w-[140px] font-mono">{att.name}</span>
                    <span className="text-[10px] text-gray-500">({Math.round(att.size / 1024)} KB)</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-gray-400 hover:text-red-500 ml-1 font-bold cursor-pointer"
                      title="Remove attachment"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Notification / Status bar inside Compose */}
            {draftNotice && (
              <div className="text-[11px] font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-200 flex items-center justify-between animate-in fade-in">
                <span>{draftNotice}</span>
                <button
                  type="button"
                  onClick={() => setDraftNotice("")}
                  className="text-purple-400 hover:text-purple-800 ml-2 text-xs"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Hidden File Inputs for Attachments and Images */}
          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={handleAttachFiles}
            className="hidden"
          />
          <input
            type="file"
            accept="image/*"
            multiple
            ref={imageInputRef}
            onChange={handleAttachImages}
            className="hidden"
          />

          {/* Real-time Hostinger AI Message Prompt Bar (Matches Hostinger Webmail) */}
          {showAiPromptBar && (
            <div className="px-4 pb-2.5">
              <div className="rounded-full bg-gradient-to-r from-pink-500 via-purple-500 to-sky-400 p-[1.5px] shadow-sm">
                <div className="flex items-center gap-3 bg-white rounded-full px-4 py-2">
                  {/* Wand with Sparkles Icon */}
                  <svg className="w-5 h-5 text-gray-700 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.091zM18.25 12l.406 1.423a2.25 2.25 0 001.545 1.545L21.75 15l-1.549.406a2.25 2.25 0 00-1.545 1.545L18.25 18.25l-.406-1.549a2.25 2.25 0 00-1.545-1.545L14.75 15l1.549-.406a2.25 2.25 0 001.545-1.545L18.25 12z" />
                  </svg>

                  <input
                    ref={aiInputRef}
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleGenerateAI();
                      }
                    }}
                    placeholder="Ask AI to draft a message"
                    className="flex-1 bg-transparent text-xs sm:text-sm text-gray-900 placeholder-gray-500 focus:outline-none"
                  />

                  {/* Up-arrow Submit Button */}
                  <button
                    type="button"
                    onClick={handleGenerateAI}
                    disabled={aiGenerating || !aiPrompt.trim()}
                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition ${
                      aiPrompt.trim()
                        ? "bg-gray-800 hover:bg-black text-white shadow-xs cursor-pointer"
                        : "bg-gray-200 text-gray-400 cursor-not-allowed"
                    }`}
                    title="Generate draft with AI"
                  >
                    {aiGenerating ? (
                      <svg className="w-3.5 h-3.5 animate-spin text-purple-600" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Bar: Exact Hostinger Webmail Compose Toolbar Layout */}
          <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50/80 px-4 py-2.5">
            {/* Left Controls: Send [v], AI, Formatting, Attach, Link, Image | Preview, Template, Signature */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* 1. Send Split Button with Caret Dropdown [ Send | ⌵ ] */}
              <div className="relative inline-flex items-center rounded-xl bg-[#673DE6] text-white shadow-xs" ref={scheduleMenuRef}>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={composeSending}
                  className="px-4 py-2 text-xs font-bold hover:bg-[#5025D1] rounded-l-xl transition disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                  title="Send in real time now"
                >
                  <span>{composeSending ? "Sending..." : "Send"}</span>
                </button>
                <div className="w-px h-5 bg-white/25" />
                <button
                  type="button"
                  onClick={() => setScheduleMenuOpen(!scheduleMenuOpen)}
                  className="px-2 py-2 text-xs hover:bg-[#5025D1] rounded-r-xl transition flex items-center justify-center cursor-pointer"
                  title="Send options (Schedule send)"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>

                {/* Dropdown for Send Options */}
                {scheduleMenuOpen && (
                  <div className="absolute bottom-11 left-0 w-44 bg-white rounded-2xl shadow-xl border border-gray-200 py-1.5 z-50 animate-in fade-in zoom-in-95 text-gray-800">
                    <button
                      type="button"
                      onClick={() => {
                        setScheduleMenuOpen(false);
                        void handleSend();
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-bold hover:bg-purple-50 hover:text-[#673DE6] flex items-center gap-2 cursor-pointer"
                    >
                      <span>🚀</span> Send Now
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setScheduleMenuOpen(false);
                        const tom = new Date();
                        tom.setDate(tom.getDate() + 1);
                        setScheduleSendDate(tom.toISOString().split("T")[0]);
                        setScheduleSendTime("10:00");
                        setScheduleSendModalOpen(true);
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-bold hover:bg-purple-50 hover:text-[#673DE6] flex items-center gap-2 cursor-pointer"
                    >
                      <span>⏰</span> Schedule Send
                    </button>
                  </div>
                )}
              </div>

              {/* 2. AI Assistant Icon (🪄) */}
              <button
                type="button"
                onClick={() => {
                  setShowAiPromptBar((prev) => !prev);
                  setTimeout(() => aiInputRef.current?.focus(), 50);
                }}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition border cursor-pointer shadow-2xs ${
                  showAiPromptBar
                    ? "bg-purple-100 text-[#673DE6] border-purple-300"
                    : "bg-purple-50 text-[#673DE6] hover:bg-purple-100 border-purple-200/60"
                }`}
                title="Toggle AI Draft bar (🪄)"
              >
                <svg className="w-4 h-4 text-[#673DE6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.091zM18.25 12l.406 1.423a2.25 2.25 0 001.545 1.545L21.75 15l-1.549.406a2.25 2.25 0 00-1.545 1.545L18.25 18.25l-.406-1.549a2.25 2.25 0 00-1.545-1.545L14.75 15l1.549-.406a2.25 2.25 0 001.545-1.545L18.25 12z" />
                </svg>
              </button>

              {/* 3. Formatting Toolbar Toggle Icon (A_) */}
              <button
                type="button"
                onClick={() => setFormatToolbarOpen(!formatToolbarOpen)}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer ${
                  formatToolbarOpen ? "bg-purple-100 text-[#673DE6] font-bold border border-purple-200" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
                title="Formatting options (Bold, Italic, Lists)"
              >
                <span className="font-serif font-bold text-sm underline underline-offset-4 decoration-2">A</span>
              </button>

              {/* 4. Attach Files (📎) */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-8 h-8 rounded-xl text-gray-600 hover:bg-gray-100 hover:text-gray-900 flex items-center justify-center transition cursor-pointer"
                title="Attach files (📎)"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>

              {/* 5. Insert Link (🔗) */}
              <button
                type="button"
                onClick={handleInsertLink}
                className="w-8 h-8 rounded-xl text-gray-600 hover:bg-gray-100 hover:text-gray-900 flex items-center justify-center transition cursor-pointer"
                title="Insert link (🔗)"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </button>

              {/* 6. Insert Image (🖼️) */}
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="w-8 h-8 rounded-xl text-gray-600 hover:bg-gray-100 hover:text-gray-900 flex items-center justify-center transition cursor-pointer"
                title="Insert image (🖼️)"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>

              {/* 7. Divider (|) */}
              <div className="w-px h-5 bg-gray-300 mx-0.5" />

              {/* 8. Live Preview Mode Toggle (👁) */}
              <button
                type="button"
                onClick={() => setComposePreviewMode(!composePreviewMode)}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer ${
                  composePreviewMode ? "bg-purple-100 text-[#673DE6] border border-purple-200" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
                title={composePreviewMode ? "Switch back to Edit mode" : "Live Preview Brand View (👁)"}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>

              {/* 9. Saved Templates Menu (📄) */}
              <div className="relative" ref={templateMenuRef}>
                <button
                  type="button"
                  onClick={() => setTemplateMenuOpen(!templateMenuOpen)}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer ${
                    templateMenuOpen ? "bg-purple-100 text-[#673DE6] border border-purple-200" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                  title="Insert Template (📄)"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </button>

                {/* Templates Popup Menu */}
                {templateMenuOpen && (
                  <div className="absolute bottom-11 left-0 w-64 bg-white rounded-2xl shadow-xl border border-gray-200 p-2 z-50 animate-in fade-in zoom-in-95 text-gray-800">
                    <div className="text-[10px] font-bold text-gray-500 uppercase px-2.5 py-1 tracking-wider">
                      Select Template to Apply
                    </div>
                    <div className="space-y-1 max-h-52 overflow-y-auto">
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            handleApplyTemplate(t.id);
                            setTemplateMenuOpen(false);
                            setDraftNotice(`✓ Applied template "${t.name}"`);
                            setTimeout(() => setDraftNotice(""), 3000);
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-purple-50 text-xs font-semibold hover:text-[#673DE6] flex items-center justify-between transition cursor-pointer"
                        >
                          <span className="truncate">{t.name}</span>
                          {t.isDefault && (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                              Active
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 10. Insert David Lucas Signature (✍️) */}
              <button
                type="button"
                onClick={handleInsertSignature}
                className="w-8 h-8 rounded-xl text-gray-600 hover:bg-purple-50 hover:text-[#673DE6] flex items-center justify-center transition cursor-pointer"
                title="Insert David Lucas 2-Column Signature (✍️)"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                </svg>
              </button>
            </div>

            {/* Right Controls: Save Draft & Discard Trash Icon */}
            <div className="flex items-center gap-2">
              {/* 11. Save Draft Text Button */}
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={draftSaving}
                className="text-xs font-semibold text-gray-600 hover:text-gray-900 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition cursor-pointer disabled:opacity-50"
                title="Save draft to Drafts folder"
              >
                {draftSaving ? "Saving..." : "Save draft"}
              </button>

              {/* 12. Discard / Trash Button */}
              <button
                type="button"
                onClick={handleResetCompose}
                className="w-8 h-8 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition cursor-pointer"
                title="Discard draft"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Send Modal */}
      {scheduleSendModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-purple-100 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-lg">⏰</span>
                <h3 className="text-sm font-bold text-gray-900">Schedule Email Send</h3>
              </div>
              <button
                onClick={() => setScheduleSendModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-sm p-1 rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">To Recipient:</label>
                <div className="p-2 bg-gray-50 rounded-xl border border-gray-200 font-mono font-semibold text-gray-900">
                  {composeTo || "(Please enter recipient in composer)"}
                </div>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Schedule Date:</label>
                <input
                  type="date"
                  required
                  value={scheduleSendDate}
                  onChange={(e) => setScheduleSendDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none font-medium"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Schedule Time:</label>
                <input
                  type="time"
                  required
                  value={scheduleSendTime}
                  onChange={(e) => setScheduleSendTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none font-medium"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-100 mt-5">
              <button
                type="button"
                onClick={() => setScheduleSendModalOpen(false)}
                className="px-3.5 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteScheduleSend}
                disabled={composeSending || !composeTo.trim()}
                className="px-4 py-2 text-xs font-bold text-white bg-[#673DE6] hover:bg-[#5025D1] rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer"
              >
                {composeSending ? "Scheduling..." : "Schedule & Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ask AI Modal */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-gray-100">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#18181B] text-white flex items-center justify-center text-xs font-bold">
                  AI
                </div>
                <h3 className="text-base font-bold text-gray-900">Hostinger AI Assistant</h3>
              </div>
              <button onClick={() => setAiModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-700 mb-2">
                What do you want this email to say?
              </label>
              <textarea
                rows={4}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. Write a friendly outreach follow-up for a marketing collaboration offering a 20% discount..."
                className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:border-[#673DE6] focus:outline-none focus:ring-1 focus:ring-[#673DE6]"
              />
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setAiModalOpen(false)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateAI}
                disabled={aiGenerating || !aiPrompt.trim()}
                className="rounded-xl bg-[#673DE6] hover:bg-[#5025D1] px-5 py-2 text-xs font-semibold text-white transition disabled:opacity-50"
              >
                {aiGenerating ? "Generating..." : "Generate Draft"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Draft Campaign Modal */}
      {scheduleModalOpen && scheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-gray-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-gradient-to-r from-blue-50 via-white to-purple-50 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="p-2 bg-blue-600 text-white rounded-xl text-base leading-none">
                  🕒
                </span>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Schedule Draft Send</h3>
                  <p className="text-[11px] text-gray-500">Pick date, time & interval for {scheduleTarget.subject}</p>
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
                  <span className="font-bold text-gray-800">Draft Campaign:</span>
                  <span className="ml-1 text-blue-700 font-bold truncate max-w-[180px] inline-block align-bottom">
                    {scheduleTarget.subject}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500 font-medium">Asia/Karachi (PKT)</div>
              </div>

              {/* Sender Mailbox */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Sender Hostinger Mailbox</label>
                <select
                  value={scheduleMailboxId}
                  onChange={(e) => setScheduleMailboxId(e.target.value)}
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
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Send Time</label>
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
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
                  value={scheduleIntervalSec}
                  onChange={(e) => setScheduleIntervalSec(Number(e.target.value))}
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
                  Automatically spaces out outgoing emails to prevent SMTP rate-limiting.
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
    </div>
  );
}
