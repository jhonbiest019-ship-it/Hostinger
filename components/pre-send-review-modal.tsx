"use client";

import { useState } from "react";
import { renderTemplate, formatEmailBodyToHtml } from "@/lib/email/template";

export interface ReviewRecipient {
  brandName: string;
  brandEmail: string;
  productCategory: string;
  asin?: string;
  amazonLink?: string;
  website?: string;
  formUrl?: string;
  sheetNum?: number | string;
  formExcluded?: boolean;
  formStatus?: string;
  formMissingInfo?: string;
  formResolvedValues?: Record<string, any>;
  emailStatus?: string;
  reviewStatus?: string;
}

interface PreSendReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isConfirming: boolean;
  campaignTitle: string;
  senderMailbox: string;
  totalRecipients: number;
  sendMode: "sendNow" | "now" | "schedule";
  scheduledTime?: string;
  delayAmount: number;
  delayUnit: string;
  subjectTemplate: string;
  bodyTemplate: string;
  followUpEnabled?: boolean;
  followUpDays?: number;
  recipients: ReviewRecipient[];
  // Form Automation props
  formAutomationEnabled?: boolean;
  formTemplateName?: string;
  formScheduleMode?: "SAME_TIME" | "DIFFERENT_TIME";
  formScheduledTime?: string;
  formConcurrency?: number;
  onUpdateRecipientFormUrl?: (index: number, url: string) => void;
  onToggleExcludeForm?: (index: number) => void;
  onUpdateRecipientFormValues?: (index: number, values: Record<string, any>) => void;
  onUpdateEmailTemplate?: (subject: string, body: string) => void;
}

