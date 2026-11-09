"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState } from "@/components/ui";
import { PreSendReviewModal, ReviewRecipient } from "@/components/pre-send-review-modal";
import { formatEmailBodyToHtml } from "@/lib/email/template";

type Job = {
  id: string;
  jobType: string;
  followUpStep: number | null;
  runAt: string;
  timezone: string;
  status: string;
  deliveryState: string;
  attempts: number;
  nextAttemptAt: string | null;
  processedAt?: string | null;
  sentAt?: string | null;
  lastError: string | null;
  campaign: {
    id: string;
    name: string;
    status: string;
    mailbox?: { id: string; emailAddress: string; displayName?: string | null } | null;
    template?: { id: string; name: string; subject: string; body: string } | null;
  } | null;
  campaignRecipient: {
    id?: string;
    status: string;
    snapshotBrand?: string | null;
    snapshotEmail?: string | null;
    snapshotName?: string | null;
    productCategory?: string | null;
    contact: {
      id?: string;
      name: string;
      fullName?: string | null;
      brandName?: string | null;
      email: string;
      notes?: string | null;
      website?: string | null;
      formUrl?: string | null;
    };
  } | null;
  message: { subject: string; body?: string | null } | null;
  brandName?: string;
  recipientEmail?: string;
  productCategory?: string;
  renderedSubject?: string;
  renderedBody?: string;
  senderEmail?: string;
  senderDisplayName?: string | null;
  formUrl?: string | null;
  formStatus?: string | null;
  websiteFormJob?: {
    id: string;
    targetUrl: string;
    status: string;
    manualActionReason?: string | null;
    runAt?: string;
    submittedAt?: string | null;
    lastError?: string | null;
  } | null;
};

export type ScheduledCampaign = {
  id: string;
  name: string;
  status: string;
  description?: string | null;
  createdAt: string;
  mailbox?: { id: string; emailAddress: string; displayName?: string | null } | null;
  template?: { id: string; name: string; subject: string; body: string } | null;
  recipients?: Array<{
    id: string;
    status: string;
    snapshotBrand?: string | null;
    snapshotEmail?: string | null;
    productCategory?: string | null;
    contact?: { brandName?: string | null; email: string; name?: string | null } | null;
  }>;
  scheduledJobs?: Array<{ id: string; status: string; runAt: string }>;
};

