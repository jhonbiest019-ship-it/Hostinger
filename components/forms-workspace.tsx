"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui";

interface WebsiteFormJob {
  id: string;
  targetUrl: string;
  status: "PENDING" | "IN_PROGRESS" | "SUBMITTED" | "AWAITING_MANUAL_ACTION" | "FAILED" | "CANCELLED";
  resolvedValuesJson: string;
  runAt: string;
  submittedAt?: string | null;
  manualActionReason?: string | null;
  lastError?: string | null;
  campaign?: { id: string; name: string; status: string } | null;
  contact?: { id: string; name: string; brandName?: string | null; email: string; website?: string | null } | null;
  formTemplate?: { id: string; name: string } | null;
}

interface FormTemplate {
  id: string;
  name: string;
  description?: string | null;
  fieldsJson: string;
  isDefault: boolean;
}

interface CampaignOption {
  id: string;
  name: string;
  status: string;
  recipientsCount: number;
}

export function FormsWorkspace() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [agentStatus, setAgentStatus] = useState<{ status: string; browser?: string; port?: number }>({
    status: "OFFLINE",
    port: 9222,
  });

  const [metrics, setMetrics] = useState({
    total: 0,
    pending: 0,
    inProgress: 0,
    awaitingManual: 0,
    submitted: 0,
    failed: 0,
  });

  const [jobs, setJobs] = useState<WebsiteFormJob[]>([]);
  const [formTemplates, setFormTemplates] = useState<FormTemplate[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);

  // Filter & tab states
  const [activeTab, setActiveTab] = useState<"queue" | "campaign-import" | "templates">("queue");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Import modal / form state
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  // Preview values modal state
  const [previewValues, setPreviewValues] = useState<{ brand: string; url: string; values: Record<string, any> } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [agentRes, tmplRes, campRes] = await Promise.all([
        fetch("/api/browser-agent"),
        fetch("/api/forms/templates").catch(() => null),
        fetch("/api/campaigns?limit=50").catch(() => null),
      ]);

      if (agentRes.ok) {
        const data = await agentRes.json();
        setAgentStatus(data.agent || { status: "OFFLINE", port: 9222 });
        setMetrics(data.metrics || { total: 0, pending: 0, inProgress: 0, awaitingManual: 0, submitted: 0, failed: 0 });
        setJobs(data.jobs || []);
      }

      if (tmplRes && tmplRes.ok) {
        const tmplData = await tmplRes.json();
        setFormTemplates(tmplData.templates || []);
        if (tmplData.templates?.length > 0 && !selectedTemplateId) {
          const def = tmplData.templates.find((t: FormTemplate) => t.isDefault) || tmplData.templates[0];
          setSelectedTemplateId(def.id);
        }
      }

      if (campRes && campRes.ok) {
        const campData = await campRes.json();
        const list = (campData.campaigns || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          recipientsCount: c.recipients?.length || 0,
        }));
        setCampaigns(list);
        if (list.length > 0 && !selectedCampaignId) {
          setSelectedCampaignId(list[0].id);
        }
      }

      setError("");
    } catch (err: any) {
      setError(err?.message || "Failed to load form automation workspace.");
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId, selectedTemplateId]);

  useEffect(() => {
    void loadData();
    // Fast 4-second real-time polling
    const timer = setInterval(() => void loadData(), 4000);
    return () => clearInterval(timer);
  }, [loadData]);

  // Launch or reconnect browser
  async function handleLaunchBrowser() {
    setBusy("launch-browser");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/browser-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "launch" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to launch browser agent.");
      setNotice("🌐 Local Chrome browser agent connected and ready on port 9222!");
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to connect to local browser.");
    } finally {
      setBusy(null);
    }
  }

  // Trigger all due forms
  async function handleProcessDueForms() {
    setBusy("process-forms");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/browser-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to process form jobs.");
      setNotice(`⚡ Processed ${data.processedCount || 0} website form jobs live in browser.`);
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to trigger form processing.");
    } finally {
      setBusy(null);
    }
  }

  // Live single form fill & submit
  async function handleFillSingleNow(job: WebsiteFormJob) {
    const brand = job.contact?.brandName || "Brand";
    setBusy(`fill-${job.id}`);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/browser-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fill_single_now", jobId: job.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.reason || "Failed to fill form.");
      setNotice(data.message || `Form for ${brand} processed!`);
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to execute form automation.");
    } finally {
      setBusy(null);
    }
  }

  // Resolve manual action (CAPTCHA solved by user)
  async function handleResolveManual(jobId: string, outcome: "SUBMITTED" | "FAILED") {
    setBusy(`manual-${jobId}`);
    try {
      const res = await fetch("/api/browser-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve_manual", jobId, outcome }),
      });
      if (!res.ok) throw new Error("Failed to update status.");
      setNotice(`✓ Form marked as ${outcome}.`);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  // Generate form jobs from an existing campaign
  async function handleGenerateFromCampaign() {
    if (!selectedCampaignId) return;
    setBusy("generate-forms");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/browser-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_from_campaign",
          campaignId: selectedCampaignId,
          formTemplateId: selectedTemplateId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate form jobs.");
      setNotice(data.message || `Successfully generated website form jobs!`);
      setActiveTab("queue");
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to import brands from campaign.");
    } finally {
      setBusy(null);
    }
  }

  const filteredJobs = jobs.filter((j) => {
    if (statusFilter === "ALL") return true;
    return j.status === statusFilter;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🌐</span>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Website Form Automation</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-purple-100 text-[#673DE6] uppercase tracking-wider">
              Real-Time Live CDP Agent
            </span>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Automate wholesale, partnership, and retailer application form submissions directly on brand websites using real Chrome browser tabs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy === "launch-browser"}
            onClick={handleLaunchBrowser}
            className={`px-4 py-2 rounded-xl text-xs font-bold shadow-md transition-all duration-150 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
              agentStatus.status === "READY"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100"
                : "bg-gradient-to-r from-[#673DE6] to-[#5025D1] text-white hover:scale-105 active:scale-95"
            }`}
          >
            <span>{agentStatus.status === "READY" ? "🟢" : "⚡"}</span>
            <span>{busy === "launch-browser" ? "Connecting..." : agentStatus.status === "READY" ? "Browser Agent: Online" : "Connect Chrome Agent"}</span>
          </button>

          <button
            type="button"
            disabled={busy === "process-forms"}
            onClick={handleProcessDueForms}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-gray-900 hover:bg-black text-white shadow-md hover:scale-105 active:scale-95 transition-all duration-150 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <span>▶️</span>
            <span>{busy === "process-forms" ? "Processing..." : "Process Due Forms"}</span>
          </button>

          <button
            type="button"
            onClick={() => void loadData()}
            className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 px-3 py-2 text-xs font-bold text-gray-700 shadow-2xs hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
          >
            ↻
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs sm:text-sm font-semibold text-emerald-800 animate-in fade-in">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs sm:text-sm font-semibold text-red-800 animate-in fade-in">
          {error}
        </div>
      )}

      {/* Live Operational Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white border border-gray-200 p-4 rounded-2xl shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Total Forms</span>
          <span className="text-xl font-extrabold text-gray-900">{metrics.total}</span>
        </div>
        <div className="bg-white border border-gray-200 p-4 rounded-2xl shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider block">Pending Queue</span>
          <span className="text-xl font-extrabold text-blue-600">{metrics.pending}</span>
        </div>
        <div className="bg-white border border-gray-200 p-4 rounded-2xl shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider block">In Progress</span>
          <span className="text-xl font-extrabold text-amber-600">{metrics.inProgress}</span>
        </div>
        <div className="bg-white border border-gray-200 p-4 rounded-2xl shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">Submitted</span>
          <span className="text-xl font-extrabold text-emerald-600">{metrics.submitted}</span>
        </div>
        <div className="bg-white border border-gray-200 p-4 rounded-2xl shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Manual / CAPTCHA</span>
          <span className="text-xl font-extrabold text-amber-700">{metrics.awaitingManual}</span>
        </div>
        <div className="bg-white border border-gray-200 p-4 rounded-2xl shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-red-500 uppercase tracking-wider block">Failed</span>
          <span className="text-xl font-extrabold text-red-600">{metrics.failed}</span>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center justify-between border-b border-gray-200">
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setActiveTab("queue")}
            className={`pb-3 text-sm font-bold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === "queue"
                ? "border-[#673DE6] text-[#673DE6]"
                : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            <span>📋 Form Jobs Queue</span>
            <span className="rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-xs font-semibold">
              {jobs.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("campaign-import")}
            className={`pb-3 text-sm font-bold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === "campaign-import"
                ? "border-[#673DE6] text-[#673DE6]"
                : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            <span>🎯 Generate Form Jobs from Campaign</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("templates")}
            className={`pb-3 text-sm font-bold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === "templates"
                ? "border-[#673DE6] text-[#673DE6]"
                : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            <span>📄 Form Templates ({formTemplates.length})</span>
          </button>
        </div>
      </div>

      {/* TAB 1: FORM JOBS QUEUE */}
      {activeTab === "queue" && (
        <div className="space-y-4">
          {/* Status filter bar */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {["ALL", "PENDING", "IN_PROGRESS", "SUBMITTED", "AWAITING_MANUAL_ACTION", "FAILED"].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                    statusFilter === st
                      ? "bg-[#673DE6] text-white shadow-2xs"
                      : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                  }`}
                >
                  {st === "AWAITING_MANUAL_ACTION" ? "Awaiting Action (CAPTCHA)" : st}
                </button>
              ))}
            </div>
          </div>

          {filteredJobs.length === 0 ? (
            <div className="p-12 bg-white rounded-2xl border border-dashed border-gray-300 text-center space-y-3">
              <span className="text-4xl block">🌐</span>
              <h3 className="text-sm font-bold text-gray-900">No Website Form Jobs in this view</h3>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                Generate website form jobs from any existing campaign, or enable Website Form Automation during Campaign creation.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("campaign-import")}
                  className="rounded-xl bg-[#673DE6] text-white px-4 py-2 text-xs font-bold hover:bg-[#5025D1] transition shadow-xs cursor-pointer"
                >
                  ➕ Generate Form Jobs from Campaign
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50/80 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="p-4">Target Brand</th>
                    <th className="p-4">Target Form / Website</th>
                    <th className="p-4">Campaign &amp; Template</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredJobs.map((job) => {
                    const brandName = job.contact?.brandName || job.contact?.name || "Brand";
                    const campaignName = job.campaign?.name || "Direct Form Job";

                    return (
                      <tr key={job.id} className="hover:bg-purple-50/20 transition">
                        {/* Brand */}
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-900 text-sm">{brandName}</span>
                          </div>
                          <span className="text-[11px] text-gray-400 font-mono mt-0.5 block">
                            {job.contact?.email || "No email (Web form outreach)"}
                          </span>
                        </td>

                        {/* URL */}
                        <td className="p-4 max-w-xs">
                          <a
                            href={job.targetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-[#673DE6] hover:underline flex items-center gap-1 truncate"
                            title={job.targetUrl}
                          >
                            <span>🔗</span>
                            <span className="truncate">{job.targetUrl}</span>
                          </a>
                          {job.manualActionReason && (
                            <p className="text-[10px] text-amber-700 font-semibold mt-1 bg-amber-50 p-1.5 rounded-lg border border-amber-200">
                              ⚠️ {job.manualActionReason}
                            </p>
                          )}
                          {job.lastError && (
                            <p className="text-[10px] text-red-600 font-medium mt-1 truncate">
                              ❌ {job.lastError}
                            </p>
                          )}
                        </td>

                        {/* Campaign & Template */}
                        <td className="p-4">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-50 text-[#673DE6] font-bold text-xs border border-purple-100">
                            🎯 {campaignName}
                          </span>
                          <p className="text-[11px] text-gray-500 mt-1">
                            📄 {job.formTemplate?.name || "Wholesale Application"}
                          </p>
                        </td>

                        {/* Status */}
                        <td className="p-4 whitespace-nowrap">
                          <Badge
                            tone={
                              job.status === "SUBMITTED"
                                ? "green"
                                : job.status === "IN_PROGRESS"
                                ? "amber"
                                : job.status === "AWAITING_MANUAL_ACTION"
                                ? "amber"
                                : job.status === "FAILED"
                                ? "neutral"
                                : "blue"
                            }
                          >
                            {job.status === "AWAITING_MANUAL_ACTION" ? "Awaiting Action" : job.status}
                          </Badge>
                          {job.submittedAt && (
                            <span className="text-[10px] text-gray-400 block mt-1 font-mono">
                              {new Date(job.submittedAt).toLocaleTimeString()}
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="p-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Preview Values */}
                            <button
                              type="button"
                              onClick={() => {
                                let v: any = {};
                                try {
                                  v = JSON.parse(job.resolvedValuesJson || "{}");
                                } catch {}
                                setPreviewValues({ brand: brandName, url: job.targetUrl, values: v });
                              }}
                              className="rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 px-2.5 py-1 text-xs font-bold text-[#673DE6] hover:scale-105 active:scale-95 transition cursor-pointer"
                              title="Preview resolved values"
                            >
                              👁️ Values
                            </button>

                            {/* Live Browser Fill & Submit */}
                            {job.status !== "SUBMITTED" && (
                              <button
                                type="button"
                                disabled={busy === `fill-${job.id}`}
                                onClick={() => handleFillSingleNow(job)}
                                className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-2.5 py-1 text-xs font-bold shadow-2xs hover:scale-105 active:scale-95 transition cursor-pointer disabled:opacity-50 flex items-center gap-1"
                                title="Open browser tab, inject values, and submit live"
                              >
                                <span>⚡</span>
                                <span>{busy === `fill-${job.id}` ? "Opening & Filling..." : "Fill Live in Browser"}</span>
                              </button>
                            )}

                            {/* If Awaiting Manual Action, allow confirming submission */}
                            {job.status === "AWAITING_MANUAL_ACTION" && (
                              <button
                                type="button"
                                disabled={busy === `manual-${job.id}`}
                                onClick={() => handleResolveManual(job.id, "SUBMITTED")}
                                className="rounded-xl bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200 px-2 py-1 text-xs font-bold hover:scale-105 transition cursor-pointer"
                                title="Confirm you solved CAPTCHA and submitted in browser"
                              >
                                ✓ Confirm Done
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: GENERATE FROM CAMPAIGN */}
      {activeTab === "campaign-import" && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs max-w-2xl space-y-5">
          <div>
            <h3 className="text-base font-extrabold text-gray-900">
              Generate Website Form Jobs from Campaign
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Select an existing campaign. Shotinger will inspect all brand contacts in that campaign, find their official website or contact form URL, and generate real-time browser automation jobs.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                Select Campaign
              </label>
              <select
                value={selectedCampaignId}
                onChange={(e) => setSelectedCampaignId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 p-2.5 text-xs font-bold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.recipientsCount} Brands) — {c.status}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                Form Template (Values to Inject)
              </label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 p-2.5 text-xs font-bold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
              >
                {formTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.isDefault ? "★ (Default)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-2">
              <button
                type="button"
                disabled={busy === "generate-forms" || !selectedCampaignId}
                onClick={handleGenerateFromCampaign}
                className="rounded-xl bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] text-white px-5 py-2.5 text-xs font-bold shadow-md hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer disabled:opacity-50 flex items-center gap-2"
              >
                <span>🌐</span>
                <span>{busy === "generate-forms" ? "Generating Form Jobs..." : "Generate & Schedule Form Jobs"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: FORM TEMPLATES */}
      {activeTab === "templates" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Form templates define the data injected into applicant name, email, phone, company name, website, and inquiry message fields.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {formTemplates.map((t) => {
              let fields: any = {};
              try {
                fields = JSON.parse(t.fieldsJson);
              } catch {}

              return (
                <div key={t.id} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-gray-900 text-sm">{t.name}</h4>
                      <p className="text-xs text-gray-500">{t.description || "Website outreach form template"}</p>
                    </div>
                    {t.isDefault && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-[#673DE6]">
                        Default
                      </span>
                    )}
                  </div>

                  <div className="bg-gray-50 p-3 rounded-xl space-y-1.5 text-xs font-mono">
                    {Object.entries(fields).slice(0, 5).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-2 border-b border-gray-100 pb-1">
                        <span className="text-gray-400 capitalize">{k}:</span>
                        <span className="text-gray-900 truncate font-semibold">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PREVIEW MODAL */}
      {previewValues && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-lg w-full space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Form Values for {previewValues.brand}
                </h3>
                <p className="text-xs text-gray-500 truncate max-w-sm">{previewValues.url}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewValues(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="bg-gray-50 rounded-2xl p-4 max-h-80 overflow-y-auto space-y-2 text-xs font-mono">
              {Object.entries(previewValues.values).map(([k, v]) => (
                <div key={k} className="space-y-0.5 border-b border-gray-200/60 pb-1.5">
                  <span className="text-gray-400 uppercase text-[10px] font-bold block">{k}</span>
                  <span className="text-gray-900 font-semibold block break-all">{String(v)}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setPreviewValues(null)}
                className="rounded-xl bg-[#673DE6] text-white px-4 py-2 text-xs font-bold hover:bg-[#5025D1] transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