export function PreSendReviewModal({
  isOpen,
  onClose,
  onConfirm,
  isConfirming,
  campaignTitle,
  senderMailbox,
  totalRecipients,
  sendMode,
  scheduledTime,
  delayAmount,
  delayUnit,
  subjectTemplate,
  bodyTemplate,
  followUpEnabled,
  followUpDays,
  recipients,
  formAutomationEnabled = false,
  formTemplateName = "Wholesale Application",
  formScheduleMode = "SAME_TIME",
  formScheduledTime,
  formConcurrency = 2,
  onUpdateRecipientFormUrl,
  onToggleExcludeForm,
  onUpdateRecipientFormValues,
  onUpdateEmailTemplate,
}: PreSendReviewModalProps) {
  const [activeView, setActiveView] = useState<"combined" | "email_preview">("combined");
  const [currentIndex, setCurrentIndex] = useState(0);

  // Form Value Edit Modal State
  const [editFormModalIndex, setEditFormModalIndex] = useState<number | null>(null);
  const [editingFormValues, setEditingFormValues] = useState<Record<string, any>>({});

  // Form Value Preview Modal State
  const [previewFormModalIndex, setPreviewFormModalIndex] = useState<number | null>(null);

  // Email Template Edit Modal State
  const [editEmailModalOpen, setEditEmailModalOpen] = useState(false);
  const [editableSubject, setEditableSubject] = useState(subjectTemplate);
  const [editableBody, setEditableBody] = useState(bodyTemplate);

  // Form URL quick edit
  const [editingUrlIndex, setEditingUrlIndex] = useState<number | null>(null);
  const [tempUrlValue, setTempUrlValue] = useState("");

  if (!isOpen) return null;

  const safeIndex = Math.min(Math.max(0, currentIndex), Math.max(0, recipients.length - 1));
  const current = recipients[safeIndex] || {
    brandName: "Sample Brand",
    brandEmail: "brand@example.com",
    productCategory: "Product Category",
  };

  const templateContext = {
    brandName: current.brandName,
    productCategory: current.productCategory,
    category: current.productCategory,
    email: current.brandEmail,
    website: current.website,
    asin: current.asin,
    amazonLink: current.amazonLink,
    sheetNum: current.sheetNum,
    num: current.sheetNum,
  };

  const renderedSubject = renderTemplate(editableSubject, templateContext);
  const renderedBody = renderTemplate(editableBody, templateContext);

  const effectiveDelaySeconds = delayUnit === "minutes" ? delayAmount * 60 : delayAmount;
  const totalMinutes = Math.ceil(((totalRecipients - 1) * effectiveDelaySeconds) / 60);

  let scheduledDisplay = "Scheduled";
  if (scheduledTime) {
    try {
      const match = scheduledTime.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
      if (match) {
        const [, , m, d, hh, mm] = match;
        const hourNum = parseInt(hh, 10);
        const ampm = hourNum >= 12 ? "PM" : "AM";
        const hour12 = hourNum % 12 || 12;
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthName = monthNames[parseInt(m, 10) - 1] || m;
        scheduledDisplay = `${monthName} ${parseInt(d, 10)}, ${String(hour12).padStart(2, "0")}:${mm} ${ampm} (PKT)`;
      } else {
        const dt = new Date(scheduledTime);
        if (!isNaN(dt.getTime())) {
          scheduledDisplay = dt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
        }
      }
    } catch {
      scheduledDisplay = scheduledTime;
    }
  }

  function openEditFormModal(idx: number) {
    const rec = recipients[idx];
    const defaultVals = rec.formResolvedValues || {
      applicantName: "David Lucas",
      contactEmail: senderMailbox || "sales@qayyumestore.com",
      companyName: "QAYYUM ESTORE",
      companyWebsite: "https://qayyumestore.com",
      phoneNumber: "352-695-1331",
      productCategory: rec.productCategory || "Retail Products",
      subject: `Retail Partnership Inquiry - ${rec.brandName}`,
      message: `Hello ${rec.brandName} Team, We are reaching out from QAYYUM ESTORE to explore opening an authorized wholesale/retail account.`,
      taxId: "Available upon request (Florida LLC)",
      storeType: "Retailer / Distribution",
    };
    setEditingFormValues({ ...defaultVals });
    setEditFormModalIndex(idx);
  }

  function saveFormValues() {
    if (editFormModalIndex !== null && onUpdateRecipientFormValues) {
      onUpdateRecipientFormValues(editFormModalIndex, editingFormValues);
    }
    setEditFormModalIndex(null);
  }

  function handleSaveEmailTemplate() {
    if (onUpdateEmailTemplate) {
      onUpdateEmailTemplate(editableSubject, editableBody);
    }
    setEditEmailModalOpen(false);
  }

  const eligibleFormCount = recipients.filter((r) => !r.formExcluded && (r.formUrl || r.website)).length;
  const missingWebCount = recipients.filter((r) => !r.formExcluded && !r.website && !r.formUrl).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl max-w-5xl w-full border border-purple-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-6 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-purple-800 via-[#673DE6] to-indigo-800 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="p-2 bg-white/20 rounded-xl text-lg leading-none">
              🎯
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold tracking-tight">
                  Campaign Pre-Schedule & Multi-Channel Verification
                </h3>
                {formAutomationEnabled && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-400 text-purple-950 font-extrabold text-[10px] uppercase tracking-wide">
                    Email + Form Automation
                  </span>
                )}
              </div>
              <p className="text-xs text-purple-100">
                Review email delivery, website forms, and brand variables before scheduling.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isConfirming}
            onClick={onClose}
            className="text-white/80 hover:text-white rounded-lg p-1.5 text-sm font-bold cursor-pointer disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* View Switcher Bar */}
        <div className="px-6 py-2.5 bg-purple-50/70 border-b border-purple-100 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-purple-200 shadow-2xs">
            <button
              type="button"
              onClick={() => setActiveView("combined")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                activeView === "combined"
                  ? "bg-[#673DE6] text-white shadow-xs"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              📋 Combined Recipients Table ({totalRecipients})
            </button>
            <button
              type="button"
              onClick={() => setActiveView("email_preview")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                activeView === "email_preview"
                  ? "bg-[#673DE6] text-white shadow-xs"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              ✉️ Rendered Email Preview
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {formAutomationEnabled && (
              <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full font-bold">
                <span>🌐</span> Forms Eligible: <strong>{eligibleFormCount}</strong> / {totalRecipients}
              </span>
            )}
            {missingWebCount > 0 && formAutomationEnabled && (
              <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full font-bold">
                <span>⚠️</span> Missing Website: <strong>{missingWebCount}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto grow">
          {/* Dispatch Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className="p-3 bg-purple-50/60 rounded-2xl border border-purple-100">
              <span className="text-gray-500 block text-[11px] font-semibold">Sender Mailbox</span>
              <span className="font-bold text-gray-900 truncate block mt-0.5" title={senderMailbox}>
                {senderMailbox || "Default Mailbox"}
              </span>
            </div>
            <div className="p-3 bg-purple-50/60 rounded-2xl border border-purple-100">
              <span className="text-gray-500 block text-[11px] font-semibold">Total Selected</span>
              <span className="font-extrabold text-[#673DE6] block text-sm mt-0.5">
                {totalRecipients} Brand Contacts
              </span>
            </div>
            <div className="p-3 bg-purple-50/60 rounded-2xl border border-purple-100">
              <span className="text-gray-500 block text-[11px] font-semibold">Email Spacing</span>
              <span className="font-bold text-gray-900 block mt-0.5">
                {delayAmount} {delayUnit} / email
              </span>
            </div>
            <div className="p-3 bg-purple-50/60 rounded-2xl border border-purple-100">
              <span className="text-gray-500 block text-[11px] font-semibold">Scheduling</span>
              <span className="font-bold text-emerald-700 block mt-0.5 truncate" title={scheduledDisplay}>
                {sendMode === "sendNow" || sendMode === "now"
                  ? "⚡ Instant Spaced Send"
                  : `🕒 ${scheduledDisplay}`}
              </span>
            </div>
          </div>

          {/* COMBINED RECIPIENTS TABLE VIEW */}
          {activeView === "combined" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span className="font-bold text-gray-800 flex items-center gap-1.5">
                  <span>📊</span> Combined Multi-Channel Operations Table
                </span>
                <span className="text-gray-500">
                  Review and customize email &amp; website form jobs for each brand before scheduling.
                </span>
              </div>

              <div className="rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
                <div className="overflow-x-auto max-h-[460px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="px-3 py-2.5">#</th>
                        <th className="px-3 py-2.5">Brand Name</th>
                        <th className="px-3 py-2.5">Contact Email</th>
                        <th className="px-3 py-2.5">Brand Website</th>
                        <th className="px-3 py-2.5">Email Template</th>
                        {formAutomationEnabled && (
                          <>
                            <th className="px-3 py-2.5">Form URL</th>
                            <th className="px-3 py-2.5">Form Template</th>
                            <th className="px-3 py-2.5">Email Status</th>
                            <th className="px-3 py-2.5">Form Status</th>
                            <th className="px-3 py-2.5">Missing Info</th>
                          </>
                        )}
                        <th className="px-3 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {recipients.map((rec, idx) => {
                        const hasEmail = Boolean(rec.brandEmail && rec.brandEmail.includes("@") && !rec.brandEmail.includes(".invalid"));
                        const hasWebsite = Boolean(rec.website && rec.website.trim() && !/^(n\/a|none|-)$/i.test(rec.website));
                        const isExcluded = Boolean(rec.formExcluded);
                        const formUrl = rec.formUrl || (hasWebsite ? `${rec.website?.replace(/\/+$/, "")}/wholesale` : "—");
                        const formMissing = !hasWebsite && !rec.formUrl ? "Missing brand website URL" : null;

                        return (
                          <tr
                            key={idx}
                            className={`hover:bg-purple-50/40 transition ${
                              isExcluded ? "opacity-60 bg-gray-50/60" : ""
                            }`}
                          >
                            <td className="px-3 py-2 text-gray-400 font-mono text-[11px]">
                              {rec.sheetNum || idx + 1}
                            </td>

                            <td className="px-3 py-2 font-bold text-gray-900 whitespace-nowrap">
                              {rec.brandName || "—"}
                            </td>

                            <td className="px-3 py-2 font-mono text-[11px] text-gray-700 whitespace-nowrap">
                              {hasEmail ? (
                                <span className="text-[#673DE6] font-semibold">{rec.brandEmail}</span>
                              ) : (
                                <span className="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md font-sans">
                                  Missing Email (Skipped)
                                </span>
                              )}
                            </td>

                            <td className="px-3 py-2 text-gray-600 max-w-[150px] truncate" title={rec.website || ""}>
                              {hasWebsite ? (
                                <a
                                  href={rec.website?.startsWith("http") ? rec.website : `https://${rec.website}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline inline-flex items-center gap-1"
                                >
                                  <span>🌐</span> {rec.website}
                                </a>
                              ) : (
                                <span className="text-red-500 font-semibold bg-red-50 px-1.5 py-0.5 rounded text-[10px]">
                                  No Website
                                </span>
                              )}
                            </td>

                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                              <span className="font-semibold text-[11px] bg-purple-50 border border-purple-100 text-purple-900 px-2 py-0.5 rounded-md">
                                {editableSubject.slice(0, 24)}...
                              </span>
                            </td>

                            {formAutomationEnabled && (
                              <>
                                <td className="px-3 py-2 max-w-[180px]">
                                  {editingUrlIndex === idx ? (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="url"
                                        value={tempUrlValue}
                                        onChange={(e) => setTempUrlValue(e.target.value)}
                                        placeholder="https://..."
                                        className="w-full text-[11px] font-mono px-1.5 py-0.5 border border-purple-300 rounded"
                                        autoFocus
                                      />
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (onUpdateRecipientFormUrl) {
                                            onUpdateRecipientFormUrl(idx, tempUrlValue);
                                          }
                                          setEditingUrlIndex(null);
                                        }}
                                        className="bg-emerald-600 text-white px-1.5 py-0.5 rounded text-[10px] font-bold"
                                      >
                                        ✓
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingUrlIndex(null)}
                                        className="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded text-[10px]"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      <span
                                        className="font-mono text-[11px] text-gray-800 truncate block max-w-[130px]"
                                        title={formUrl}
                                      >
                                        {formUrl}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setTempUrlValue(rec.formUrl || (hasWebsite ? `${rec.website?.replace(/\/+$/, "")}/wholesale` : ""));
                                          setEditingUrlIndex(idx);
                                        }}
                                        className="text-gray-400 hover:text-[#673DE6] text-[10px] p-0.5"
                                        title="Edit target form URL"
                                      >
                                        ✏️
                                      </button>
                                    </div>
                                  )}
                                </td>

                                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                                  <span className="font-semibold text-[11px] bg-blue-50 border border-blue-100 text-blue-900 px-2 py-0.5 rounded-md">
                                    {formTemplateName}
                                  </span>
                                </td>

                                <td className="px-3 py-2 whitespace-nowrap">
                                  {hasEmail ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      Ready to Send
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                      Skipped: No Email
                                    </span>
                                  )}
                                </td>

                                <td className="px-3 py-2 whitespace-nowrap">
                                  {isExcluded ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">
                                      Excluded
                                    </span>
                                  ) : !hasWebsite && !rec.formUrl ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                      Missing Website
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                      Ready to Fill
                                    </span>
                                  )}
                                </td>

                                <td className="px-3 py-2 text-[11px] text-gray-500 whitespace-nowrap">
                                  {formMissing ? (
                                    <span className="text-amber-700 font-semibold">{formMissing}</span>
                                  ) : (
                                    <span className="text-gray-400">None</span>
                                  )}
                                </td>
                              </>
                            )}

                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCurrentIndex(idx);
                                    setActiveView("email_preview");
                                  }}
                                  className="px-2 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg text-[10px] font-bold text-gray-700"
                                  title="Preview email message"
                                >
                                  ✉️ Email
                                </button>

                                {formAutomationEnabled && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => setPreviewFormModalIndex(idx)}
                                      className="px-2 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-[10px] font-bold text-blue-800"
                                      title="Preview resolved website form values"
                                    >
                                      👁️ Form
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => openEditFormModal(idx)}
                                      className="px-2 py-1 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg text-[10px] font-bold text-[#673DE6]"
                                      title="Edit form values for this recipient"
                                    >
                                      ✏️ Values
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => onToggleExcludeForm && onToggleExcludeForm(idx)}
                                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                                        isExcluded
                                          ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                                          : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-rose-50 hover:text-rose-700"
                                      }`}
                                      title={isExcluded ? "Include this brand in form automation" : "Exclude form automation for this brand"}
                                    >
                                      {isExcluded ? "✓ Include" : "🚫 Exclude"}
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* RENDERED EMAIL PREVIEW VIEW */}
          {activeView === "email_preview" && (
            <div className="space-y-4">
              {/* Recipient Brand Carousel Navigator */}
              <div className="flex items-center justify-between bg-gray-50 p-2.5 rounded-2xl border border-gray-200 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-700">Previewing Brand:</span>
                  <span className="bg-[#673DE6] text-white font-extrabold px-2.5 py-0.5 rounded-full text-[11px]">
                    {safeIndex + 1} of {recipients.length}
                  </span>
                  <span className="text-gray-400 hidden sm:inline">
                    (Use buttons to inspect dynamic tokens across brands)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safeIndex <= 0}
                    onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                    className="px-2.5 py-1 rounded-xl border border-gray-300 bg-white hover:bg-gray-100 font-bold text-gray-700 disabled:opacity-40 cursor-pointer text-xs"
                  >
                    ◀ Prev
                  </button>
                  <button
                    type="button"
                    disabled={safeIndex >= recipients.length - 1}
                    onClick={() => setCurrentIndex((prev) => Math.min(recipients.length - 1, prev + 1))}
                    className="px-2.5 py-1 rounded-xl border border-gray-300 bg-white hover:bg-gray-100 font-bold text-gray-700 disabled:opacity-40 cursor-pointer text-xs"
                  >
                    Next ▶
                  </button>
                </div>
              </div>

              {/* Target Details Card */}
              <div className="p-4 rounded-2xl border-2 border-purple-200 bg-gradient-to-br from-purple-50/80 via-white to-blue-50/50 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-purple-100 pb-2">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-purple-900 flex items-center gap-1.5">
                    <span>🎯</span> Target Brand &amp; Dynamic Details
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditEmailModalOpen(true)}
                    className="text-xs font-bold text-[#673DE6] hover:underline flex items-center gap-1"
                  >
                    ✏️ Edit Email Subject &amp; Body
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-white p-3 rounded-xl border border-purple-100 shadow-2xs">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 block mb-1">
                      🏷️ Brand Name
                    </span>
                    <span className="text-sm font-extrabold text-gray-900 break-words block">
                      {current.brandName || "—"}
                    </span>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-purple-100 shadow-2xs">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 block mb-1">
                      📧 Recipient Email
                    </span>
                    <span className="text-xs font-mono font-bold text-[#673DE6] bg-purple-50/80 px-2 py-1 rounded-lg border border-purple-100 block break-all">
                      {current.brandEmail || "—"}
                    </span>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-purple-100 shadow-2xs">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 block mb-1">
                      📂 Product Category
                    </span>
                    <span className="text-xs font-bold text-indigo-900 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200 block break-words">
                      {current.productCategory || "General / Product Category"}
                    </span>
                  </div>
                </div>

                {/* ASIN / Amazon Link / Website */}
                {(current.asin || current.website || current.amazonLink) && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-gray-600">
                    {current.asin && (
                      <span className="px-2 py-0.5 rounded-md bg-gray-100 border border-gray-200 font-mono">
                        <strong>ASIN:</strong> {current.asin}
                      </span>
                    )}
                    {current.website && (
                      <span className="px-2 py-0.5 rounded-md bg-gray-100 border border-gray-200">
                        <strong>Website:</strong> {current.website}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Final Rendered Email Preview Window */}
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-xs">
                <div className="bg-gray-100 px-4 py-2.5 border-b border-gray-200 flex items-center justify-between text-xs text-gray-600 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <span>✉️</span> Live Rendered Email Message (What recipient receives)
                  </span>
                  <span className="text-[11px] text-gray-400">Tokens dynamically filled</span>
                </div>

                <div className="p-4 space-y-3 bg-white">
                  <div className="text-xs space-y-1.5 border-b border-gray-100 pb-3 text-gray-600">
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-gray-800 w-16 shrink-0">From:</span>
                      <span className="text-gray-900 font-mono text-xs">{senderMailbox}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-gray-800 w-16 shrink-0">To:</span>
                      <span className="text-gray-900 font-bold">
                        {current.brandName} &lt;<span className="font-mono text-[#673DE6]">{current.brandEmail}</span>&gt;
                      </span>
                    </div>
                    <div className="flex items-start gap-2 pt-1 border-t border-gray-50">
                      <span className="font-bold text-gray-800 w-16 shrink-0">Subject:</span>
                      <span className="text-gray-900 font-bold text-sm break-words">
                        {renderedSubject || "(No subject provided)"}
                      </span>
                    </div>
                  </div>

                  <div
                    className="text-xs sm:text-sm text-gray-900 leading-relaxed min-h-[140px] p-4 bg-white rounded-xl border border-gray-200 font-sans shadow-2xs overflow-x-auto"
                    dangerouslySetInnerHTML={{
                      __html: formatEmailBodyToHtml(renderedBody || ""),
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Follow-up Notice if enabled */}
          {followUpEnabled && (
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
              <span>🔁</span>
              <span>
                <strong>Automated Follow-up Active:</strong> If recipient does not reply within{" "}
                <strong>{followUpDays} days</strong>, follow-up will be dispatched automatically.
              </span>
            </div>
          )}

          {/* Form Automation Dispatch Notice */}
          {formAutomationEnabled && (
            <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 text-xs text-blue-900 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span>🌐</span>
                <span>
                  <strong>Website Form Automation:</strong> {eligibleFormCount} eligible form jobs will run via your desktop browser ({formConcurrency} concurrent tabs).
                  {formScheduleMode === "DIFFERENT_TIME" && formScheduledTime ? ` Scheduled for: ${formScheduledTime}` : " Runs at the same scheduled time as emails."}
                </span>
              </span>
              <span className="font-bold text-[11px] text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-200">
                Safe &amp; Visible Execution
              </span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            disabled={isConfirming}
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-gray-300 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            ✕ Cancel &amp; Edit Details
          </button>

          <button
            type="button"
            disabled={isConfirming}
            onClick={onConfirm}
            className="w-full sm:w-auto px-7 py-3 rounded-xl bg-[#673DE6] hover:bg-[#5025D1] text-white text-xs sm:text-sm font-extrabold shadow-md shadow-purple-500/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isConfirming ? (
              <>
                <span className="animate-spin inline-block h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                <span>Scheduling Campaign...</span>
              </>
            ) : sendMode === "sendNow" || sendMode === "now" ? (
              <>
                <span>⚡</span>
                <span>
                  Confirm &amp; Start Now ({totalRecipients} Brands
                  {formAutomationEnabled ? ` + ${eligibleFormCount} Forms` : ""})
                </span>
              </>
            ) : (
              <>
                <span>🕒</span>
                <span>
                  Confirm &amp; Schedule Campaign ({totalRecipients} Brands
                  {formAutomationEnabled ? ` + ${eligibleFormCount} Forms` : ""})
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Form Value Preview Modal */}
      {previewFormModalIndex !== null && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full p-6 space-y-4 border border-blue-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h4 className="font-extrabold text-sm text-gray-900 flex items-center gap-2">
                <span>👁️</span> Form Values Preview: {recipients[previewFormModalIndex]?.brandName}
              </h4>
              <button
                type="button"
                onClick={() => setPreviewFormModalIndex(null)}
                className="text-gray-400 hover:text-gray-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 max-h-[60vh] overflow-y-auto text-xs">
              {Object.entries(
                recipients[previewFormModalIndex]?.formResolvedValues || {
                  applicantName: "David Lucas",
                  contactEmail: senderMailbox || "sales@qayyumestore.com",
                  companyName: "QAYYUM ESTORE",
                  companyWebsite: "https://qayyumestore.com",
                  phoneNumber: "352-695-1331",
                  productCategory: recipients[previewFormModalIndex]?.productCategory || "Retail Products",
                  subject: `Retail Partnership Inquiry - ${recipients[previewFormModalIndex]?.brandName}`,
                  message: `Hello ${recipients[previewFormModalIndex]?.brandName} Team, We are reaching out from QAYYUM ESTORE to explore opening an authorized wholesale account.`,
                }
              ).map(([key, val]) => (
                <div key={key} className="p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-[10px] font-bold uppercase text-gray-500 block mb-0.5">{key}</span>
                  <span className="text-xs text-gray-800 break-words font-medium">{String(val)}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setPreviewFormModalIndex(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form Value Edit Modal */}
      {editFormModalIndex !== null && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full p-6 space-y-4 border border-purple-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h4 className="font-extrabold text-sm text-gray-900 flex items-center gap-2">
                <span>✏️</span> Edit Form Values for {recipients[editFormModalIndex]?.brandName}
              </h4>
              <button
                type="button"
                onClick={() => setEditFormModalIndex(null)}
                className="text-gray-400 hover:text-gray-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto text-xs">
              {Object.entries(editingFormValues).map(([key, val]) => (
                <div key={key}>
                  <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wide mb-1">
                    {key}
                  </label>
                  {key === "message" ? (
                    <textarea
                      rows={4}
                      value={String(val || "")}
                      onChange={(e) =>
                        setEditingFormValues((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:border-[#673DE6] focus:outline-none"
                    />
                  ) : (
                    <input
                      type="text"
                      value={String(val || "")}
                      onChange={(e) =>
                        setEditingFormValues((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="w-full text-xs p-2.5 border border-gray-200 rounded-xl focus:border-[#673DE6] focus:outline-none"
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setEditFormModalIndex(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveFormValues}
                className="px-5 py-2 bg-[#673DE6] hover:bg-[#5025D1] text-white text-xs font-bold rounded-xl shadow-xs"
              >
                Save Overrides
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Subject / Body Edit Modal */}
      {editEmailModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 space-y-4 border border-purple-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h4 className="font-extrabold text-sm text-gray-900 flex items-center gap-2">
                <span>✉️</span> Edit Email Subject &amp; Body
              </h4>
              <button
                type="button"
                onClick={() => setEditEmailModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase mb-1">
                  Subject Line:
                </label>
                <input
                  type="text"
                  value={editableSubject}
                  onChange={(e) => setEditableSubject(e.target.value)}
                  className="w-full p-2.5 border border-gray-200 rounded-xl font-bold text-xs focus:border-[#673DE6] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase mb-1">
                  Email Body:
                </label>
                <textarea
                  rows={8}
                  value={editableBody}
                  onChange={(e) => setEditableBody(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-xl font-mono text-xs focus:border-[#673DE6] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setEditEmailModalOpen(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEmailTemplate}
                className="px-5 py-2 bg-[#673DE6] hover:bg-[#5025D1] text-white text-xs font-bold rounded-xl shadow-xs"
              >
                Apply Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