function getRelativeSendTime(dateStr?: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  if (diffSec < -3600) return "Dispatched";
  if (diffSec <= 0) return "In dispatch queue";
  if (diffSec < 60) return `in ${diffSec}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `in ${diffMin} min${diffMin > 1 ? "s" : ""}`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `in ${diffHr} hr${diffHr > 1 ? "s" : ""}`;
  const diffDay = Math.round(diffHr / 24);
  return `in ${diffDay} day${diffDay > 1 ? "s" : ""}`;
}

function format(value: string | null, zone: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone || "Asia/Karachi",
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

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
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

export function ScheduledWorkspace() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [campaigns, setCampaigns] = useState<ScheduledCampaign[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("ALL");
  const [queueTab, setQueueTab] = useState<"ALL" | "WEBFORMS" | "PENDING" | "SENT" | "FOLLOW_UPS" | "CANCELLED">("ALL");
  const [previewJob, setPreviewJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Quick Direct Schedule Form State
  const [directEmail, setDirectEmail] = useState("");
  const [directTime, setDirectTime] = useState("");
  const [directSubject, setDirectSubject] = useState("");
  const [directBody, setDirectBody] = useState("");
  const [directCampaignName, setDirectCampaignName] = useState("");
  const [directSending, setDirectSending] = useState(false);
  const [sendMode, setSendMode] = useState<"now" | "schedule">("schedule");
  const [delaySeconds, setDelaySeconds] = useState(60); // 1 minute default
  const [customDelay, setCustomDelay] = useState("60");
  const [delayUnit, setDelayUnit] = useState<"seconds" | "minutes">("seconds");
  const [mailboxes, setMailboxes] = useState<Array<{ id: string; emailAddress: string; displayName?: string | null; smtpStatus: string }>>([]);
  const [selectedMailboxId, setSelectedMailboxId] = useState("");
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; subject: string; body: string }>>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [lastScheduledBrand, setLastScheduledBrand] = useState<{
    brandName: string;
    email: string;
    category?: string;
    campaignName?: string;
  } | null>(null);
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpDays, setFollowUpDays] = useState(3);
  const [followUpTemplateId, setFollowUpTemplateId] = useState("");
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  // Test email send state (for verifying professional brand emails before dispatch)
  const [testEmailRecipient, setTestEmailRecipient] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testNotice, setTestNotice] = useState("");
  const [testError, setTestError] = useState("");

  // Edit Campaign State in Scheduled Workspace
  const [activeSendingStatus, setActiveSendingStatus] = useState<any>(null);
  const [editCampaignModalOpen, setEditCampaignModalOpen] = useState(false);
  const [targetEditCampaign, setTargetEditCampaign] = useState<any>(null);
  const [editCampaignName, setEditCampaignName] = useState("");
  const [editCampaignDescription, setEditCampaignDescription] = useState("");
  const [editCampaignMailboxId, setEditCampaignMailboxId] = useState("");
  const [editCampaignTemplateId, setEditCampaignTemplateId] = useState("");
  const [editCampaignSubject, setEditCampaignSubject] = useState("");
  const [editCampaignBody, setEditCampaignBody] = useState("");
  const [editCampaignDelaySeconds, setEditCampaignDelaySeconds] = useState(60);
  const [editCampaignSaving, setEditCampaignSaving] = useState(false);

  // Campaign Schedule & Forward Modal State (for real-time scheduled delivery)
  const [scheduleCampModalOpen, setScheduleCampModalOpen] = useState(false);
  const [targetCampForSchedule, setTargetCampForSchedule] = useState<ScheduledCampaign | null>(null);
  const [campSendMode, setCampSendMode] = useState<"sendNow" | "schedule">("schedule");
  const [campDate, setCampDate] = useState("");
  const [campTime, setCampTime] = useState("");
  const [campDelaySeconds, setCampDelaySeconds] = useState(60);
  const [campCustomDelay, setCampCustomDelay] = useState("60");
  const [campDelayUnit, setCampDelayUnit] = useState<"seconds" | "minutes">("seconds");
  const [campMailboxId, setCampMailboxId] = useState("");
  const [campFollowUpEnabled, setCampFollowUpEnabled] = useState(false);
  const [campFollowUpDays, setCampFollowUpDays] = useState(3);
  const [campFollowUpTemplateId, setCampFollowUpTemplateId] = useState("");
  const [campSchedulingBusy, setCampSchedulingBusy] = useState(false);
  const [campQueueWebforms, setCampQueueWebforms] = useState(true);

  // Webform Integration State in Scheduled Workspace
  const [urlModalJob, setUrlModalJob] = useState<Job | null>(null);
  const [urlModalValue, setUrlModalValue] = useState("");
  const [urlModalBusy, setUrlModalBusy] = useState(false);
  const [viewFilter, setViewFilter] = useState<"ALL" | "WITH_WEBFORM" | "PENDING" | "SENT">("ALL");

  async function handleOpenEditCampaignModal(camp: any) {
    setTargetEditCampaign(camp);
    setEditCampaignName(camp.name || "");
    setEditCampaignDescription(camp.description || "");
    setEditCampaignMailboxId(camp.mailboxId || camp.mailbox?.id || selectedMailboxId || "");
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

    setEditCampaignModalOpen(true);
  }

  async function handleSaveEditedCampaign(e: React.FormEvent) {
    e.preventDefault();
    if (!targetEditCampaign) return;
    setEditCampaignSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${targetEditCampaign.id}`, {
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
      setNotice(`✓ Campaign "${editCampaignName.trim()}" updated successfully.`);
      setEditCampaignModalOpen(false);
      await load();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      setError(err.message || "Failed to save campaign.");
    } finally {
      setEditCampaignSaving(false);
    }
  }

  async function handleSwitchActiveSender(newId: string) {
    setSelectedMailboxId(newId);
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
      if (previewJob) {
        const mb = mailboxes.find((m) => m.id === newId);
        if (mb) {
          setPreviewJob({
            ...previewJob,
            senderEmail: mb.emailAddress,
            senderDisplayName: mb.displayName || null,
            ...(previewJob.campaign
              ? {
                  campaign: {
                    ...previewJob.campaign,
                    mailbox: {
                      id: mb.id,
                      emailAddress: mb.emailAddress,
                      displayName: mb.displayName || null,
                    },
                  },
                }
              : {}),
          });
        }
      }
    } catch {}
  }

  // Open Schedule & Forward Modal for a Campaign
  function handleOpenScheduleCampModal(camp: ScheduledCampaign) {
    setTargetCampForSchedule(camp);
    setCampSendMode(camp.status === "SENDING" ? "sendNow" : "schedule");
    setCampMailboxId(camp.mailbox?.id || selectedMailboxId || mailboxes[0]?.id || "");

    const nextHour = new Date(Date.now() + 60 * 60 * 1000);
    const nextHourParts = getKarachiParts(nextHour);

    // If campaign already has scheduled pending jobs with a future runAt, pre-fill that
    const firstPending = camp.scheduledJobs?.find((j) => j.status === "PENDING");
    if (firstPending?.runAt) {
      const jobDate = new Date(firstPending.runAt);
      if (!isNaN(jobDate.getTime()) && jobDate.getTime() > Date.now()) {
        const p = getKarachiParts(jobDate);
        setCampDate(p.date);
        setCampTime(p.time);
      } else {
        setCampDate(nextHourParts.date);
        setCampTime(nextHourParts.time);
      }
    } else {
      setCampDate(nextHourParts.date);
      setCampTime(nextHourParts.time);
    }

    setCampDelaySeconds(60);
    setCampCustomDelay("60");
    setCampDelayUnit("seconds");
    setCampFollowUpEnabled(false);
    setCampFollowUpDays(3);
    setCampFollowUpTemplateId(templates[0]?.id || "");
    setScheduleCampModalOpen(true);
  }

  // Opens Schedule & Follow-up Configuration Modal
  function handleForwardCampaign(camp: ScheduledCampaign) {
    handleOpenScheduleCampModal(camp);
  }

  function setCampQuickHours(hours: number) {
    const d = new Date(Date.now() + hours * 3600 * 1000);
    const p = getKarachiParts(d);
    setCampDate(p.date);
    setCampTime(p.time);
  }

  function setCampTomorrowTime(hour: number, minute: number = 0) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const p = getKarachiParts(d);
    const pad = (n: number) => String(n).padStart(2, "0");
    setCampDate(p.date);
    setCampTime(`${pad(hour)}:${pad(minute)}`);
  }

  function setCampDaysAhead(days: number, hour: number = 10, minute: number = 0) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const p = getKarachiParts(d);
    const pad = (n: number) => String(n).padStart(2, "0");
    setCampDate(p.date);
    setCampTime(`${pad(hour)}:${pad(minute)}`);
  }

  function handleSelectCampDelayPreset(sec: number, _label: string, unit: "seconds" | "minutes" = "seconds") {
    setCampDelaySeconds(sec);
    setCampDelayUnit(unit);
    setCampCustomDelay(unit === "minutes" ? String(sec / 60) : String(sec));
  }

  function handleCustomCampDelayChange(valStr: string, unit: "seconds" | "minutes") {
    setCampCustomDelay(valStr);
    const num = Math.max(0, parseInt(valStr, 10) || 0);
    const sec = unit === "minutes" ? num * 60 : num;
    setCampDelaySeconds(sec);
  }

  async function handleExecuteScheduleCamp(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!targetCampForSchedule) return;

    if (campSendMode === "schedule") {
      if (!campDate || !campTime) {
        setError("Please choose a valid schedule date and time.");
        return;
      }
    }

    setCampSchedulingBusy(true);
    setError("");
    setNotice("");

    try {
      const payload = {
        mode: campSendMode,
        date: campDate,
        time: campTime,
        timezone: "Asia/Karachi",
        delaySeconds: campDelaySeconds,
        mailboxId: campMailboxId || undefined,
        followUpEnabled: campFollowUpEnabled,
        followUpDays: campFollowUpDays,
        followUpTemplateId: campFollowUpTemplateId || undefined,
        queueWebforms: campQueueWebforms,
      };

      const res = await fetch(`/api/campaigns/${targetCampForSchedule.id}/forward`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to schedule/forward campaign.");

      setNotice(data.message || `🚀 Campaign "${targetCampForSchedule.name}" configured and active!`);
      setScheduleCampModalOpen(false);
      setTargetCampForSchedule(null);
      await load();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      setError(err.message || "Failed to configure schedule.");
    } finally {
      setCampSchedulingBusy(false);
    }
  }

  // Live automated website form filling triggered directly from Scheduled page
  async function handleFillWebform(job: Job) {
    const brand = job.brandName || "Brand";
    setBusy(`form-${job.id}`);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/browser-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fill_by_scheduled_job",
          scheduledJobId: job.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.reason || "Failed to fill website form.");
      setNotice(data.message || `✓ Webform processed for ${brand}!`);
      await load();
    } catch (err: any) {
      setError(err.message || "Failed to execute website form automation.");
    } finally {
      setBusy(null);
    }
  }

  // Forward single scheduled email immediately without waiting for scheduled time
  async function handleForwardSingleJob(job: Job) {
    const brand = job.brandName || "this brand";
    setBusy(`forward-job-${job.id}`);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/scheduled/${job.id}/forward`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to forward email.");
      setNotice(data.message || `⚡ Email for "${brand}" forwarded for immediate dispatch!`);
      await load();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      setError(err.message || "Failed to forward email.");
    } finally {
      setBusy(null);
    }
  }

  // Delete campaign from Scheduled Workspace
  async function handleDeleteCampaign(camp: ScheduledCampaign) {
    if (
      !confirm(
        `Are you sure you want to delete campaign "${camp.name}"?\n\nAll pending emails and queue jobs for this campaign will be deleted.`
      )
    ) {
      return;
    }
    setBusy(`del-${camp.id}`);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/${camp.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete campaign.");
      setNotice(`✓ Campaign "${camp.name}" deleted successfully.`);
      await load();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      setError(err.message || "Failed to delete campaign.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSendTestFromPreview() {
    if (!previewJob) return;
    const recipient = testEmailRecipient.trim();
    if (!recipient || !recipient.includes("@")) {
      setTestError("Please enter a valid test email address.");
      return;
    }
    setTestSending(true);
    setTestError("");
    setTestNotice("");
    try {
      const mailboxId = selectedMailboxId || previewJob.campaign?.mailbox?.id || mailboxes.find((m) => m.smtpStatus === "CONNECTED")?.id || mailboxes[0]?.id;
      if (!mailboxId) throw new Error("No verified mailbox available to send test email.");
      const senderObj = mailboxes.find((m) => m.id === mailboxId);
      const subject = previewJob.renderedSubject || previewJob.message?.subject || "Partnership Outreach";
      const body = previewJob.renderedBody || previewJob.message?.body || "";

      const res = await fetch("/api/email/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mailboxId,
          recipient,
          subject,
          body,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send test email.");
      setTestNotice(`✓ Live test email sent from ${senderObj?.emailAddress || "Hostinger"} to ${recipient}! Campaign remains safely stopped. Check your inbox.`);
    } catch (err: any) {
      setTestError(err.message || "Failed to send test email.");
    } finally {
      setTestSending(false);
    }
  }

  // Set default schedule time to tomorrow 10:00 AM (Asia/Karachi)
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const p = getKarachiParts(tomorrow);
    setDirectTime(`${p.date}T10:00`);
  }, []);

  const refreshMailboxes = useCallback(async () => {
    try {
      const r = await fetch("/api/mailboxes");
      const data = await r.json();
      if (data.mailboxes && data.mailboxes.length > 0) {
        setMailboxes(data.mailboxes);
        const savedId = typeof window !== "undefined" ? localStorage.getItem("active_sender_mailbox_id") : null;
        if (savedId && data.mailboxes.some((m: any) => m.id === savedId)) {
          setSelectedMailboxId(savedId);
        } else {
          try {
            const actRes = await fetch("/api/mailboxes/active");
            const actData = await actRes.json();
            if (actData.activeMailboxId && data.mailboxes.some((m: any) => m.id === actData.activeMailboxId)) {
              setSelectedMailboxId(actData.activeMailboxId);
            } else {
              const active = data.mailboxes.find((m: any) => m.smtpStatus === "CONNECTED") || data.mailboxes[0];
              setSelectedMailboxId(active.id);
            }
          } catch {
            const active = data.mailboxes.find((m: any) => m.smtpStatus === "CONNECTED") || data.mailboxes[0];
            setSelectedMailboxId(active.id);
          }
        }
      }
    } catch {}
  }, []);

  // Load verified sender mailboxes & saved templates with real-time periodic synchronization
  useEffect(() => {
    void refreshMailboxes();

    const interval = setInterval(() => {
      void refreshMailboxes();
    }, 7000);

    const onMailboxesUpdated = () => void refreshMailboxes();
    const onSenderChanged = (e: any) => {
      const id = e.detail?.mailboxId;
      if (id) setSelectedMailboxId(id);
    };

    window.addEventListener("mailboxes-updated", onMailboxesUpdated);
    window.addEventListener("sender-mailbox-changed", onSenderChanged);
    return () => {
      clearInterval(interval);
      window.removeEventListener("mailboxes-updated", onMailboxesUpdated);
      window.removeEventListener("sender-mailbox-changed", onSenderChanged);
    };
  }, [refreshMailboxes]);

  // Load last scheduled brand
  useEffect(() => {
    fetch("/api/scheduled/last-brand")
      .then((r) => r.json())
      .then((data) => {
        if (data.lastBrand) {
          setLastScheduledBrand(data.lastBrand);
        }
      })
      .catch(() => {});
  }, []);

  function applyTemplateWithBrand(
    tplSubject: string,
    tplBody: string,
    brand?: { brandName: string; email: string; category?: string } | null
  ) {
    const bName = brand?.brandName || lastScheduledBrand?.brandName || "";
    const bEmail = brand?.email || lastScheduledBrand?.email || directEmail || "";
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
    if (lastScheduledBrand.email) setDirectEmail(lastScheduledBrand.email);
    if (selectedTemplateId) {
      const found = templates.find((t) => t.id === selectedTemplateId);
      if (found) {
        const { subj, bdy } = applyTemplateWithBrand(found.subject, found.body, lastScheduledBrand);
        setDirectSubject(subj);
        setDirectBody(bdy);
      }
    } else {
      setDirectSubject((prev) =>
        prev && prev.trim()
          ? prev
              .replace(/{{\s*brandName\s*}}/gi, lastScheduledBrand.brandName)
              .replace(/{{\s*brand\s*}}/gi, lastScheduledBrand.brandName)
          : `Partnership Proposal with ${lastScheduledBrand.brandName}`
      );
      setDirectBody((prev) =>
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
            setDirectSubject(subj);
            setDirectBody(bdy);
          }
        }
      })
      .catch(() => {});
  }, [lastScheduledBrand]);

  async function load() {
    try {
      const [response, activeRes] = await Promise.all([
        fetch(`/api/scheduled?status=${filter}&page=1`),
        fetch("/api/campaigns/active-status").catch(() => null),
      ]);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setJobs(body.jobs);
      if (body.campaigns) {
        setCampaigns(body.campaigns);
      }
      setActivity(body.lastWorkerActivity);
      if (activeRes && activeRes.ok) {
        const activeData = await activeRes.json();
        setActiveSendingStatus(activeData);
      }
      setLoaded(true);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load jobs.");
    }
  }

  useEffect(() => {
    void load();
    // Fast 4-second poll for real-time dispatch and status sync
    const timer = setInterval(() => void load(), 4000);
    const handleUpdate = () => void load();
    window.addEventListener("mail-counts-updated", handleUpdate);
    window.addEventListener("focus", handleUpdate);
    return () => {
      clearInterval(timer);
      window.removeEventListener("mail-counts-updated", handleUpdate);
      window.removeEventListener("focus", handleUpdate);
    };
  }, [filter]);

  // Parse recipient emails for count and schedule projection
  const parsedRecipientEmails = directEmail
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  function updateDelay(seconds: number) {
    setDelaySeconds(seconds);
    if (seconds % 60 === 0 && seconds >= 60) {
      setDelayUnit("minutes");
      setCustomDelay(String(seconds / 60));
    } else {
      setDelayUnit("seconds");
      setCustomDelay(String(seconds));
    }
  }

  function handleSelectTemplate(id: string) {
    setSelectedTemplateId(id);
    const found = templates.find((t) => t.id === id);
    if (found) {
      const { subj, bdy } = applyTemplateWithBrand(found.subject, found.body, lastScheduledBrand);
      setDirectSubject(subj);
      setDirectBody(bdy);
    }
  }

  function handleCustomDelayChange(val: string, unit: "seconds" | "minutes") {
    setCustomDelay(val);
    setDelayUnit(unit);
    const num = Math.max(0, parseInt(val, 10) || 0);
    setDelaySeconds(unit === "minutes" ? num * 60 : num);
  }

  // Calculate live timeline preview
  const effectiveBaseDate =
    sendMode === "now" ? new Date() : directTime ? new Date(directTime) : new Date();
  const scheduleCount = Math.max(1, parsedRecipientEmails.length);
  const firstEmailTime = effectiveBaseDate;
  const lastEmailTime = new Date(effectiveBaseDate.getTime() + (scheduleCount - 1) * delaySeconds * 1000);
  const totalMinutes = Math.ceil(((scheduleCount - 1) * delaySeconds) / 60);

  function handleDirectSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!directEmail.trim() || !directSubject.trim() || !directBody.trim()) {
      setError("Please fill in recipient email(s), subject, and body.");
      return;
    }

    if (parsedRecipientEmails.length === 0) {
      setError("Please enter at least one valid recipient email address.");
      return;
    }

    if (sendMode === "schedule" && !directTime) {
      setError("Please pick a scheduled date and time.");
      return;
    }

    setError("");
    setNotice("");
    setReviewModalOpen(true);
  }

  async function executeDirectSchedule() {
    const scheduledDate = sendMode === "now" ? new Date().toISOString() : directTime;
    setDirectSending(true);
    setError("");
    setNotice("");

    try {
      const finalSubject = directSubject
        .replace(/{{\s*brandName\s*}}/gi, lastScheduledBrand?.brandName || "Brand")
        .replace(/{{\s*brand\s*}}/gi, lastScheduledBrand?.brandName || "Brand")
        .trim();

      const finalBody = directBody
        .replace(/{{\s*brandName\s*}}/gi, lastScheduledBrand?.brandName || "Brand")
        .replace(/{{\s*brand\s*}}/gi, lastScheduledBrand?.brandName || "Brand")
        .trim();

      const res = await fetch("/api/scheduled/direct", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipientEmail: directEmail,
          scheduleTime: scheduledDate,
          delaySeconds,
          mailboxId: selectedMailboxId || undefined,
          campaignName: directCampaignName.trim() || undefined,
          templateId: selectedTemplateId || undefined,
          followUpEnabled,
          followUpDays,
          followUpTemplateId: followUpTemplateId || undefined,
          timezone: "Asia/Karachi",
          subject: finalSubject,
          body: finalBody,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to schedule email.");

      setReviewModalOpen(false);
      setNotice(
        `✓ Successfully scheduled ${data.count || parsedRecipientEmails.length} email(s)! First send at ${format(
          data.startTime || scheduledDate,
          "Asia/Karachi"
        )} with ${delaySeconds}s interval.${
          followUpEnabled ? ` (Follow-up scheduled after ${followUpDays} days if no reply)` : ""
        }`
      );
      setDirectEmail("");
      setDirectSubject("");
      setDirectBody("");
      setDirectCampaignName("");
      setSelectedTemplateId("");
      setFollowUpEnabled(false);
      setFollowUpDays(3);
      setFollowUpTemplateId("");
      await load();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      setError(err.message || "Failed to schedule.");
    } finally {
      setDirectSending(false);
    }
  }

  async function action(id: string, type: "cancel" | "retry") {
    setBusy(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/scheduled/${id}/${type}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await load();
      setNotice(type === "retry" ? "Retry scheduled." : "Cancelled.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleEmergencyStop(action: "pause" | "cancel" = "pause") {
    const confirmMsg =
      action === "pause"
        ? "Emergency Stop: Immediately freeze/pause all active campaigns and halt pending jobs?"
        : "Emergency Cancel: Cancel all pending emails in queue immediately?";
    if (!confirm(confirmMsg)) return;

    setBusy("emergency");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/campaigns/emergency-stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to trigger emergency stop.");
      setNotice(
        action === "pause"
          ? `🛑 Emergency Stop: ${data.pausedCampaignsCount || 0} campaign(s) safely PAUSED. Worker stop file created.`
          : `✓ All active campaigns and ${data.cancelledJobsCount || 0} scheduled jobs CANCELLED.`
      );
      await load();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
      }
    } catch (err: any) {
      setError(err.message || "Failed to trigger emergency stop.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
      {/* Page Heading */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Scheduled Emails</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Schedule direct emails with custom start times and automated interval delays.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/forms"
            className="rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-200 px-4 py-2 text-xs font-bold text-[#673DE6] shadow-2xs hover:scale-105 active:scale-95 transition-all duration-150 flex items-center gap-1.5 cursor-pointer"
            title="Open Website Form Automation & Live Browser Filling"
          >
            <span>🌐</span>
            <span>Website Forms</span>
          </Link>
          <button
            disabled={busy === "emergency"}
            onClick={() => handleEmergencyStop("pause")}
            className="rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 px-4 py-2 text-xs font-bold text-white shadow-md shadow-red-500/25 hover:shadow-lg hover:shadow-red-500/35 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Emergency Stop: Pause all campaigns and halt sending immediately"
          >
            <span>🛑</span>
            <span>Emergency Stop All</span>
          </button>
          <button
            onClick={() => void load()}
            className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2 text-xs font-bold text-gray-700 shadow-2xs hover:shadow-xs hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs sm:text-sm font-semibold text-emerald-800">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs sm:text-sm font-semibold text-red-800">
          {error}
        </div>
      )}

      {/* Paused Campaign Alert & Control Banner */}
      {(() => {
        const pausedCamp =
          jobs.find((j) => j.campaign?.status === "PAUSED")?.campaign ||
          activeSendingStatus?.pausedCampaigns?.[0];
        if (!pausedCamp) return null;
        return (
          <div className="rounded-3xl border-2 border-amber-300 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15 p-5 sm:p-6 shadow-sm space-y-3 animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center text-xl font-bold shadow-md shadow-amber-500/30 shrink-0">
                  ⏸️
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-extrabold text-amber-950">
                      Campaign is Currently PAUSED: {pausedCamp.name}
                    </h3>
                    <span className="text-[10px] font-extrabold text-amber-800 bg-amber-100 border border-amber-300 px-2.5 py-0.5 rounded-full">
                      ⏸️ Safe Mode (Frozen)
                    </span>
                  </div>
                  <p className="text-xs text-amber-900/80 mt-1">
                    Email sending is stopped. You can edit campaign settings, resume sending to continue the queue, or delete it completely.
                  </p>
                </div>
              </div>

              {/* Action Buttons: Continue, Edit, Delete */}
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  disabled={busy === "resume-camp"}
                  onClick={async () => {
                    setBusy("resume-camp");
                    try {
                      const res = await fetch(`/api/campaigns/${pausedCamp.id}/control`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ action: "resume" }),
                      });
                      if (!res.ok) throw new Error("Failed to continue campaign.");
                      await fetch("/api/campaigns/emergency-resume", { method: "POST" }).catch(() => {});
                      setNotice(`✓ Campaign "${pausedCamp.name}" continued! Queue is back in active sending mode.`);
                      await load();
                      if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
                      }
                    } catch (err: any) {
                      setError(err.message || "Failed to continue campaign.");
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-md shadow-emerald-500/25 transition-all duration-200 flex items-center gap-1.5 cursor-pointer hover:scale-105 active:scale-95 disabled:opacity-50"
                  title="Continue sending emails for this campaign"
                >
                  <span>▶️</span> Continue Campaign
                </button>

                <button
                  type="button"
                  disabled={busy === "edit-camp"}
                  onClick={() => handleOpenEditCampaignModal(pausedCamp)}
                  className="px-3.5 py-2 bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] text-white text-xs font-bold rounded-xl shadow-md shadow-purple-500/25 transition-all duration-200 flex items-center gap-1.5 cursor-pointer hover:scale-105 active:scale-95 disabled:opacity-50"
                  title="Edit campaign settings, templates, or sender"
                >
                  <span>✏️</span> Edit Campaign
                </button>

                <button
                  type="button"
                  disabled={busy === "delete-camp"}
                  onClick={async () => {
                    if (
                      !confirm(
                        `Are you sure you want to delete campaign "${pausedCamp.name}"?\n\nThis will immediately STOP and permanently delete all unsent emails for this campaign.`
                      )
                    ) {
                      return;
                    }
                    setBusy("delete-camp");
                    try {
                      const res = await fetch(`/api/campaigns/${pausedCamp.id}`, { method: "DELETE" });
                      if (!res.ok) throw new Error("Failed to delete campaign.");
                      setNotice(`✓ Campaign "${pausedCamp.name}" deleted successfully.`);
                      await load();
                      if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("mail-counts-updated"));
                      }
                    } catch (err: any) {
                      setError(err.message || "Failed to delete campaign.");
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="px-3 py-2 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-bold rounded-xl shadow-md shadow-red-500/25 transition-all duration-200 flex items-center gap-1 cursor-pointer hover:scale-105 active:scale-95 disabled:opacity-50"
                  title="Delete paused campaign"
                >
                  <span>🗑️</span> Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Live Outreach Campaigns in Scheduled Workspace */}
      <section className="rounded-3xl border border-purple-100 bg-gradient-to-br from-purple-50/50 via-white to-indigo-50/30 p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-purple-100/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#673DE6] to-indigo-700 text-white flex items-center justify-center text-lg font-bold shadow-md shadow-purple-500/20 shrink-0">
              🎯
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-extrabold text-gray-900">
                  Live Outreach Campaigns ({campaigns.length})
                </h2>
                <span className="text-[10px] font-extrabold text-[#673DE6] bg-purple-100/80 border border-purple-200 px-2.5 py-0.5 rounded-full">
                  ⚡ Ready to Forward &amp; Dispatch
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Every campaign created in the system stays live here. Click &quot;Forward / Schedule&quot; to configure dispatch time, intervals, follow-ups, and run in real time.
              </p>
            </div>
          </div>
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-[#673DE6] hover:bg-[#5025D1] px-4 py-2 rounded-xl shadow-xs hover:scale-105 active:scale-95 transition-all duration-150"
          >
            <span>➕</span> Create New Campaign
          </Link>
        </div>

        {campaigns.length === 0 ? (
          <div className="p-8 bg-white rounded-2xl border border-dashed border-purple-200 text-center space-y-2">
            <span className="text-3xl block">📭</span>
            <p className="text-xs font-bold text-gray-800">No campaigns created yet</p>
            <p className="text-[11px] text-gray-500 max-w-md mx-auto">
              Create a campaign from Google Sheets or Manual Entry in the Campaigns tab. It will appear live here, ready to be forwarded anytime.
            </p>
            <div className="pt-2">
              <Link
                href="/campaigns"
                className="inline-block rounded-xl bg-[#673DE6] text-white px-4 py-2 text-xs font-bold shadow-xs hover:bg-[#5025D1] transition"
              >
                Go to Campaigns Workspace
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map((camp) => {
              const totalRecipients = camp.recipients?.length || 0;
              const skippedRecipientsCount = camp.recipients?.filter((r) => r.status === "SKIPPED").length || 0;
              const sentRecipientsCount = camp.recipients?.filter((r) => ["SENT", "REPLIED"].includes(r.status)).length || 0;
              const initialPendingCount = camp.recipients?.filter((r) => ["PENDING", "SENDING"].includes(r.status)).length || 0;
              const pendingJobsCount = camp.scheduledJobs?.filter((j) => j.status === "PENDING").length || 0;
              const completedJobsCount = camp.scheduledJobs?.filter((j) => j.status === "COMPLETED").length || 0;
              const isSending = camp.status === "SENDING";
              const isPaused = camp.status === "PAUSED";
              const isDraft = ["DRAFT", "READY"].includes(camp.status);
              const isInitialComplete = initialPendingCount === 0 && sentRecipientsCount > 0;
              const isScheduled = camp.status === "SCHEDULED" && !isInitialComplete;

              return (
                <div
                  key={camp.id}
                  className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs hover:shadow-md transition-all flex flex-col justify-between gap-3 group"
                >
                  <div className="space-y-2.5">
                    {/* Header: Title + Status Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-bold text-gray-900 text-sm truncate group-hover:text-[#673DE6] transition">
                          {camp.name}
                        </h3>
                        <p className="text-[10px] text-gray-400 font-mono">
                          Created {format(camp.createdAt, "Asia/Karachi")}
                        </p>
                      </div>

                      <span
                        className={`shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                          isSending
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : isInitialComplete
                            ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                            : isScheduled
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : isPaused
                            ? "bg-amber-50 text-amber-800 border border-amber-300"
                            : isDraft
                            ? "bg-purple-50 text-[#673DE6] border border-purple-200"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {isSending && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                        {isInitialComplete ? "✓ All Initial Emails Sent" : camp.status}
                      </span>
                    </div>

                    {/* Stats & Sender */}
                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-gray-50">
                      <div className="bg-gray-50 p-2.5 rounded-xl space-y-1">
                        <span className="block text-[10px] font-bold text-gray-400 uppercase">Target Brands</span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-extrabold text-gray-900 text-sm">
                            {sentRecipientsCount} / {totalRecipients - skippedRecipientsCount} Sent
                          </span>
                          {skippedRecipientsCount > 0 && (
                            <span className="text-[10px] text-gray-500 font-medium">
                              ({skippedRecipientsCount} no email)
                            </span>
                          )}
                        </div>
                        {initialPendingCount > 0 && (
                          <span className="block text-[10px] text-amber-600 font-bold">
                            ⏳ {initialPendingCount} initial pending
                          </span>
                        )}
                        {isInitialComplete && (
                          <span className="block text-[10px] text-emerald-700 font-bold">
                            🎉 100% Dispatched
                          </span>
                        )}
                        {pendingJobsCount > 0 && isInitialComplete && (
                          <span className="block text-[10px] text-blue-600 font-semibold">
                            🔁 {pendingJobsCount} follow-ups scheduled (3d)
                          </span>
                        )}
                      </div>

                      <div className="bg-gray-50 p-2.5 rounded-xl min-w-0">
                        <span className="block text-[10px] font-bold text-gray-400 uppercase">From Mailbox</span>
                        <span className="font-semibold text-gray-900 text-xs truncate block font-mono" title={camp.mailbox?.emailAddress}>
                          {camp.mailbox?.displayName || camp.mailbox?.emailAddress || "Default Sender"}
                        </span>
                      </div>
                    </div>

                    {/* Template preview snippet */}
                    {camp.template && (
                      <div className="text-[11px] text-gray-600 bg-purple-50/50 p-2 rounded-xl border border-purple-100 truncate">
                        <span className="font-bold text-purple-900">Subject: </span>
                        {camp.template.subject}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons: Forward / Schedule, Edit, Delete */}
                  <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      disabled={campSchedulingBusy && targetCampForSchedule?.id === camp.id}
                      onClick={() => handleOpenScheduleCampModal(camp)}
                      className="flex-1 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-2 px-3 text-xs font-bold shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 hover:scale-102 active:scale-98"
                      title="Set schedule time, interval delay, follow-up, and forward campaign"
                    >
                      <span>🚀</span>
                      <span>Forward / Schedule</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEditCampaignModal(camp)}
                      className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 p-2 text-xs font-semibold text-gray-700 transition cursor-pointer"
                      title="Edit Campaign"
                    >
                      ✏️
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteCampaign(camp)}
                      className="rounded-xl border border-gray-200 bg-white hover:bg-red-50 hover:text-red-600 p-2 text-xs font-semibold text-gray-400 transition cursor-pointer"
                      title="Delete Campaign"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Quick Direct Schedule Card: Just Email Address + Time + Delay */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🕒</span>
            <div>
              <h2 className="text-base font-bold text-gray-900">Direct Schedule & Time Spacing (Easy One-Step)</h2>
              <p className="text-xs text-gray-500">
                Specify recipient emails, start time, and delay between consecutive emails. The background queue worker handles spaced delivery in real time.
              </p>
            </div>
          </div>

          {/* Clean Real-Time Sender Selector */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-xl">
              <span className="text-[11px] font-semibold text-gray-500">From:</span>
              <select
                value={selectedMailboxId}
                onChange={(e) => handleSwitchActiveSender(e.target.value)}
                className="bg-transparent text-xs font-semibold text-gray-900 focus:outline-none cursor-pointer"
              >
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName ? `${m.displayName} <${m.emailAddress}>` : m.emailAddress} {m.smtpStatus === "CONNECTED" ? "✓" : ""}
                  </option>
                ))}
              </select>
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full ml-1" title="Real-time Active Mailbox">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Active
              </span>
            </div>
            {mailboxes.length > 1 && (
              <div className="flex items-center gap-1">
                {mailboxes.map((mb) => {
                  const isSelected = mb.id === selectedMailboxId;
                  return (
                    <button
                      key={mb.id}
                      type="button"
                      onClick={() => handleSwitchActiveSender(mb.id)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition cursor-pointer ${
                        isSelected
                          ? "bg-[#673DE6] text-white font-bold"
                          : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      {mb.displayName || mb.emailAddress.split("@")[0]}
                      {isSelected ? " ✓" : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleDirectSchedule} className="space-y-5">
          {/* Recipient Emails */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-gray-700">
                To: Recipient Email Address(es) <span className="text-red-500">*</span>
              </label>
              <span className="text-[11px] font-semibold text-[#673DE6] bg-purple-50 px-2 py-0.5 rounded-full">
                {parsedRecipientEmails.length} valid email{parsedRecipientEmails.length === 1 ? "" : "s"} detected
              </span>
            </div>

            {/* Auto-update Brand from Last Scheduled Brand Banner */}
            {lastScheduledBrand && (
              <div className="mb-2 flex items-center justify-between bg-purple-50/60 border border-purple-100 px-3 py-1.5 rounded-xl text-xs">
                <div className="flex items-center gap-1.5 truncate">
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
                  className="shrink-0 text-[11px] font-bold text-[#673DE6] hover:text-[#5025D1] bg-white border border-purple-200 px-2.5 py-0.5 rounded-md shadow-2xs hover:bg-purple-50 cursor-pointer transition ml-2"
                >
                  ⚡ Auto-fill Brand & Recipient
                </button>
              </div>
            )}

            <textarea
              required
              rows={2}
              placeholder="e.g. brand1@company.com, brand2@store.com (enter multiple emails separated by comma or new line)"
              value={directEmail}
              onChange={(e) => setDirectEmail(e.target.value)}
              className="w-full rounded-xl border border-gray-200 p-2.5 text-xs sm:text-sm focus:border-[#673DE6] focus:outline-none font-mono"
            />
          </div>

          {/* Staggering Settings: Start Time + Interval Difference */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. Start Time */}
            <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-3">
              <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                1. Sending Start Time
              </span>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-gray-800">
                  <input
                    type="radio"
                    name="directSendMode"
                    checked={sendMode === "now"}
                    onChange={() => setSendMode("now")}
                    className="text-[#673DE6] focus:ring-[#673DE6]"
                  />
                  <span>⚡ Start Immediately (Send Now)</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-gray-800">
                  <input
                    type="radio"
                    name="directSendMode"
                    checked={sendMode === "schedule"}
                    onChange={() => setSendMode("schedule")}
                    className="text-[#673DE6] focus:ring-[#673DE6]"
                  />
                  <span>🕒 Schedule Specific Date & Time</span>
                </label>

                {sendMode === "schedule" && (
                  <div className="pt-2 pl-6">
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                      Start Date & Time (Asia/Karachi):
                    </label>
                    <input
                      type="datetime-local"
                      value={directTime}
                      onChange={(e) => setDirectTime(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 focus:border-[#673DE6] focus:outline-none"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* 2. Time Difference / Spacing */}
            <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-3">
              <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                2. Real-Time Delay Between Consecutive Emails
              </span>

              {/* Interval Preset Chips */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  { label: "30 sec", sec: 30 },
                  { label: "1 min", sec: 60 },
                  { label: "2 min", sec: 120 },
                  { label: "5 min", sec: 300 },
                  { label: "10 min", sec: 600 },
                ].map((item) => (
                  <button
                    key={item.sec}
                    type="button"
                    onClick={() => updateDelay(item.sec)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      delaySeconds === item.sec
                        ? "bg-[#673DE6] text-white shadow-2xs"
                        : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Custom Input */}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[11px] font-semibold text-gray-500">Custom Delay:</span>
                <input
                  type="number"
                  min="0"
                  value={customDelay}
                  onChange={(e) => handleCustomDelayChange(e.target.value, delayUnit)}
                  className="w-20 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-mono font-semibold text-gray-900 focus:border-[#673DE6] focus:outline-none"
                />
                <select
                  value={delayUnit}
                  onChange={(e) => handleCustomDelayChange(customDelay, e.target.value as "seconds" | "minutes")}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 focus:outline-none"
                >
                  <option value="seconds">Seconds</option>
                  <option value="minutes">Minutes</option>
                </select>
              </div>

              <p className="text-[11px] text-gray-500">
                The system will wait exactly <strong className="text-purple-700 font-bold">{delaySeconds} seconds</strong> between each consecutive email dispatch.
              </p>
            </div>
          </div>

          {/* Live Schedule Calculation Summary */}
          {parsedRecipientEmails.length > 0 && (
            <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-4 text-xs space-y-2">
              <div className="flex items-center justify-between font-bold text-purple-950">
                <span>📊 Live Schedule Breakdown:</span>
                <span>{parsedRecipientEmails.length} Emails • {delaySeconds}s Gap</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-purple-900 pt-1">
                <div className="bg-white/80 rounded-lg p-2 border border-purple-100">
                  <span className="block text-gray-500 text-[10px] uppercase font-bold">1st Email (Start):</span>
                  <span className="font-semibold text-gray-900">
                    {format(firstEmailTime.toISOString(), "Asia/Karachi")}
                  </span>
                </div>
                <div className="bg-white/80 rounded-lg p-2 border border-purple-100">
                  <span className="block text-gray-500 text-[10px] uppercase font-bold">Last Email (Finish):</span>
                  <span className="font-semibold text-gray-900">
                    {format(lastEmailTime.toISOString(), "Asia/Karachi")}
                  </span>
                </div>
                <div className="bg-white/80 rounded-lg p-2 border border-purple-100">
                  <span className="block text-gray-500 text-[10px] uppercase font-bold">Total Duration:</span>
                  <span className="font-semibold text-gray-900">
                    ~{totalMinutes} {totalMinutes === 1 ? "minute" : "minutes"} ({delaySeconds * (scheduleCount - 1)}s total)
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Campaign Name & Saved Template Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Campaign Name (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. VIP Brand Follow-up Batch"
                value={directCampaignName}
                onChange={(e) => setDirectCampaignName(e.target.value)}
                className="w-full rounded-xl border border-gray-200 p-2.5 text-xs sm:text-sm focus:border-[#673DE6] focus:outline-none font-semibold text-gray-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Use Saved Template (Click to Auto-fill)
              </label>
              <select
                value={selectedTemplateId}
                onChange={(e) => handleSelectTemplate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white p-2.5 text-xs sm:text-sm text-gray-800 focus:border-[#673DE6] focus:outline-none"
              >
                <option value="">-- Choose a saved template or write below --</option>
                {templates.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.isDefault ? "★ (Active Template)" : ""} ({t.subject})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Subject <span className="text-red-500">*</span>
            </label>
            <input
              required
              type="text"
              placeholder="e.g. Partnership Proposal with your Brand"
              value={directSubject}
              onChange={(e) => setDirectSubject(e.target.value)}
              className="w-full rounded-xl border border-gray-200 p-2.5 text-xs sm:text-sm focus:border-[#673DE6] focus:outline-none font-medium"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Message Body <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={4}
              placeholder="Write your email here..."
              value={directBody}
              onChange={(e) => setDirectBody(e.target.value)}
              className="w-full rounded-xl border border-gray-200 p-3 text-xs sm:text-sm focus:border-[#673DE6] focus:outline-none leading-relaxed"
            />
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
                    <option value="">Default: Friendly follow-up reply ("Re: {directSubject || 'Previous Message'}")</option>
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

          <div className="flex justify-end items-center gap-3">
            <span className="text-xs text-gray-400">
              Auto-dispatches via background worker with {delaySeconds}s real-time delay
            </span>
            <button
              type="submit"
              disabled={directSending}
              className="rounded-xl bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-purple-500/25 hover:shadow-lg hover:shadow-purple-500/35 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer disabled:opacity-50"
            >
              {directSending ? "Scheduling..." : "🕒 Schedule Email(s)"}
            </button>
          </div>
        </form>
      </section>

      {/* Scheduled Queue List */}
      <section className="space-y-4">
        {(() => {
          const campaignOptions = Array.from(new Set(jobs.map((j) => j.campaign?.name).filter(Boolean))) as string[];
          const displayedJobs = campaignFilter === "ALL" ? jobs : jobs.filter((j) => j.campaign?.name === campaignFilter);

          const pendingJobs = displayedJobs.filter((j) => j.status === "PENDING" || j.status === "PROCESSING");
          const sentJobs = displayedJobs.filter((j) => j.status === "COMPLETED");
          const followUpJobs = displayedJobs.filter((j) => j.jobType === "FOLLOW_UP");
          const otherJobs = displayedJobs.filter((j) => j.status === "CANCELLED" || j.status === "FAILED");

          function getTargetInfo(job: Job) {
            const email = job.recipientEmail || job.campaignRecipient?.contact.email || (job as any).message?.toAddress || "";
            let brand = job.brandName;
            if (!brand || brand.trim().toLowerCase() === "brand") {
              brand = job.campaignRecipient?.snapshotBrand || job.campaignRecipient?.contact.brandName || job.campaignRecipient?.contact.name;
            }
            if (!brand || brand.trim().toLowerCase() === "brand") {
              if (email && email.includes("@")) {
                const domain = email.split("@")[1].split(".")[0];
                brand = domain.split(/[-_]/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
              } else {
                brand = "Direct Recipient";
              }
            }
            return { brand, email: email || "—" };
          }

          function renderTableRow(job: Job) {
            const { brand: targetBrand, email: targetEmail } = getTargetInfo(job);
            const campaignTitle = job.campaign?.name || "Direct Outreach";
            const isSent = job.status === "COMPLETED";
            const isPending = job.status === "PENDING";
            const isProcessing = job.status === "PROCESSING";
            const isCancelled = job.status === "CANCELLED";

            return (
              <tr
                key={job.id}
                className={`transition border-b border-gray-100 ${
                  isSent
                    ? "border-l-4 border-l-emerald-500 bg-emerald-50/15 hover:bg-emerald-50/30"
                    : isPending
                    ? "border-l-4 border-l-blue-500 bg-blue-50/15 hover:bg-blue-50/30"
                    : isProcessing
                    ? "border-l-4 border-l-purple-500 bg-purple-50/25 animate-pulse"
                    : "border-l-4 border-l-gray-300 bg-gray-50/20 hover:bg-gray-50/40"
                }`}
              >
                {/* 1. Status Badge (PROMINENT FIRST) */}
                <td className="p-3.5 whitespace-nowrap">
                  {isSent ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">
                      ✓ SENT
                    </span>
                  ) : isPending ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-blue-100 text-blue-800 border border-blue-300 shadow-2xs">
                      ⏳ PENDING
                    </span>
                  ) : isProcessing ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-purple-100 text-purple-800 border border-purple-300 shadow-2xs animate-pulse">
                      ⚡ SENDING
                    </span>
                  ) : isCancelled ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-gray-100 text-gray-600 border border-gray-300 shadow-2xs">
                      ✕ CANCELLED
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-red-100 text-red-800 border border-red-300 shadow-2xs">
                      ⚠️ {job.status}
                    </span>
                  )}
                </td>

                {/* 2. Target Brand & Recipient Email */}
                <td className="p-3.5 cursor-pointer group" onClick={() => setPreviewJob(job)}>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isSent ? "bg-emerald-500" : isPending ? "bg-blue-500" : "bg-gray-400"
                      }`}
                    />
                    <span className="font-extrabold text-gray-900 group-hover:text-[#673DE6] text-sm group-hover:underline">
                      {targetBrand}
                    </span>
                    {job.productCategory && job.productCategory !== "General" && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">
                        {job.productCategory}
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-gray-600 mt-0.5 ml-4 font-semibold">
                    {targetEmail}
                  </p>

                  {/* Webform Info */}
                  <div className="mt-1.5 ml-4 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {job.formUrl ? (
                      <>
                        <a
                          href={job.formUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 transition max-w-[200px] truncate"
                          title={job.formUrl}
                        >
                          <span>🌐</span>
                          <span className="truncate">{job.formUrl.replace(/^https?:\/\/(www\.)?/, "")}</span>
                          <span className="opacity-60 text-[9px]">↗</span>
                        </a>

                        {job.formStatus === "SUBMITTED" ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            ✓ Form Submitted
                          </span>
                        ) : job.formStatus === "AWAITING_MANUAL_ACTION" ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 animate-pulse" title={job.websiteFormJob?.manualActionReason || "Captcha or verification required in Chrome"}>
                            ⚠️ Solve Captcha
                          </span>
                        ) : job.formStatus === "IN_PROGRESS" ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-purple-100 text-[#673DE6] border border-purple-300 animate-pulse">
                            ⚡ Filling Form...
                          </span>
                        ) : job.formStatus === "PENDING" ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                            ⏳ Form Queued
                          </span>
                        ) : job.formStatus === "FAILED" ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200" title={job.websiteFormJob?.lastError || "Failed"}>
                            ✕ Form Failed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-gray-100 text-gray-700 border border-gray-200">
                            🌐 Form Ready
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setUrlModalJob(job);
                            setUrlModalValue(job.formUrl || "");
                          }}
                          className="text-[10px] text-gray-400 hover:text-gray-700 transition"
                          title="Edit Webform Link"
                        >
                          ✎
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setUrlModalJob(job);
                          const web = job.campaignRecipient?.contact.website;
                          setUrlModalValue(web ? `${web.replace(/\/+$/, "")}/wholesale` : "");
                        }}
                        className="text-[10px] font-semibold text-[#673DE6] hover:underline inline-flex items-center gap-1"
                        title="Add webform link for this brand"
                      >
                        <span>+ 🌐 Set Webform Link</span>
                      </button>
                    )}
                  </div>
                </td>

                {/* 3. Send Time */}
                <td className="p-3.5 whitespace-nowrap">
                  {isSent ? (
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-emerald-800 text-xs">
                          Sent: {format((job as any).sentAt ?? job.processedAt ?? job.runAt, job.timezone)}
                        </span>
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                          Delivered
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400 block mt-0.5 font-mono">
                        {job.timezone || "Asia/Karachi"}
                      </span>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-gray-900 text-xs">
                          Scheduled: {format(job.nextAttemptAt ?? job.runAt, job.timezone)}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                          {getRelativeSendTime(job.nextAttemptAt ?? job.runAt)}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400 block mt-0.5 font-mono">
                        {job.timezone || "Asia/Karachi"}
                      </span>
                    </div>
                  )}
                </td>

                {/* 4. Campaign & Mailbox */}
                <td className="p-3.5">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 text-[#673DE6] font-bold text-xs border border-purple-100">
                    🎯 {campaignTitle}
                  </span>
                  <p className="text-[11px] text-gray-500 mt-1 truncate max-w-48 font-mono">
                    via {job.senderDisplayName || job.senderEmail || "Default Mailbox"}
                  </p>
                </td>

                {/* 5. Subject & Preview */}
                <td className="p-3.5 max-w-xs">
                  <div className="flex items-center gap-1.5">
                    {job.jobType === "FOLLOW_UP" && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                        🔁 Step #{job.followUpStep || 1}
                      </span>
                    )}
                    <p className="font-semibold text-gray-900 text-xs truncate">
                      {job.renderedSubject || job.message?.subject || "Outreach Proposal"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewJob(job)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#673DE6] hover:text-[#5025D1] hover:underline mt-1 cursor-pointer"
                  >
                    <span>👁️</span> View Live Preview &rarr;
                  </button>
                </td>

                {/* 6. Actions */}
                <td className="p-3.5 text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-1.5">
                    {/* Fill Webform Action */}
                    {job.formUrl ? (
                      <button
                        type="button"
                        disabled={busy === `form-${job.id}`}
                        onClick={() => handleFillWebform(job)}
                        className={`rounded-xl px-2.5 py-1 text-xs font-bold transition-all duration-150 cursor-pointer disabled:opacity-50 flex items-center gap-1 shadow-2xs hover:scale-105 active:scale-95 ${
                          job.formStatus === "SUBMITTED"
                            ? "border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800"
                            : job.formStatus === "AWAITING_MANUAL_ACTION"
                            ? "border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 animate-pulse"
                            : "border border-purple-200 bg-purple-50 hover:bg-purple-100 text-[#673DE6]"
                        }`}
                        title="Open brand website and automatically fill form using Chrome Browser Agent"
                      >
                        <span>{busy === `form-${job.id}` ? "⏳" : "🌐"}</span>
                        <span>
                          {busy === `form-${job.id}`
                            ? "Filling..."
                            : job.formStatus === "SUBMITTED"
                            ? "Re-fill Form"
                            : "Fill Form"}
                        </span>
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setPreviewJob(job)}
                      className="rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 px-3 py-1 text-xs font-bold text-[#673DE6] hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer shadow-2xs"
                      title="Preview email exactly as it will send to this brand"
                    >
                      👁️ Preview
                    </button>
                    {isPending && (
                      <>
                        <button
                          type="button"
                          disabled={busy === `forward-job-${job.id}`}
                          onClick={() => handleForwardSingleJob(job)}
                          className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-2.5 py-1 text-xs font-bold shadow-2xs hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer disabled:opacity-50 flex items-center gap-1"
                          title="Forward and send this email immediately without waiting for scheduled time"
                        >
                          <span>⚡</span>
                          <span>{busy === `forward-job-${job.id}` ? "Sending..." : "Forward Now"}</span>
                        </button>
                        <button
                          type="button"
                          disabled={busy === job.id}
                          onClick={() => action(job.id, "cancel")}
                          className="rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1 text-xs font-bold text-red-600 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {job.status === "FAILED" && (
                      <button
                        type="button"
                        disabled={busy === job.id}
                        onClick={() => action(job.id, "retry")}
                        className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer shadow-2xs"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          }

          function renderJobsTable(
            jobList: Job[],
            title: string,
            subtitle: string,
            theme: "blue" | "green" | "purple" | "gray",
            emptyText: string
          ) {
            const headerColors = {
              blue: "border-blue-200 bg-blue-50/60 text-blue-900",
              green: "border-emerald-200 bg-emerald-50/60 text-emerald-900",
              purple: "border-purple-200 bg-purple-50/60 text-purple-900",
              gray: "border-gray-200 bg-gray-50 text-gray-800",
            };

            const badgeColors = {
              blue: "bg-blue-100 text-blue-800 border-blue-300",
              green: "bg-emerald-100 text-emerald-800 border-emerald-300",
              purple: "bg-purple-100 text-purple-800 border-purple-300",
              gray: "bg-gray-100 text-gray-700 border-gray-300",
            };

            return (
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-xs space-y-0">
                <div className={`p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${headerColors[theme]}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-sm sm:text-base">{title}</h3>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-black border ${badgeColors[theme]}`}>
                        {jobList.length}
                      </span>
                    </div>
                    <p className="text-xs opacity-80 mt-0.5">{subtitle}</p>
                  </div>
                </div>

                {jobList.length === 0 ? (
                  <div className="p-8 text-center text-xs text-gray-400">{emptyText}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[950px] text-left text-xs sm:text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold">
                        <tr>
                          <th className="p-3.5 w-32">Status</th>
                          <th className="p-3.5">Target Brand &amp; Recipient</th>
                          <th className="p-3.5">Date &amp; Time</th>
                          <th className="p-3.5">Campaign &amp; Mailbox</th>
                          <th className="p-3.5">Email Subject &amp; Preview</th>
                          <th className="p-3.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {jobList.map(renderTableRow)}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          }

          return (
            <>
              {/* Header Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-extrabold text-gray-900">
                    Outreach Delivery Status ({displayedJobs.length})
                  </h2>

                  {/* Filter by Campaign */}
                  {campaignOptions.length > 0 && (
                    <select
                      value={campaignFilter}
                      onChange={(e) => setCampaignFilter(e.target.value)}
                      className="rounded-xl border border-purple-200 bg-purple-50/60 px-3 py-1.5 text-xs font-semibold text-[#673DE6] focus:outline-none"
                    >
                      <option value="ALL">All Campaigns ({jobs.length})</option>
                      {campaignOptions.map((name) => (
                        <option key={name} value={name}>
                          🎯 {name} ({jobs.filter((j) => j.campaign?.name === name).length})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {activity && (
                  <span className="text-xs text-gray-400">
                    Worker active: {format(activity, "Asia/Karachi")}
                  </span>
                )}
              </div>

              {/* Prominent Tab Pills (Alag View for Pending & Sent) */}
              <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 pb-2">
                <button
                  type="button"
                  onClick={() => setQueueTab("ALL")}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5 ${
                    queueTab === "ALL"
                      ? "bg-gray-900 text-white shadow-xs"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  <span>📋 All Emails</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20">
                    {displayedJobs.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setQueueTab("WEBFORMS")}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5 ${
                    queueTab === "WEBFORMS"
                      ? "bg-purple-600 text-white shadow-xs"
                      : "bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200"
                  }`}
                >
                  <span>🌐 With Webforms</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-700 text-white font-bold">
                    {displayedJobs.filter((j) => Boolean(j.formUrl)).length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setQueueTab("PENDING")}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5 ${
                    queueTab === "PENDING"
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
                  }`}
                >
                  <span>⏳ Pending Queue</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-700 text-white font-bold">
                    {pendingJobs.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setQueueTab("SENT")}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5 ${
                    queueTab === "SENT"
                      ? "bg-emerald-600 text-white shadow-xs"
                      : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                  }`}
                >
                  <span>✓ Sent &amp; Delivered</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-700 text-white font-bold">
                    {sentJobs.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setQueueTab("FOLLOW_UPS")}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5 ${
                    queueTab === "FOLLOW_UPS"
                      ? "bg-amber-600 text-white shadow-xs"
                      : "bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                  }`}
                >
                  <span>🔁 Follow-ups</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-700 text-white font-bold">
                    {followUpJobs.length}
                  </span>
                </button>

                {otherJobs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setQueueTab("CANCELLED")}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5 ${
                      queueTab === "CANCELLED"
                        ? "bg-gray-600 text-white shadow-xs"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    <span>✕ Cancelled / Failed</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-gray-200 text-gray-700">
                      {otherJobs.length}
                    </span>
                  </button>
                )}
              </div>

              {!loaded ? (
                <div className="p-8 text-center text-xs text-gray-400">Loading scheduled jobs...</div>
              ) : displayedJobs.length === 0 ? (
                <EmptyState
                  title="No scheduled emails in this view"
                  description="Use the quick schedule box above or schedule an outreach campaign to queue emails."
                />
              ) : (
                <div className="space-y-6">
                  {/* Mode 1: ALL — Display separated tables for Pending vs Sent */}
                  {queueTab === "ALL" && (
                    <>
                      {pendingJobs.length > 0 &&
                        renderJobsTable(
                          pendingJobs,
                          "⏳ Pending Outreach Queue",
                          "Emails scheduled and waiting to dispatch at their configured time, or forward immediately",
                          "blue",
                          "No pending emails in queue"
                        )}

                      {sentJobs.length > 0 &&
                        renderJobsTable(
                          sentJobs,
                          "✓ Sent & Delivered Outreach Mails",
                          "Emails successfully sent through Hostinger SMTP and recorded in sent logs",
                          "green",
                          "No sent emails yet"
                        )}

                      {otherJobs.length > 0 &&
                        renderJobsTable(
                          otherJobs,
                          "✕ Cancelled / Stopped Jobs",
                          "Follow-up emails automatically cancelled because recipient replied or campaign was stopped",
                          "gray",
                          "No cancelled emails"
                        )}
                    </>
                  )}

                  {/* Mode 2: PENDING Tab */}
                  {queueTab === "PENDING" &&
                    renderJobsTable(
                      pendingJobs,
                      "⏳ Pending Outreach Queue",
                      "Emails scheduled and waiting to dispatch at their configured time, or forward immediately",
                      "blue",
                      "No pending emails in queue"
                    )}

                  {/* Mode 3: SENT Tab */}
                  {queueTab === "SENT" &&
                    renderJobsTable(
                      sentJobs,
                      "✓ Sent & Delivered Outreach Mails",
                      "Emails successfully sent through Hostinger SMTP and recorded in sent logs",
                      "green",
                      "No sent emails yet"
                    )}

                  {/* Mode 4: FOLLOW-UPS Tab */}
                  {queueTab === "FOLLOW_UPS" &&
                    renderJobsTable(
                      followUpJobs,
                      "🔁 Automated Follow-up Steps",
                      "Step #1, Step #2 follow-ups scheduled if brand does not reply",
                      "purple",
                      "No follow-up emails in queue"
                    )}

                  {/* Mode 5: CANCELLED Tab */}
                  {queueTab === "CANCELLED" &&
                    renderJobsTable(
                      otherJobs,
                      "✕ Cancelled / Stopped Jobs",
                      "Emails cancelled because recipient replied or campaign stopped",
                      "gray",
                      "No cancelled jobs"
                    )}

                  {/* Mode 6: WEBFORMS Tab */}
                  {queueTab === "WEBFORMS" &&
                    renderJobsTable(
                      displayedJobs.filter((j) => Boolean(j.formUrl)),
                      "🌐 Brands with Website Form Links",
                      "Directly fill and submit brand contact and wholesale application forms using Chrome Browser Agent",
                      "purple",
                      "No brands with webform links found in this campaign view"
                    )}
                </div>
              )}
            </>
          );
        })()}
      </section>

      {/* Live Email Preview Modal */}
      {previewJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border border-gray-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-purple-50 via-white to-blue-50 border-b border-gray-100 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#673DE6] text-white">
                    Target Brand
                  </span>
                  <h3 className="text-base font-bold text-gray-900">{previewJob.brandName || "Brand"}</h3>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Scheduled send time: <strong className="text-gray-900">{format(previewJob.nextAttemptAt ?? previewJob.runAt, previewJob.timezone)}</strong> ({getRelativeSendTime(previewJob.nextAttemptAt ?? previewJob.runAt)})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewJob(null)}
                className="text-gray-400 hover:text-gray-700 text-lg font-bold p-1 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-gray-50 rounded-xl border border-gray-200 text-xs">
                <div>
                  <span className="text-gray-500 font-semibold">To (Brand Email):</span>
                  <p className="font-bold text-gray-900 mt-0.5 font-mono">{previewJob.recipientEmail || "No email"}</p>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold">From (Mailbox):</span>
                  <p className="font-bold text-purple-700 mt-0.5 truncate">
                    {previewJob.senderDisplayName ? `${previewJob.senderDisplayName} ` : ""}
                    <span className="font-mono text-gray-500">({previewJob.senderEmail})</span>
                  </p>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold">Campaign:</span>
                  <p className="font-bold text-gray-800 mt-0.5">{previewJob.campaign?.name || "Direct Outreach"}</p>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold">Product Category:</span>
                  <p className="font-bold text-emerald-700 mt-0.5">{previewJob.productCategory || "General"}</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Email Subject (Rendered):</label>
                <div className="p-3 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm font-bold text-gray-900 shadow-2xs">
                  {previewJob.renderedSubject || previewJob.message?.subject || "Outreach Proposal"}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">
                  Email Body (Brand View — Exact Layout &amp; Signature):
                </label>
                <div
                  className="p-5 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm text-gray-900 leading-relaxed min-h-[160px] font-sans shadow-2xs overflow-x-auto"
                  dangerouslySetInnerHTML={{
                    __html: formatEmailBodyToHtml(previewJob.renderedBody || ""),
                  }}
                />
              </div>

              {/* Send Test Email to Verify Before Dispatching to Real Brands */}
              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🧪</span>
                    <span className="text-xs font-bold text-blue-950">
                      Send Test Email to My ID (Mandatory Safety Check):
                    </span>
                  </div>
                  <span className="text-[11px] font-bold text-amber-800 bg-amber-100/90 px-2.5 py-0.5 rounded-full border border-amber-300 self-start sm:self-auto">
                    ⏸️ Real Brands Remain Stopped / Paused
                  </span>
                </div>
                <p className="text-[11px] text-gray-600 leading-relaxed">
                  Send this exact rendered email for <strong>{previewJob.brandName}</strong> to your own test email address. Verify tone, branding, and formatting in your real inbox before issuing the proceed order.
                </p>

                {/* Real-time Hostinger Sender Switcher */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 bg-white/90 border border-blue-200 rounded-xl">
                  <div className="flex items-center gap-1.5 text-xs text-blue-950 font-bold">
                    <span>📤</span>
                    <span>Hostinger Sender ID:</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedMailboxId || previewJob.campaign?.mailbox?.id || mailboxes[0]?.id || ""}
                      onChange={(e) => handleSwitchActiveSender(e.target.value)}
                      className="text-xs font-bold text-gray-900 bg-white border border-blue-300 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-600 cursor-pointer shadow-2xs"
                    >
                      {mailboxes.map((mb) => (
                        <option key={mb.id} value={mb.id}>
                          {mb.displayName ? `[${mb.displayName}] ` : ""}{mb.emailAddress} {mb.smtpStatus === "CONNECTED" ? "✓ (Verified)" : ""}
                        </option>
                      ))}
                    </select>
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Real-Time Active
                    </span>
                  </div>
                </div>

                {/* 1-Click Switcher Pills */}
                {mailboxes.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5 px-0.5">
                    <span className="text-[10px] font-semibold text-gray-500">Quick Switch:</span>
                    {mailboxes.map((mb) => {
                      const isSelected = mb.id === (selectedMailboxId || previewJob.campaign?.mailbox?.id);
                      return (
                        <button
                          key={mb.id}
                          type="button"
                          onClick={() => handleSwitchActiveSender(mb.id)}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold transition border cursor-pointer ${
                            isSelected
                              ? "bg-[#673DE6] text-white border-[#673DE6] shadow-2xs font-bold"
                              : "bg-white text-gray-700 border-gray-200 hover:border-purple-300 hover:bg-purple-50/40"
                          }`}
                        >
                          {mb.displayName && <span className="font-bold">{mb.displayName}</span>}
                          <span className="font-mono text-[10px]">({mb.emailAddress})</span>
                          {isSelected && <span className="text-[9px] bg-white/20 px-1 rounded">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Paused Campaign Quick Controls inside Live Preview */}
                {previewJob.campaign?.status === "PAUSED" && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3.5 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15 border-2 border-amber-300 rounded-2xl shadow-2xs">
                    <div className="flex items-center gap-2">
                      <span className="text-base">⏸️</span>
                      <div>
                        <p className="text-xs font-extrabold text-amber-950">
                          Campaign is PAUSED: {previewJob.campaign.name}
                        </p>
                        <p className="text-[11px] text-amber-900/80">
                          Emails are frozen. Verify with test email below, then continue or edit.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!previewJob.campaign) return;
                          try {
                            const res = await fetch(`/api/campaigns/${previewJob.campaign.id}/control`, {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ action: "resume" }),
                            });
                            if (!res.ok) throw new Error("Failed to continue campaign.");
                            await fetch("/api/campaigns/emergency-resume", { method: "POST" }).catch(() => {});
                            setTestNotice(`✓ Campaign "${previewJob.campaign.name}" continued! Sending has resumed.`);
                            await load();
                            if (typeof window !== "undefined") {
                              window.dispatchEvent(new CustomEvent("mail-counts-updated"));
                            }
                          } catch (err: any) {
                            setTestError(err.message || "Failed to continue campaign.");
                          }
                        }}
                        className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer"
                        title="Resume sending this campaign"
                      >
                        <span>▶️</span> Continue Campaign
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (previewJob.campaign) {
                            handleOpenEditCampaignModal(previewJob.campaign);
                          }
                        }}
                        className="px-3 py-1.5 bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-1 cursor-pointer"
                        title="Edit campaign settings or template"
                      >
                        <span>✏️</span> Edit
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="email"
                    placeholder="Enter your personal test email address (e.g. name@gmail.com)..."
                    value={testEmailRecipient}
                    onChange={(e) => setTestEmailRecipient(e.target.value)}
                    className="flex-1 text-xs font-semibold px-3.5 py-2.5 border border-gray-300 rounded-xl bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600 shadow-2xs"
                  />
                  <button
                    type="button"
                    disabled={testSending || !testEmailRecipient.trim()}
                    onClick={handleSendTestFromPreview}
                    className="px-5 py-2.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-extrabold rounded-xl shadow-md shadow-blue-500/25 hover:shadow-lg hover:shadow-blue-500/35 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    {testSending ? (
                      <>
                        <span className="animate-spin inline-block h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                        Sending Test...
                      </>
                    ) : (
                      <>
                        <span>🚀</span> Send 1 Test Email
                      </>
                    )}
                  </button>
                </div>

                {testNotice && (
                  <div className="text-xs font-bold text-emerald-800 bg-emerald-100/90 border border-emerald-300 p-2.5 rounded-xl flex items-center justify-between">
                    <span>{testNotice}</span>
                    <button type="button" onClick={() => setTestNotice("")} className="text-emerald-700 hover:text-emerald-900 font-bold ml-2">✕</button>
                  </div>
                )}
                {testError && (
                  <div className="text-xs font-bold text-red-800 bg-red-100/90 border border-red-300 p-2.5 rounded-xl flex items-center justify-between">
                    <span>{testError}</span>
                    <button type="button" onClick={() => setTestError("")} className="text-red-700 hover:text-red-900 font-bold ml-2">✕</button>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer with Next / Prev */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {(() => {
                  const idx = jobs.findIndex((j) => j.id === previewJob.id);
                  return (
                    <>
                      <button
                        type="button"
                        disabled={idx <= 0}
                        onClick={() => setPreviewJob(jobs[idx - 1])}
                        className="px-3.5 py-1.5 text-xs font-bold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-100 hover:scale-105 active:scale-95 transition-all duration-150 disabled:opacity-30 cursor-pointer shadow-2xs"
                      >
                        &larr; Previous Brand
                      </button>
                      <span className="text-xs text-gray-500 font-medium">
                        Brand {idx + 1} of {jobs.length}
                      </span>
                      <button
                        type="button"
                        disabled={idx >= jobs.length - 1}
                        onClick={() => setPreviewJob(jobs[idx + 1])}
                        className="px-3.5 py-1.5 text-xs font-bold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-100 hover:scale-105 active:scale-95 transition-all duration-150 disabled:opacity-30 cursor-pointer shadow-2xs"
                      >
                        Next Brand &rarr;
                      </button>
                    </>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2">
                {previewJob.status === "PENDING" && (
                  <button
                    type="button"
                    disabled={busy === `forward-job-${previewJob.id}`}
                    onClick={async () => {
                      await handleForwardSingleJob(previewJob);
                      setPreviewJob(null);
                    }}
                    className="px-4 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-xs hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <span>⚡</span>
                    <span>{busy === `forward-job-${previewJob.id}` ? "Sending..." : "Forward & Send Now"}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewJob(null)}
                  className="px-4 py-1.5 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-gray-700 hover:to-gray-800 text-white text-xs font-bold rounded-xl shadow-xs hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
                >
                  Close Preview
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mandatory Pre-Send Template Review Modal */}
      {reviewModalOpen && (
        <PreSendReviewModal
          isOpen={reviewModalOpen}
          onClose={() => setReviewModalOpen(false)}
          onConfirm={executeDirectSchedule}
          isConfirming={directSending}
          campaignTitle={directCampaignName.trim() || "Direct Outreach"}
          senderMailbox={
            mailboxes.find((m) => m.id === selectedMailboxId)?.emailAddress || "Default Mailbox"
          }
          totalRecipients={parsedRecipientEmails.length}
          sendMode={sendMode}
          scheduledTime={sendMode === "schedule" ? directTime : undefined}
          delayAmount={delaySeconds}
          delayUnit={delayUnit}
          subjectTemplate={directSubject}
          bodyTemplate={directBody}
          followUpEnabled={followUpEnabled}
          followUpDays={followUpDays}
          recipients={
            parsedRecipientEmails.length > 0
              ? parsedRecipientEmails.map((email, idx) => ({
                  brandName: directCampaignName.trim() ? `${directCampaignName.trim()} #${idx + 1}` : "Target Recipient",
                  brandEmail: email,
                  productCategory: "Direct Email Outreach",
                }))
              : [
                  {
                    brandName: "Direct Recipient",
                    brandEmail: directEmail,
                    productCategory: "Direct Email Outreach",
                  },
                ]
          }
        />
      )}

      {/* Universal Campaign Edit Modal in Scheduled Workspace */}
      {editCampaignModalOpen && targetEditCampaign && (
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
                onClick={() => setEditCampaignModalOpen(false)}
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
                  onClick={() => setEditCampaignModalOpen(false)}
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

      {/* Schedule & Follow-up Configuration Modal for Real-Time Delivery */}
      {scheduleCampModalOpen && targetCampForSchedule && (() => {
        const totalTargetBrands =
          targetCampForSchedule.recipients?.length ||
          targetCampForSchedule.scheduledJobs?.length ||
          0;

        let projectedStartTime = "Now";
        let projectedEndTime = "—";
        try {
          let startMs = Date.now();
          if (campSendMode === "schedule" && campDate && campTime) {
            const s = new Date(`${campDate}T${campTime}:00`);
            if (!isNaN(s.getTime())) {
              startMs = s.getTime();
              projectedStartTime = new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(s);
            }
          } else {
            projectedStartTime = "Immediately (Real Time)";
          }

          if (totalTargetBrands > 0) {
            const endMs = startMs + Math.max(0, totalTargetBrands - 1) * campDelaySeconds * 1000;
            projectedEndTime = new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(endMs));
          }
        } catch {}

        return (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl border border-purple-200 my-8 animate-in fade-in zoom-in-95 duration-150 space-y-4">
              {/* Modal Header */}
              <div className="flex items-start justify-between pb-3 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#673DE6] to-[#5025D1] text-white flex items-center justify-center text-lg font-bold shadow-md shadow-purple-500/25">
                    🕒
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-extrabold text-gray-900 tracking-tight">
                        Schedule & Follow-up Settings
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-[#673DE6] border border-purple-200">
                        {targetCampForSchedule.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 font-medium truncate max-w-sm">
                      Campaign: <span className="font-bold text-gray-800">{targetCampForSchedule.name}</span> ({totalTargetBrands} target brands)
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setScheduleCampModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 text-sm p-1.5 rounded-xl hover:bg-gray-100 transition cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Form Body */}
              <form onSubmit={handleExecuteScheduleCamp} className="space-y-4 text-xs">
                {/* 1. Send Mode Selector */}
                <div>
                  <label className="block font-bold text-gray-700 mb-1.5 uppercase text-[10px] tracking-wider">
                    Dispatch Mode
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setCampSendMode("schedule")}
                      className={`p-3 rounded-2xl border text-left transition flex items-start gap-2.5 cursor-pointer ${
                        campSendMode === "schedule"
                          ? "border-[#673DE6] bg-purple-50/70 shadow-xs ring-2 ring-[#673DE6]/20"
                          : "border-gray-200 bg-white hover:bg-gray-50"
                      }`}
                    >
                      <span className="text-xl">🕒</span>
                      <div>
                        <div className="font-extrabold text-gray-900 text-xs">Specific Date & Time</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          Schedule for a precise future time
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCampSendMode("sendNow")}
                      className={`p-3 rounded-2xl border text-left transition flex items-start gap-2.5 cursor-pointer ${
                        campSendMode === "sendNow"
                          ? "border-[#673DE6] bg-purple-50/70 shadow-xs ring-2 ring-[#673DE6]/20"
                          : "border-gray-200 bg-white hover:bg-gray-50"
                      }`}
                    >
                      <span className="text-xl">⚡</span>
                      <div>
                        <div className="font-extrabold text-gray-900 text-xs">Send Now (Instant Spaced)</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          Start sending immediately with safe gaps
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* 2. Schedule Date & Time Picker (When schedule mode selected) */}
                {campSendMode === "schedule" && (
                  <div className="p-3.5 bg-gray-50/80 rounded-2xl border border-gray-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-gray-800 text-xs flex items-center gap-1.5">
                        <span>📅</span> Pick Target Date & Start Time
                      </span>
                      <span className="text-[10px] font-bold text-purple-700 bg-purple-100/70 px-2 py-0.5 rounded-full font-mono">
                        🇵🇰 Asia/Karachi (PKT)
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 mb-1">Date</label>
                        <input
                          type="date"
                          required
                          value={campDate}
                          onChange={(e) => setCampDate(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-xl bg-white font-bold text-gray-900 text-xs focus:ring-2 focus:ring-[#673DE6] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 mb-1">Time</label>
                        <input
                          type="time"
                          required
                          value={campTime}
                          onChange={(e) => setCampTime(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-xl bg-white font-bold text-gray-900 text-xs focus:ring-2 focus:ring-[#673DE6] focus:outline-none font-mono"
                        />
                      </div>
                    </div>

                    {/* Quick Time Presets */}
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                        Quick Presets:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setCampQuickHours(1)}
                          className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-purple-50 hover:border-purple-300 text-[10px] font-bold text-gray-700 transition cursor-pointer"
                        >
                          +1 Hour
                        </button>
                        <button
                          type="button"
                          onClick={() => setCampTomorrowTime(10, 0)}
                          className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-purple-50 hover:border-purple-300 text-[10px] font-bold text-gray-700 transition cursor-pointer"
                        >
                          Tomorrow 10:00 AM
                        </button>
                        <button
                          type="button"
                          onClick={() => setCampTomorrowTime(14, 0)}
                          className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-purple-50 hover:border-purple-300 text-[10px] font-bold text-gray-700 transition cursor-pointer"
                        >
                          Tomorrow 02:00 PM
                        </button>
                        <button
                          type="button"
                          onClick={() => setCampDaysAhead(2, 10, 0)}
                          className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-purple-50 hover:border-purple-300 text-[10px] font-bold text-gray-700 transition cursor-pointer"
                        >
                          In 2 Days
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Delay Spacing Interval */}
                <div className="p-3.5 bg-gray-50/80 rounded-2xl border border-gray-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block font-bold text-gray-800 text-xs">
                        ⏱️ Delay Gap Between Brand Emails
                      </label>
                      <p className="text-[10px] text-gray-500">
                        Protects Hostinger reputation & avoids spam filters
                      </p>
                    </div>
                    <span className="font-extrabold text-[#673DE6] font-mono text-xs bg-purple-100/70 px-2.5 py-1 rounded-xl">
                      {campDelaySeconds >= 60
                        ? `${campDelaySeconds / 60}m (${campDelaySeconds}s)`
                        : `${campDelaySeconds}s`} gap
                    </span>
                  </div>

                  {/* Preset Pills */}
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { sec: 15, label: "15s" },
                      { sec: 30, label: "30s" },
                      { sec: 60, label: "60s (1m - Safe)", recommended: true },
                      { sec: 120, label: "2 mins" },
                      { sec: 300, label: "5 mins" },
                    ].map((item) => {
                      const isSel = campDelaySeconds === item.sec;
                      return (
                        <button
                          key={item.sec}
                          type="button"
                          onClick={() => handleSelectCampDelayPreset(item.sec, item.label)}
                          className={`px-2.5 py-1 rounded-xl text-[10px] font-bold transition cursor-pointer border ${
                            isSel
                              ? "bg-[#673DE6] text-white border-[#673DE6] shadow-xs"
                              : item.recommended
                              ? "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100"
                              : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
                          }`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom Delay Input */}
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[10px] font-bold text-gray-500">Custom Delay:</span>
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      value={campCustomDelay}
                      onChange={(e) => handleCustomCampDelayChange(e.target.value, campDelayUnit)}
                      className="w-20 px-2.5 py-1 border border-gray-300 rounded-lg text-center font-bold text-gray-900 bg-white text-xs focus:ring-2 focus:ring-[#673DE6] focus:outline-none"
                    />
                    <select
                      value={campDelayUnit}
                      onChange={(e) => {
                        const u = e.target.value as "seconds" | "minutes";
                        setCampDelayUnit(u);
                        handleCustomCampDelayChange(campCustomDelay, u);
                      }}
                      className="px-2 py-1 border border-gray-300 rounded-lg bg-white font-semibold text-gray-700 text-xs cursor-pointer focus:ring-2 focus:ring-[#673DE6] focus:outline-none"
                    >
                      <option value="seconds">Seconds</option>
                      <option value="minutes">Minutes</option>
                    </select>
                  </div>
                </div>

                {/* 4. Sender Mailbox */}
                <div>
                  <label className="block font-bold text-gray-700 mb-1 uppercase text-[10px] tracking-wider">
                    Sender Mailbox
                  </label>
                  <select
                    value={campMailboxId}
                    onChange={(e) => setCampMailboxId(e.target.value)}
                    className="w-full px-3.5 py-2 border border-purple-200 rounded-xl focus:ring-2 focus:ring-[#673DE6] focus:outline-none font-bold text-gray-900 bg-white text-xs cursor-pointer"
                  >
                    {mailboxes.map((mb) => (
                      <option key={mb.id} value={mb.id}>
                        {mb.displayName ? `[${mb.displayName}] ` : ""}{mb.emailAddress} {mb.smtpStatus === "CONNECTED" ? "✓ (Verified)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 5. Automated Follow-up Settings */}
                <div className="p-3.5 bg-gray-50/80 rounded-2xl border border-gray-200 space-y-2.5">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={campFollowUpEnabled}
                      onChange={(e) => setCampFollowUpEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-[#673DE6] focus:ring-[#673DE6] mt-0.5 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-gray-900 text-xs">
                        🔁 Enable Automated Follow-up
                      </span>
                      <p className="text-[10px] text-gray-500">
                        Automatically sends a follow-up reminder if the brand does not reply within X days
                      </p>
                    </div>
                  </label>

                  {campFollowUpEnabled && (
                    <div className="pt-2 border-t border-gray-200/80 grid grid-cols-1 sm:grid-cols-2 gap-2.5 animate-in fade-in duration-100">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-600 mb-1">
                          Wait Time (Days)
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={campFollowUpDays}
                            onChange={(e) => setCampFollowUpDays(Math.max(1, parseInt(e.target.value, 10) || 3))}
                            className="w-20 px-2.5 py-1.5 border border-gray-300 rounded-xl font-bold text-gray-900 bg-white text-xs text-center focus:ring-2 focus:ring-[#673DE6] focus:outline-none"
                          />
                          <span className="text-[11px] font-bold text-gray-600">Days if no reply</span>
                        </div>
                      </div>

                      {templates.length > 0 && (
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">
                            Follow-up Template
                          </label>
                          <select
                            value={campFollowUpTemplateId}
                            onChange={(e) => setCampFollowUpTemplateId(e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-xl bg-white font-medium text-gray-900 text-xs cursor-pointer focus:ring-2 focus:ring-[#673DE6] focus:outline-none"
                          >
                            <option value="">Default Follow-up Message</option>
                            {templates.map((tpl) => (
                              <option key={tpl.id} value={tpl.id}>
                                {tpl.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 5.5 Webform Automation Toggle */}
                <div className="p-3.5 bg-purple-50/70 rounded-2xl border border-purple-200/80 space-y-1.5">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={campQueueWebforms}
                      onChange={(e) => setCampQueueWebforms(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-[#673DE6] focus:ring-[#673DE6] mt-0.5 cursor-pointer"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 text-xs">
                          🌐 Also Queue Website Form Automation
                        </span>
                        <span className="px-2 py-0.2 rounded-full text-[10px] font-extrabold bg-purple-100 text-[#673DE6]">
                          Chrome CDP
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        Automatically extracts webform and contact links from campaign brands and queues automated form submissions alongside emails.
                      </p>
                    </div>
                  </label>
                </div>

                {/* 6. Live Delivery Projection Summary Card */}
                <div className="p-3 bg-purple-50/60 rounded-2xl border border-purple-100 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between text-purple-900 font-bold">
                    <span>📋 Dispatch Summary</span>
                    <span className="font-mono">{totalTargetBrands} Recipients</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-gray-600 pt-1 border-t border-purple-100/60 text-[10px]">
                    <div>
                      <span className="text-gray-400 block font-medium">Start Time:</span>
                      <span className="font-bold text-gray-800">{projectedStartTime}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block font-medium">Estimated Completion:</span>
                      <span className="font-bold text-gray-800">{projectedEndTime}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block font-medium">Interval Gap:</span>
                      <span className="font-bold text-purple-700">{campDelaySeconds}s between emails</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block font-medium">Follow-up:</span>
                      <span className="font-bold text-gray-800">
                        {campFollowUpEnabled ? `Active (${campFollowUpDays} days)` : "Disabled"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="pt-3 flex items-center justify-end gap-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setScheduleCampModalOpen(false)}
                    className="px-4 py-2 border border-gray-200 rounded-xl font-semibold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={campSchedulingBusy}
                    className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold rounded-xl shadow-md shadow-emerald-500/25 transition disabled:opacity-50 cursor-pointer hover:scale-102 active:scale-98 flex items-center gap-1.5"
                  >
                    <span>{campSendMode === "sendNow" ? "⚡" : "🕒"}</span>
                    <span>
                      {campSchedulingBusy
                        ? "Configuring..."
                        : campSendMode === "sendNow"
                        ? "Confirm & Dispatch in Real Time"
                        : "Confirm & Schedule Campaign"}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Set/Edit Webform URL Modal */}
      {urlModalJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-xl">🌐</span>
                <div>
                  <h3 className="font-extrabold text-gray-900 text-sm">
                    Webform Link for {urlModalJob.brandName || "Brand"}
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    Set brand contact or wholesale application link
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUrlModalJob(null)}
                className="text-gray-400 hover:text-gray-600 text-sm p-1.5 rounded-lg hover:bg-gray-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-700">
                Webform / Contact Form URL
              </label>
              <input
                type="url"
                value={urlModalValue}
                onChange={(e) => setUrlModalValue(e.target.value)}
                placeholder="https://brand.com/pages/wholesale or https://brand.com/contact"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-[#673DE6] focus:outline-none"
              />
              <p className="text-[10px] text-gray-400">
                This URL is used for real-time Chrome browser automated filling alongside emails.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setUrlModalJob(null)}
                className="px-3.5 py-1.5 border border-gray-200 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={urlModalBusy || !urlModalValue.trim()}
                onClick={async () => {
                  setUrlModalBusy(true);
                  try {
                    const res = await fetch("/api/scheduled", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ jobId: urlModalJob.id, formUrl: urlModalValue.trim() }),
                    });
                    const d = await res.json();
                    if (!res.ok) throw new Error(d.error || "Failed to update link");
                    setNotice(`✓ Webform URL updated for ${urlModalJob.brandName || "Brand"}!`);
                    setUrlModalJob(null);
                    await load();
                  } catch (err: any) {
                    setError(err.message || "Failed to update webform URL.");
                  } finally {
                    setUrlModalBusy(false);
                  }
                }}
                className="px-4 py-1.5 bg-[#673DE6] hover:bg-[#5025D1] text-white text-xs font-bold rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer"
              >
                {urlModalBusy ? "Saving..." : "Save Webform Link"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
