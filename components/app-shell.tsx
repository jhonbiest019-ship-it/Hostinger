"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { formatEmailBodyToHtml, renderTemplate } from "@/lib/email/template";

interface MailFolderItem {
  name: string;
  href: string;
  folderKey?: string;
  icon: React.ReactNode;
  badge?: string;
  hasSync?: boolean;
}

interface WorkspaceToolItem {
  name: string;
  href: string;
  icon: string;
}

function SidebarNav({
  mailFolders,
  workspaceTools,
  pathname,
  onNavigate,
  onRefresh,
}: {
  mailFolders: MailFolderItem[];
  workspaceTools: WorkspaceToolItem[];
  pathname: string;
  onNavigate: () => void;
  onRefresh: () => void;
}) {
  const [folderParam, setFolderParam] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("folder");
      setFolderParam(p);
    }
  }, [pathname]);

  return (
    <>
      {/* Mailbox Folders Navigation */}
      <nav className="space-y-1">
        {mailFolders.map((item) => {
          let isActive = false;
          if (item.folderKey === "inbox") {
            isActive = (pathname === "/dashboard" || pathname === "/inbox") && (!folderParam || folderParam === "inbox");
          } else if (item.folderKey) {
            isActive = (pathname === "/dashboard" || pathname === "/inbox") && folderParam === item.folderKey;
          } else if (item.href === "/email-logs") {
            isActive = pathname === "/email-logs" || (pathname === "/dashboard" && folderParam === "sent");
          } else if (item.href === "/scheduled") {
            isActive = pathname === "/scheduled" || (pathname === "/dashboard" && folderParam === "scheduled");
          } else {
            isActive = pathname === item.href;
          }

          return (
            <Link
              key={item.name}
              href={item.href}
              prefetch={false}
              onClick={onNavigate}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition cursor-pointer ${
                isActive
                  ? "bg-[#EDEFF2] text-gray-900 font-semibold"
                  : "text-gray-600 hover:bg-[#F4F5F7] hover:text-gray-900"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={isActive ? "text-[#673DE6]" : "text-gray-500"}>{item.icon}</span>
                <span className={isActive ? "text-gray-900 font-semibold" : ""}>{item.name}</span>
              </div>

              <div className="flex items-center gap-2">
                {item.badge && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      isActive ? "bg-[#673DE6] text-white" : "bg-[#18181B] text-white"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
                {item.hasSync && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRefresh();
                    }}
                    className="opacity-40 hover:opacity-100 transition p-0.5"
                    title="Refresh folder"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Hostinger by Farani Workspace Tools */}
      <div className="pt-3 border-t border-gray-100">
        <p className="px-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
          Outreach Tools
        </p>
        <nav className="space-y-0.5">
          {workspaceTools.map((tool) => {
            const isActive = pathname === tool.href || pathname.startsWith(tool.href + "/");
            return (
              <Link
                key={tool.name}
                href={tool.href}
                prefetch={false}
                onClick={onNavigate}
                className={`flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-medium transition ${
                  isActive
                    ? "bg-[#EDEFF2] text-[#673DE6] font-semibold"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <span className="text-xs">{tool.icon}</span>
                <span className={isActive ? "text-gray-900 font-semibold" : ""}>{tool.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdown, setUserDropdown] = useState(false);
  const [userName, setUserName] = useState("Hafiz Irfan");
  const [userEmail, setUserEmail] = useState("hafiz.irfan2008@gmail.com");
  const [userInitial, setUserInitial] = useState("S");

  // Global modals
  const [composeOpen, setComposeOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);

  // Emergency stop & active sending status
  const [activeSendingStatus, setActiveSendingStatus] = useState<{
    isSending: boolean;
    hasActiveSchedules: boolean;
    activeCampaigns: Array<{ id: string; name: string; pending: number; total: number; isCurrentlyDispatching: boolean }>;
    pausedCampaigns: Array<{ id: string; name: string }>;
    directScheduledCount: number;
  } | null>(null);
  const [emergencyModalOpen, setEmergencyModalOpen] = useState(false);
  const [emergencyActionBusy, setEmergencyActionBusy] = useState(false);
  const [emergencyNotice, setEmergencyNotice] = useState<string | null>(null);

  const loadSendingStatus = async () => {
    try {
      const res = await fetch("/api/campaigns/active-status", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setActiveSendingStatus(data);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    void loadSendingStatus();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void loadSendingStatus();
      }
    }, 15000);
    const onCountsUpdated = () => void loadSendingStatus();
    window.addEventListener("mail-counts-updated", onCountsUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener("mail-counts-updated", onCountsUpdated);
    };
  }, []);

  // Track previous workspace route so that hitting Back from Inbox / Mailbox returns to previous page
  useEffect(() => {
    if (typeof window !== "undefined" && pathname) {
      if (pathname !== "/dashboard" && pathname !== "/inbox") {
        sessionStorage.setItem("prev_workspace_route", pathname);
      }
    }
  }, [pathname]);

  async function handleEmergencyStop(action: "pause" | "cancel") {
    setEmergencyActionBusy(true);
    setEmergencyNotice(null);
    try {
      const res = await fetch("/api/campaigns/emergency-stop", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Emergency stop request failed.");
      setEmergencyNotice(
        action === "pause"
          ? `✓ Emergency Stop Applied! ${data.pausedCampaignsCount || 0} active campaign(s) safely PAUSED. Worker signal stopped.`
          : `✓ All active campaigns and pending dispatches have been CANCELLED.`
      );
      await loadSendingStatus();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      alert(err.message || "Failed to trigger emergency stop.");
    } finally {
      setEmergencyActionBusy(false);
    }
  }

  async function handleEmergencyResume() {
    setEmergencyActionBusy(true);
    setEmergencyNotice(null);
    try {
      const res = await fetch("/api/campaigns/emergency-resume", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Emergency resume request failed.");
      setEmergencyNotice(
        `✓ Resumed ${data.resumedCampaignsCount || 0} campaign(s). Active queue is back in SCHEDULED status.`
      );
      await loadSendingStatus();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      alert(err.message || "Failed to resume campaigns.");
    } finally {
      setEmergencyActionBusy(false);
    }
  }

  // Single campaign management state & edit modal
  const [editingCampaignModalOpen, setEditingCampaignModalOpen] = useState(false);
  const [targetCampaign, setTargetCampaign] = useState<any>(null);
  const [editCampaignName, setEditCampaignName] = useState("");
  const [editCampaignDescription, setEditCampaignDescription] = useState("");
  const [editCampaignMailboxId, setEditCampaignMailboxId] = useState("");
  const [editCampaignTemplateId, setEditCampaignTemplateId] = useState("");
  const [editCampaignSubject, setEditCampaignSubject] = useState("");
  const [editCampaignBody, setEditCampaignBody] = useState("");
  const [editCampaignDelaySeconds, setEditCampaignDelaySeconds] = useState(60);
  const [editCampaignSaving, setEditCampaignSaving] = useState(false);

  async function handleResumeSingleCampaign(campaignId: string, name: string) {
    setEmergencyActionBusy(true);
    setEmergencyNotice(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to continue campaign.");
      await fetch("/api/campaigns/emergency-resume", { method: "POST" }).catch(() => {});
      setEmergencyNotice(`✓ Campaign "${name}" resumed! Outreach dispatch will continue in scheduled intervals.`);
      await loadSendingStatus();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      alert(err.message || "Failed to continue campaign.");
    } finally {
      setEmergencyActionBusy(false);
    }
  }

  async function handlePauseSingleCampaign(campaignId: string, name: string) {
    setEmergencyActionBusy(true);
    setEmergencyNotice(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to pause campaign.");
      setEmergencyNotice(`⏸️ Campaign "${name}" is now safely paused. No emails will be sent.`);
      await loadSendingStatus();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      alert(err.message || "Failed to pause campaign.");
    } finally {
      setEmergencyActionBusy(false);
    }
  }

  async function handleDeleteSingleCampaign(campaignId: string, name: string) {
    if (
      !confirm(
        `Are you sure you want to delete campaign "${name}"?\n\nThis will immediately STOP and permanently delete all unsent emails for this campaign.`
      )
    ) {
      return;
    }
    setEmergencyActionBusy(true);
    setEmergencyNotice(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete campaign.");
      setEmergencyNotice(`✓ Campaign "${name}" deleted successfully.`);
      await loadSendingStatus();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      alert(err.message || "Failed to delete campaign.");
    } finally {
      setEmergencyActionBusy(false);
    }
  }

  async function handleStopSingleCampaign(campaignId: string, name: string) {
    if (!confirm(`Permanently stop campaign "${name}"? Remaining scheduled emails will be cancelled.`)) {
      return;
    }
    setEmergencyActionBusy(true);
    setEmergencyNotice(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to stop campaign.");
      setEmergencyNotice(`🛑 Campaign "${name}" stopped permanently.`);
      await loadSendingStatus();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      alert(err.message || "Failed to stop campaign.");
    } finally {
      setEmergencyActionBusy(false);
    }
  }

  async function handleOpenEditModal(camp: any) {
    setTargetCampaign(camp);
    setEditCampaignName(camp.name || "");
    setEditCampaignDescription(camp.description || "");
    setEditCampaignMailboxId(camp.mailboxId || camp.mailbox?.id || composeMailboxId || mailboxes[0]?.id || "");
    setEditCampaignTemplateId(camp.templateId || camp.template?.id || templates[0]?.id || "");
    setEditCampaignSubject(camp.template?.subject || "Collaboration Proposal");
    setEditCampaignBody(
      camp.template?.body || "Hi {{brandName}} Team,\n\nWe would love to collaborate with {{brandName}}."
    );
    setEditCampaignDelaySeconds(60);

    try {
      const res = await fetch(`/api/campaigns/${camp.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.campaign) {
          const c = data.campaign;
          setEditCampaignName(c.name || camp.name);
          setEditCampaignDescription(c.description || "");
          setEditCampaignMailboxId(c.mailboxId || c.mailbox?.id || "");
          if (c.template) {
            setEditCampaignTemplateId(c.template.id);
            setEditCampaignSubject(c.template.subject || "");
            setEditCampaignBody(c.template.body || "");
          }
        }
      }
    } catch {}

    setEditingCampaignModalOpen(true);
  }

  async function handleSaveEditedCampaign(e: React.FormEvent) {
    e.preventDefault();
    if (!targetCampaign) return;
    setEditCampaignSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${targetCampaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: editCampaignName.trim(),
          description: editCampaignDescription.trim() || null,
          mailboxId: editCampaignMailboxId || null,
          templateId: editCampaignTemplateId || null,
          subject: editCampaignSubject.trim(),
          body: editCampaignBody.trim(),
          delaySeconds: editCampaignDelaySeconds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update campaign.");
      setEmergencyNotice(`✓ Campaign "${editCampaignName.trim()}" updated successfully.`);
      setEditingCampaignModalOpen(false);
      await loadSendingStatus();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      alert(err.message || "Failed to save campaign.");
    } finally {
      setEditCampaignSaving(false);
    }
  }

  // Global compose form
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; subject: string; body: string }>>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  // Hostinger Mailboxes for real-time sending
  const [mailboxes, setMailboxes] = useState<Array<{ id: string; emailAddress: string; displayName?: string | null; status: string; smtpStatus: string }>>([]);
  const [composeMailboxId, setComposeMailboxId] = useState("");

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

  // Real-time Hostinger compose states & refs (Matches Hostinger Webmail)
  const [showAiPromptBar, setShowAiPromptBar] = useState(true);
  const [formatToolbarOpen, setFormatToolbarOpen] = useState(false);
  const [composePreviewMode, setComposePreviewMode] = useState(false);
  const [scheduleMenuOpen, setScheduleMenuOpen] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [scheduleSendModalOpen, setScheduleSendModalOpen] = useState(false);
  const [scheduleSendDate, setScheduleSendDate] = useState("");
  const [scheduleSendTime, setScheduleSendTime] = useState("10:00");
  const [attachments, setAttachments] = useState<Array<{ name: string; size: number; type: string }>>([]);
  const [draftNotice, setDraftNotice] = useState("");
  const [draftSaving, setDraftSaving] = useState(false);
  const [composeDraftId, setComposeDraftId] = useState<string | null>(null);

  const aiInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const scheduleMenuRef = useRef<HTMLDivElement>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);

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

  // Fetch last scheduled brand whenever compose opens
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
      if (savedId && list.some((m: any) => m.id === savedId)) {
        setComposeMailboxId(savedId);
      } else if (list.length > 0) {
        try {
          const actRes = await fetch("/api/mailboxes/active");
          const actData = await actRes.json();
          if (actData.activeMailboxId && list.some((m: any) => m.id === actData.activeMailboxId)) {
            setComposeMailboxId(actData.activeMailboxId);
            if (typeof window !== "undefined") localStorage.setItem("active_sender_mailbox_id", actData.activeMailboxId);
          } else {
            setComposeMailboxId(list[0].id);
            if (typeof window !== "undefined") localStorage.setItem("active_sender_mailbox_id", list[0].id);
          }
        } catch {
          setComposeMailboxId(list[0].id);
        }
      }
    } catch {}
  }, []);

  async function handleSwitchMailbox(newId: string) {
    setComposeMailboxId(newId);
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
  }

  useEffect(() => {
    void refreshMailboxes();

    const onMailboxesUpdated = () => void refreshMailboxes();
    const onSenderChanged = (e: any) => {
      const id = e.detail?.mailboxId;
      if (id) setComposeMailboxId(id);
    };

    window.addEventListener("mailboxes-updated", onMailboxesUpdated);
    window.addEventListener("sender-mailbox-changed", onSenderChanged);
    return () => {
      window.removeEventListener("mailboxes-updated", onMailboxesUpdated);
      window.removeEventListener("sender-mailbox-changed", onSenderChanged);
    };
  }, [refreshMailboxes]);

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

  const [folderCounts, setFolderCounts] = useState<{
    inbox: number;
    drafts: number;
    scheduled: number;
    sent: number;
    spam: number;
    trash: number;
  }>({
    inbox: 0,
    drafts: 0,
    scheduled: 0,
    sent: 0,
    spam: 0,
    trash: 0,
  });

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        const data = await res.json();
        if (data.user) {
          if (data.user.name) setUserName(data.user.name);
          if (data.user.email) setUserEmail(data.user.email);
          const initial = (data.user.name || data.user.email || "S").charAt(0).toUpperCase();
          setUserInitial(initial);
        }
      } catch {
        // fallback
      }
    }
    void loadUser();
  }, []);

  useEffect(() => {
    async function loadFolderCounts(targetMailboxId = composeMailboxId) {
      if (!targetMailboxId) {
        setFolderCounts({ inbox: 0, drafts: 0, scheduled: 0, sent: 0, spam: 0, trash: 0 });
        return;
      }
      try {
        const url = `/api/inbox?mailboxId=${encodeURIComponent(targetMailboxId)}`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.counts) {
          setFolderCounts(data.counts);
        }
      } catch {
        // silent
      }
    }
    void loadFolderCounts(composeMailboxId);
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void loadFolderCounts(composeMailboxId);
      }
    }, 15000);

    const onCountsUpdated = (event: Event) => {
      const customEvt = event as CustomEvent;
      if (customEvt.detail) {
        setFolderCounts(customEvt.detail);
      } else {
        void loadFolderCounts(composeMailboxId);
      }
    };

    const onSenderChanged = (e: any) => {
      const id = e.detail?.mailboxId;
      if (id) {
        setComposeMailboxId(id);
        void loadFolderCounts(id);
      }
    };

    window.addEventListener("mail-counts-updated", onCountsUpdated);
    window.addEventListener("sender-mailbox-changed", onSenderChanged);

    return () => {
      clearInterval(interval);
      window.removeEventListener("mail-counts-updated", onCountsUpdated);
      window.removeEventListener("sender-mailbox-changed", onSenderChanged);
    };
  }, [composeMailboxId]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function handleSendEmail() {
    if (!composeTo.trim() || !composeSubject.trim()) {
      alert("Please fill in recipient and subject.");
      return;
    }

    const targetMailboxId = composeMailboxId || mailboxes[0]?.id;
    if (!targetMailboxId) {
      alert("Please connect and verify a mailbox first in the Mailboxes section.");
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
        router.refresh();
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      alert(err.message || "Failed to send email.");
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

  async function handleSaveAsTemplate() {
    if (!composeSubject.trim() && !composeBody.trim()) {
      alert("Please write a subject or message body first to save as a template.");
      return;
    }
    const tplName = window.prompt("Enter a name for this template:", composeSubject.slice(0, 32) || "New Template");
    if (!tplName || !tplName.trim()) return;

    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: tplName.trim(),
          subject: composeSubject.trim() || "(No Subject)",
          body: composeBody.trim() || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save template");
      if (data.template) {
        setTemplates((prev) => [data.template, ...prev]);
      }
      setTemplateMenuOpen(false);
      setDraftNotice(`✓ Saved as template "${tplName.trim()}"!`);
      setTimeout(() => setDraftNotice(""), 3000);
    } catch (err: any) {
      alert(err.message || "Failed to save template");
    }
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

  // Folder navigation (Hostinger Mail style)
  const mailFolders = [
    {
      name: "Inbox",
      href: "/dashboard",
      folderKey: "inbox",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      ),
      badge: folderCounts.inbox > 0 ? String(folderCounts.inbox) : undefined,
      hasSync: true,
    },
    {
      name: "Drafts",
      href: "/dashboard?folder=drafts",
      folderKey: "drafts",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      badge: folderCounts.drafts > 0 ? String(folderCounts.drafts) : undefined,
    },
    {
      name: "Scheduled",
      href: "/scheduled",
      folderKey: "scheduled",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      badge: folderCounts.scheduled > 0 ? String(folderCounts.scheduled) : undefined,
    },
    {
      name: "Sent",
      href: "/dashboard?folder=sent",
      folderKey: "sent",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      ),
    },
    {
      name: "Spam",
      href: "/dashboard?folder=spam",
      folderKey: "spam",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ),
    },
    {
      name: "Trash",
      href: "/dashboard?folder=trash",
      folderKey: "trash",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
      badge: folderCounts.trash > 0 ? String(folderCounts.trash) : undefined,
    },
  ];

  // Outreach & Campaign Workspace Tools
  const workspaceTools = [
    { name: "Campaigns", href: "/campaigns", icon: "📢" },
    { name: "Website Forms", href: "/forms", icon: "🌐" },
    { name: "Scheduled", href: "/scheduled", icon: "🕒" },
    { name: "Email Logs", href: "/email-logs", icon: "📊" },
    { name: "Contacts", href: "/contacts", icon: "👥" },
    { name: "Templates", href: "/templates", icon: "📋" },
    { name: "Mailboxes", href: "/mailboxes", icon: "📫" },
    { name: "Follow-ups", href: "/follow-ups", icon: "🔁" },
    { name: "Settings", href: "/settings", icon: "⚙️" },
  ];

  return (
    <div className="min-h-screen bg-white text-[#18181B] font-sans antialiased flex flex-col">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-gray-200 bg-white px-4 sm:px-6">
        {/* Left: Mobile hamburger & Hostinger Logo on small screens */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 lg:hidden"
            aria-label="Toggle menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <Link href="/dashboard" className="flex items-center gap-2.5">
            <svg className="w-6 h-6 text-[#18181B]" viewBox="0 0 28 28" fill="none">
              <path d="M14 2L2 9V21L14 28L26 21V9L14 2Z" fill="currentColor" />
              <path d="M9 8V20M19 8V20M9 14H19" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <div className="flex items-center text-sm">
              <span className="font-extrabold text-[#18181B] tracking-wider text-base">HOSTINGER</span>
              <span className="mx-2 text-gray-300 font-light text-base">|</span>
              <span className="text-gray-600 font-medium text-base">by Farani</span>
            </div>
          </Link>
        </div>

        {/* Center: Search Bar */}
        <div className="mx-4 hidden max-w-xl flex-1 md:block">
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search mail"
              className="w-full rounded-full border border-gray-200 bg-[#F9FAFB] py-2 pl-10 pr-10 text-xs sm:text-sm text-gray-800 placeholder-gray-400 transition focus:border-[#673DE6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]/10"
            />
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </div>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Emergency Kill Switch / Active Status Pill */}
          {activeSendingStatus?.hasActiveSchedules && (
            <button
              type="button"
              onClick={() => {
                setEmergencyNotice(null);
                setEmergencyModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-red-600 via-rose-600 to-red-700 hover:from-red-700 hover:to-rose-700 text-white px-3 sm:px-4 py-1.5 text-xs font-extrabold shadow-lg shadow-red-500/35 ring-2 ring-red-400/50 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer"
              title="Click for Emergency Stop: Halt all email sends immediately"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-90"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              <span className="text-sm">🛑</span>
              <span className="hidden sm:inline font-bold">STOP ALL SENDS</span>
              <span className="sm:hidden font-bold">STOP</span>
              <span className="bg-black/30 backdrop-blur-xs text-white px-2 py-0.5 rounded-full text-[10px] font-bold">
                {activeSendingStatus.activeCampaigns?.length || 0} active
              </span>
            </button>
          )}

          {/* Paused Campaigns Pill Button in Header (Always visible when there are paused campaigns) */}
          {(activeSendingStatus?.pausedCampaigns?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => {
                setEmergencyNotice(null);
                setEmergencyModalOpen(true);
              }}
              className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-600 hover:to-orange-600 text-white px-3.5 py-1.5 text-xs font-extrabold shadow-md shadow-amber-500/25 ring-2 ring-amber-400/40 hover:ring-amber-300 hover:shadow-lg hover:shadow-amber-500/40 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer"
              title="Click to Continue, Edit, or Delete paused campaigns"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              <span>⏸️</span>
              <span className="hidden sm:inline font-bold">
                {activeSendingStatus?.pausedCampaigns.length} Campaign(s) Paused
              </span>
              <span className="sm:hidden font-bold">Paused</span>
              <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full font-bold group-hover:bg-white/30 transition">
                Manage &rarr;
              </span>
            </button>
          )}

          {/* Upgrade link */}
          <button
            onClick={() => alert("Hostinger Mail Plan: Active (1 GB Storage)")}
            className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-black px-2 py-1.5"
          >
            <svg className="w-3.5 h-3.5 text-[#673DE6]" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
            </svg>
            Upgrade
          </button>

          {/* Refer a friend */}
          <button
            onClick={() => alert("Invite friends to Hostinger Mail and get free mailbox storage extensions!")}
            className="hidden md:flex items-center gap-1.5 rounded-full bg-[#F3EFFF] border border-[#E5D9FD] px-3.5 py-1.5 text-xs font-semibold text-[#673DE6] hover:bg-[#EBE3FF] transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
            </svg>
            Refer a friend
          </button>

          {/* Ask AI button */}
          <button
            onClick={() => setAiModalOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-purple-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-800 shadow-sm hover:border-purple-400 hover:bg-purple-50/50 transition"
          >
            <span className="text-[#673DE6]">✨</span>
            Ask AI
          </button>

          {/* View icon */}
          <button
            onClick={() => router.push(pathname === "/dashboard" ? "/campaigns" : "/dashboard")}
            className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 transition"
            title="Toggle Mailbox / Campaigns"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>

          {/* Settings gear */}
          <Link
            href="/settings"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 transition"
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>

          {/* User Profile Avatar with Initial */}
          <div className="relative">
            <button
              onClick={() => setUserDropdown(!userDropdown)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F59E0B] text-xs font-bold text-white shadow-sm ring-2 ring-white hover:opacity-90 transition"
              title={userName}
            >
              {userInitial}
            </button>

            {userDropdown && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-gray-100 bg-white p-2 shadow-xl z-50">
                <div className="px-3 py-2 border-b border-gray-100">
                  <p className="text-xs font-bold text-gray-900 truncate">{userName}</p>
                  <p className="text-[11px] text-gray-500 truncate">{userEmail}</p>
                </div>
                <div className="py-1">
                  <Link
                    href="/settings"
                    onClick={() => setUserDropdown(false)}
                    className="block px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded-lg"
                  >
                    Account settings
                  </Link>
                  <Link
                    href="/mailboxes"
                    onClick={() => setUserDropdown(false)}
                    className="block px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded-lg"
                  >
                    Manage mailboxes
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Workspace (Sidebar + Content) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-30 w-64 border-r border-gray-200 bg-white pt-16 flex flex-col justify-between transition-transform lg:static lg:translate-x-0 ${
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="p-4 space-y-4 overflow-y-auto">
            {/* New message Button */}
            <button
              onClick={() => {
                setComposeOpen(true);
                setMobileMenuOpen(false);
              }}
              className="w-full rounded-2xl bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] px-5 py-3 text-sm font-bold text-white shadow-md shadow-purple-500/25 hover:shadow-lg hover:shadow-purple-500/35 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2.5 cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              New message
            </button>

            <Suspense fallback={null}>
              <SidebarNav
                mailFolders={mailFolders}
                workspaceTools={workspaceTools}
                pathname={pathname}
                onNavigate={() => setMobileMenuOpen(false)}
                onRefresh={() => router.refresh()}
              />
            </Suspense>
          </div>

          {/* Bottom Sidebar: Storage + Buttons */}
          <div className="p-4 border-t border-gray-100 space-y-3 bg-white">
            {/* Storage Progress Bar */}
            <div className="space-y-1.5">
              <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden relative">
                <div className="h-full bg-gradient-to-r from-[#673DE6] to-emerald-500 rounded-full" style={{ width: "2%" }} />
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-gray-800">198.00 KB <span className="text-gray-400 font-normal">/ 1 GB</span></span>
                <button
                  onClick={() => alert("Upgrade Hostinger Mailbox storage")}
                  className="font-bold text-[#673DE6] hover:underline cursor-pointer"
                >
                  Upgrade
                </button>
              </div>
            </div>

            {/* Send Feedback */}
            <button
              onClick={() => setFeedbackOpen(true)}
              className="w-full rounded-xl border border-gray-200 bg-white hover:bg-gray-50 py-2 text-xs font-semibold text-gray-700 hover:scale-[1.01] active:scale-[0.99] transition-all duration-150 flex items-center justify-center gap-2 shadow-2xs cursor-pointer"
            >
              <span>💬</span> Send Feedback
            </button>

            {/* Setup guide 2/7 */}
            <button
              onClick={() => setSetupGuideOpen(true)}
              className="w-full rounded-xl bg-gradient-to-r from-gray-900 to-black hover:from-gray-800 hover:to-gray-900 py-2.5 text-xs font-bold text-white flex items-center justify-center gap-2 shadow-sm hover:shadow-md hover:scale-[1.01] active:scale-[0.99] transition-all duration-150 cursor-pointer"
            >
              <span>🚀</span> Setup guide 2/7
            </button>
          </div>
        </aside>

        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          />
        )}

        {/* Content View */}
        <main className="flex-1 overflow-y-auto bg-white">
          {children}
        </main>
      </div>

      {/* Floating Compose Dialog - Exact Hostinger Webmail Layout */}
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
            {/* From: Clean Hostinger Sender Row */}
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
                  onClick={handleSendEmail}
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
                        void handleSendEmail();
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
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4.5 4.5 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
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

                {/* Templates Popup Menu (Real Hostinger Options) */}
                {templateMenuOpen && (
                  <div className="absolute bottom-11 left-0 w-72 bg-white rounded-2xl shadow-xl border border-gray-200 p-2.5 z-50 animate-in fade-in zoom-in-95 text-gray-800">
                    <div className="flex items-center justify-between text-[10px] font-bold text-gray-500 uppercase px-2.5 py-1 tracking-wider border-b border-gray-100 pb-1.5 mb-1.5">
                      <span>Templates ({templates.length})</span>
                      <a href="/templates" className="text-[#673DE6] hover:underline normal-case text-xs font-semibold">
                        Manage &rarr;
                      </a>
                    </div>
                    <div className="space-y-1 max-h-52 overflow-y-auto">
                      {templates.length === 0 ? (
                        <div className="p-3 text-center text-xs text-gray-400">
                          No saved templates yet
                        </div>
                      ) : (
                        templates.map((t) => (
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
                            {(t as any).isDefault && (
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                Active
                              </span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                    <div className="pt-2 mt-1.5 border-t border-gray-100 flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={handleSaveAsTemplate}
                        className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-bold text-[#673DE6] hover:bg-purple-50 flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <span>➕</span> Save draft as new template
                      </button>
                      <a
                        href="/templates"
                        className="w-full text-left px-2.5 py-1 rounded-xl text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 flex items-center gap-1.5 transition"
                      >
                        <span>⚙️</span> Manage all templates
                      </a>
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

      {/* Emergency Control & Campaign Management Modal */}
      {emergencyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 sm:p-7 shadow-2xl border border-gray-200 my-8 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 text-white flex items-center justify-center text-xl font-bold shadow-md shadow-red-500/25">
                  🛑
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-gray-900 tracking-tight">Campaign Dispatch Controls</h3>
                  <p className="text-xs text-gray-500">Edit, continue, pause, stop or delete any campaign in real time</p>
                </div>
              </div>
              <button
                onClick={() => setEmergencyModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-sm p-2 rounded-xl hover:bg-gray-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {emergencyNotice && (
              <div className="mt-4 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-300 text-xs font-bold text-emerald-900 flex items-center justify-between shadow-2xs">
                <span>{emergencyNotice}</span>
                <button
                  type="button"
                  onClick={() => setEmergencyNotice(null)}
                  className="text-emerald-700 hover:text-emerald-900 font-bold ml-2 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            )}

            <div className="mt-5 space-y-4">
              {/* Paused Campaigns Section with Full Edit, Continue, Stop, Delete Controls */}
              {(activeSendingStatus?.pausedCampaigns?.length ?? 0) > 0 && (
                <div className="rounded-2xl border-2 border-amber-300/80 bg-gradient-to-br from-amber-50/90 via-orange-50/50 to-amber-50/90 p-4 sm:p-5 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                      </span>
                      <span className="text-xs font-extrabold text-amber-950 uppercase tracking-wider">
                        Paused Outreach Campaigns ({activeSendingStatus?.pausedCampaigns.length})
                      </span>
                    </div>
                    <span className="text-[10px] font-bold text-amber-900 bg-amber-200/80 border border-amber-300 px-2.5 py-0.5 rounded-full">
                      ⏸️ Dispatch Frozen (Safe)
                    </span>
                  </div>

                  <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                    {activeSendingStatus?.pausedCampaigns.map((camp: any) => (
                      <div
                        key={camp.id}
                        className="p-3.5 bg-white/95 rounded-2xl border border-amber-200 shadow-2xs hover:shadow-md hover:border-amber-300 transition-all duration-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-gray-900 text-sm">
                              📢 {camp.name}
                            </span>
                            <span className="text-[10px] font-extrabold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full">
                              PAUSED
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                            {camp.mailbox?.emailAddress && (
                              <span className="font-mono text-purple-700 font-semibold">
                                ✉️ {camp.mailbox.displayName ? `[${camp.mailbox.displayName}] ` : ""}{camp.mailbox.emailAddress}
                              </span>
                            )}
                            {camp.template?.name && (
                              <span className="text-gray-600 font-medium">
                                📋 {camp.template.name}
                              </span>
                            )}
                            {camp._count?.recipients !== undefined && (
                              <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                                🎯 {camp._count.recipients} brands
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Interactive Buttons: Continue, Edit, Delete */}
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                          {/* Continue / Resume Button */}
                          <button
                            type="button"
                            disabled={emergencyActionBusy}
                            onClick={() => handleResumeSingleCampaign(camp.id, camp.name)}
                            className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Continue / Resume sending this campaign"
                          >
                            <span>▶️</span> Continue
                          </button>

                          {/* Edit Button */}
                          <button
                            type="button"
                            disabled={emergencyActionBusy}
                            onClick={() => handleOpenEditModal(camp)}
                            className="px-3 py-1.5 bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Edit campaign settings, templates, delay, or sender Hostinger ID"
                          >
                            <span>✏️</span> Edit
                          </button>

                          {/* Stop / Cancel Button */}
                          <button
                            type="button"
                            disabled={emergencyActionBusy}
                            onClick={() => handleStopSingleCampaign(camp.id, camp.name)}
                            className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-xl border border-amber-200 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50 hover:scale-105 active:scale-95"
                            title="Permanently stop campaign and cancel unsent emails"
                          >
                            <span>🛑</span> Stop
                          </button>

                          {/* Delete Button */}
                          <button
                            type="button"
                            disabled={emergencyActionBusy}
                            onClick={() => handleDeleteSingleCampaign(camp.id, camp.name)}
                            className="px-2.5 py-1.5 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Permanently delete this paused campaign"
                          >
                            <span>🗑️</span> Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Active Campaigns status & controls */}
              {(activeSendingStatus?.activeCampaigns?.length ?? 0) > 0 ? (
                <div className="rounded-2xl border border-red-200 bg-red-50/40 p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-red-900 uppercase tracking-wide flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping"></span>
                      Active Dispatch Campaigns ({activeSendingStatus?.activeCampaigns.length})
                    </span>
                    <span className="text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 px-2.5 py-0.5 rounded-full">
                      Live Queue
                    </span>
                  </div>
                  <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                    {activeSendingStatus?.activeCampaigns.map((camp: any) => (
                      <div
                        key={camp.id}
                        className="p-3 bg-white rounded-xl border border-red-100 shadow-2xs hover:shadow-xs transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-gray-900 truncate">
                            📢 {camp.name}
                          </p>
                          <p className="text-[11px] text-gray-500 mt-0.5 font-mono">
                            {camp.pending} pending / {camp.total} total &bull; via {camp.mailboxEmail}
                          </p>
                        </div>

                        {/* Interactive Controls for Active Campaign */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={emergencyActionBusy}
                            onClick={() => handlePauseSingleCampaign(camp.id, camp.name)}
                            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl shadow-xs transition hover:scale-105 active:scale-95 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Pause this campaign immediately"
                          >
                            <span>⏸️</span> Pause
                          </button>
                          <button
                            type="button"
                            disabled={emergencyActionBusy}
                            onClick={() => handleOpenEditModal(camp)}
                            className="px-2.5 py-1.5 bg-purple-50 hover:bg-purple-100 text-[#673DE6] text-xs font-bold rounded-xl border border-purple-200 transition hover:scale-105 active:scale-95 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Edit campaign settings"
                          >
                            <span>✏️</span> Edit
                          </button>
                          <button
                            type="button"
                            disabled={emergencyActionBusy}
                            onClick={() => handleStopSingleCampaign(camp.id, camp.name)}
                            className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-xl border border-red-200 transition hover:scale-105 active:scale-95 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Stop remaining emails"
                          >
                            <span>🛑</span> Stop
                          </button>
                          <button
                            type="button"
                            disabled={emergencyActionBusy}
                            onClick={() => handleDeleteSingleCampaign(camp.id, camp.name)}
                            className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-xs transition hover:scale-105 active:scale-95 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Delete campaign"
                          >
                            <span>🗑️</span> Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (activeSendingStatus?.pausedCampaigns?.length ?? 0) === 0 ? (
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-6 text-center">
                  <p className="text-xs font-semibold text-gray-600">
                    No active or paused campaigns currently in queue.
                  </p>
                </div>
              ) : null}

              {/* Action Explanations */}
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-3.5 text-[11px] text-gray-600 space-y-1">
                <p>
                  <strong>▶️ Continue:</strong> Unfreezes the paused campaign and resumes spaced sending in real time.
                </p>
                <p>
                  <strong>✏️ Edit:</strong> Adjust name, Hostinger sender ID, brand template, subject, body, or delay intervals.
                </p>
                <p>
                  <strong>🗑️ Delete:</strong> Permanently removes the campaign and clears all its queued email jobs.
                </p>
              </div>

              {/* Bulk Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-end gap-2.5">
                {(activeSendingStatus?.pausedCampaigns?.length ?? 0) > 0 && (
                  <button
                    disabled={emergencyActionBusy}
                    onClick={handleEmergencyResume}
                    className="w-full sm:w-auto rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-emerald-500/25 transition disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer hover:scale-105 active:scale-95"
                  >
                    <span>▶️</span> Continue All Paused Campaigns
                  </button>
                )}

                {(activeSendingStatus?.hasActiveSchedules || (activeSendingStatus?.activeCampaigns?.length ?? 0) > 0) && (
                  <>
                    <button
                      disabled={emergencyActionBusy}
                      onClick={() => handleEmergencyStop("cancel")}
                      className="w-full sm:w-auto rounded-xl border border-red-200 bg-white hover:bg-red-50 px-4 py-2.5 text-xs font-bold text-red-600 transition disabled:opacity-50 cursor-pointer"
                    >
                      ✕ Cancel All Sends
                    </button>
                    <button
                      disabled={emergencyActionBusy}
                      onClick={() => handleEmergencyStop("pause")}
                      className="w-full sm:w-auto rounded-xl bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-red-500/25 transition disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer hover:scale-105 active:scale-95"
                    >
                      <span>⏸️</span> {emergencyActionBusy ? "Stopping..." : "Pause All Sends Now"}
                    </button>
                  </>
                )}

                <button
                  onClick={() => setEmergencyModalOpen(false)}
                  className="w-full sm:w-auto rounded-xl border border-gray-200 px-5 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 transition cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Universal Campaign Edit Modal */}
      {editingCampaignModalOpen && targetCampaign && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl border border-purple-200 my-8 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-[#673DE6] to-[#5025D1] text-white flex items-center justify-center text-base font-bold shadow-md shadow-purple-500/25">
                  ✏️
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-gray-900 tracking-tight">Edit Campaign</h3>
                  <p className="text-xs text-gray-500">Update name, sender Hostinger ID, template, or interval delay</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingCampaignModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-sm p-1.5 rounded-xl hover:bg-gray-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEditedCampaign} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Campaign Title</label>
                <input
                  type="text"
                  required
                  value={editCampaignName}
                  onChange={(e) => setEditCampaignName(e.target.value)}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none font-bold text-gray-900 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Description / Notes (Optional)</label>
                <input
                  type="text"
                  value={editCampaignDescription}
                  onChange={(e) => setEditCampaignDescription(e.target.value)}
                  placeholder="e.g. Brand collaboration batch"
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none text-gray-800 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Sender Hostinger ID</label>
                <select
                  value={editCampaignMailboxId}
                  onChange={(e) => setEditCampaignMailboxId(e.target.value)}
                  className="w-full px-3.5 py-2 border border-purple-200 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none font-bold text-gray-900 bg-white text-xs cursor-pointer"
                >
                  {mailboxes.map((mb) => (
                    <option key={mb.id} value={mb.id}>
                      {mb.displayName ? `[${mb.displayName}] ` : ""}{mb.emailAddress} {mb.smtpStatus === "CONNECTED" ? "✓ (Verified)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {templates.length > 0 && (
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Apply Outreach Template</label>
                  <select
                    value={editCampaignTemplateId}
                    onChange={(e) => {
                      const tId = e.target.value;
                      setEditCampaignTemplateId(tId);
                      const t = templates.find((tpl) => tpl.id === tId);
                      if (t) {
                        setEditCampaignSubject(t.subject);
                        setEditCampaignBody(t.body);
                      }
                    }}
                    className="w-full px-3.5 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none text-gray-900 bg-white font-medium text-xs cursor-pointer"
                  >
                    <option value="">-- Keep Current Email / Custom --</option>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-bold text-gray-700 mb-1">Email Subject</label>
                <input
                  type="text"
                  required
                  value={editCampaignSubject}
                  onChange={(e) => setEditCampaignSubject(e.target.value)}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none font-bold text-gray-900 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Email Body (Supports {"{{brandName}}"} variable)</label>
                <textarea
                  rows={5}
                  required
                  value={editCampaignBody}
                  onChange={(e) => setEditCampaignBody(e.target.value)}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none font-sans text-xs leading-relaxed text-gray-800"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Delay Between Consecutive Brand Emails (Seconds)</label>
                <input
                  type="number"
                  min={5}
                  max={3600}
                  value={editCampaignDelaySeconds}
                  onChange={(e) => setEditCampaignDelaySeconds(Number(e.target.value) || 60)}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none font-bold text-gray-900 text-xs"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingCampaignModalOpen(false)}
                  className="px-4 py-2 border border-gray-200 rounded-xl font-semibold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editCampaignSaving}
                  className="px-5 py-2 bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] text-white font-bold rounded-xl shadow-md shadow-purple-500/25 transition disabled:opacity-50 cursor-pointer hover:scale-105 active:scale-95"
                >
                  {editCampaignSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
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
                className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-700 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateAI}
                disabled={aiGenerating || !aiPrompt.trim()}
                className="rounded-xl bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] px-5 py-2 text-xs font-bold text-white shadow-md shadow-purple-500/25 hover:shadow-lg hover:shadow-purple-500/35 hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50 cursor-pointer"
              >
                {aiGenerating ? "Generating..." : "Generate Draft"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Setup Guide Modal */}
      {setupGuideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-gray-100">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-lg">🚀</span>
                <h3 className="text-base font-bold text-gray-900">Mailbox Setup Guide (2/7)</h3>
              </div>
              <button onClick={() => setSetupGuideOpen(false)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {[
                { label: "Create Account & Workspace", done: true },
                { label: "Verify Hostinger Mailbox (SMTP/IMAP)", done: true },
                { label: "Add or Import Contacts CSV", done: false, href: "/contacts" },
                { label: "Create Email Outreach Template", done: false, href: "/templates" },
                { label: "Configure Sequence & Follow-ups", done: false, href: "/follow-ups" },
                { label: "Review & Schedule First Campaign", done: false, href: "/campaigns" },
                { label: "Monitor Inbound Replies in Inbox", done: false, href: "/dashboard" },
              ].map((step, idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-gray-50 text-xs">
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        step.done ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"
                      }`}
                    >
                      {step.done ? "✓" : idx + 1}
                    </span>
                    <span className={step.done ? "line-through text-gray-400" : "font-medium text-gray-800"}>
                      {step.label}
                    </span>
                  </div>
                  {step.href && !step.done && (
                    <Link
                      href={step.href}
                      onClick={() => setSetupGuideOpen(false)}
                      className="text-[#673DE6] font-semibold hover:underline"
                    >
                      Start
                    </Link>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSetupGuideOpen(false)}
                className="rounded-xl bg-[#18181B] px-4 py-2 text-xs font-semibold text-white hover:bg-black"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send Feedback Modal */}
      {feedbackOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-gray-100">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span>💬</span>
                <h3 className="text-base font-bold text-gray-900">Share Feedback</h3>
              </div>
              <button onClick={() => setFeedbackOpen(false)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            {feedbackSent ? (
              <div className="py-8 text-center">
                <span className="text-3xl">🎉</span>
                <p className="mt-2 text-sm font-bold text-gray-900">Thank you for your feedback!</p>
                <p className="text-xs text-gray-500 mt-1">We continuously improve Hostinger by Farani.</p>
                <button
                  onClick={() => {
                    setFeedbackSent(false);
                    setFeedbackOpen(false);
                  }}
                  className="mt-4 rounded-xl bg-[#673DE6] px-4 py-2 text-xs font-semibold text-white"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <textarea
                  rows={4}
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder="Tell us what you like or how we can make Hostinger by Farani even better..."
                  className="w-full rounded-xl border border-gray-200 p-3 text-xs sm:text-sm focus:border-[#673DE6] focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setFeedbackOpen(false)}
                    className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (feedbackText.trim()) setFeedbackSent(true);
                    }}
                    className="rounded-xl bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] px-5 py-2 text-xs font-bold text-white shadow-md shadow-purple-500/25 hover:shadow-lg hover:shadow-purple-500/35 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer"
                  >
                    Submit Feedback
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
