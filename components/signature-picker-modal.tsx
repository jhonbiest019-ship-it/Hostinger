"use client";

import { useState } from "react";
import {
  SIGNATURE_STYLES,
  SignatureData,
  DEFAULT_SIGNATURE_DATA,
  SignatureStyle,
} from "@/lib/email/signatures";

interface SignaturePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSignature: (generatedText: string) => void;
  initialData?: Partial<SignatureData>;
}

export function SignaturePickerModal({
  isOpen,
  onClose,
  onSelectSignature,
  initialData,
}: SignaturePickerModalProps) {
  const [data, setData] = useState<SignatureData>({
    ...DEFAULT_SIGNATURE_DATA,
    ...initialData,
  });

  const [selectedStyleId, setSelectedStyleId] = useState<string>(
    initialData?.styleId || "two_column_executive"
  );
  const [activeCategory, setActiveCategory] = useState<string>("all");

  if (!isOpen) return null;

  const selectedStyle =
    SIGNATURE_STYLES.find((s) => s.id === selectedStyleId) || SIGNATURE_STYLES[0];

  function handleApply() {
    const text = selectedStyle.generateText(data);
    onSelectSignature(text);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-5xl rounded-3xl bg-white shadow-2xl border border-purple-100 flex flex-col max-h-[92vh] overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-purple-50 via-white to-indigo-50 border-b border-purple-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl p-2 rounded-2xl bg-purple-100/80 text-[#673DE6]">✍️</span>
            <div>
              <h2 className="text-base sm:text-lg font-black text-gray-900 flex items-center gap-2">
                Professional Business Email Signatures
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-purple-100 text-[#673DE6]">
                  10 Styles Available
                </span>
              </h2>
              <p className="text-xs text-gray-500">
                Choose from 10 industry-standard signature styles commonly used in outreach and B2B correspondence.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 text-lg transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Body Container (2 Columns on Desktop) */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
          {/* Left Column: Signature Details Input Form (4 cols) */}
          <div className="lg:col-span-4 p-5 space-y-3.5 bg-gray-50/50 overflow-y-auto max-h-[82vh]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-gray-900 uppercase tracking-wider">
                👤 Your Identity & Channels
              </span>
              <button
                type="button"
                onClick={() => setData(DEFAULT_SIGNATURE_DATA)}
                className="text-[11px] text-[#673DE6] hover:underline font-semibold cursor-pointer"
              >
                Reset Default
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={data.fullName}
                onChange={(e) => setData({ ...data, fullName: e.target.value })}
                placeholder="David Lucas"
                className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">
                Professional Title / Role <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={data.jobTitle}
                onChange={(e) => setData({ ...data, jobTitle: e.target.value })}
                placeholder="Senior Partnerships Director"
                className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">
                Company / Organization <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={data.companyName}
                onChange={(e) => setData({ ...data, companyName: e.target.value })}
                placeholder="Farani Group LLC"
                className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={data.phone}
                  onChange={(e) => setData({ ...data, phone: e.target.value })}
                  placeholder="+1 (407) 555-0199"
                  className="w-full text-xs font-semibold px-2.5 py-2 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={data.email}
                  onChange={(e) => setData({ ...data, email: e.target.value })}
                  placeholder="david@faranigroup.com"
                  className="w-full text-xs font-semibold px-2.5 py-2 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Website URL</label>
              <input
                type="text"
                value={data.website}
                onChange={(e) => setData({ ...data, website: e.target.value })}
                placeholder="https://faranigroup.com"
                className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">
                HQ Address (Optional)
              </label>
              <input
                type="text"
                value={data.address || ""}
                onChange={(e) => setData({ ...data, address: e.target.value })}
                placeholder="7901 4th St N, St. Petersburg, FL"
                className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">
                Call / CTA Button Text (For Sales Pro Style)
              </label>
              <input
                type="text"
                value={data.ctaText || ""}
                onChange={(e) => setData({ ...data, ctaText: e.target.value })}
                placeholder="Schedule a 15-Min Partnership Call"
                className="w-full text-xs font-semibold px-3 py-2 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#673DE6]"
              />
            </div>
          </div>

          {/* Right Column: 10 Styles Gallery & Live Previews (8 cols) */}
          <div className="lg:col-span-8 p-5 space-y-4 overflow-y-auto max-h-[82vh]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-xs font-black text-gray-900 uppercase tracking-wider">
                  🎨 Select Signature Style ({SIGNATURE_STYLES.length})
                </span>
                <p className="text-[11px] text-gray-500">
                  Click any card to select. The live preview updates with your real data.
                </p>
              </div>

              {/* Category Filter Pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { id: "all", label: "All Styles (10)" },
                  { id: "executive", label: "Executive" },
                  { id: "modern", label: "Modern & Tech" },
                  { id: "sales", label: "Outreach & CTA" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveCategory(tab.id)}
                    className={`text-[10.5px] font-bold px-2.5 py-1 rounded-lg transition cursor-pointer ${
                      activeCategory === tab.id
                        ? "bg-[#673DE6] text-white shadow-2xs"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* List of 10 Cards */}
            <div className="space-y-3.5">
              {SIGNATURE_STYLES.filter((style) => {
                if (activeCategory === "executive") {
                  return [
                    "two_column_executive",
                    "classic_corporate",
                    "dark_contrast_bar",
                    "legal_compliance",
                  ].includes(style.id);
                }
                if (activeCategory === "modern") {
                  return [
                    "modern_accent_bar",
                    "minimalist_tech",
                    "avatar_monogram",
                    "compact_inline",
                  ].includes(style.id);
                }
                if (activeCategory === "sales") {
                  return [
                    "sales_pro_cta",
                    "verified_partner",
                    "two_column_executive",
                    "modern_accent_bar",
                  ].includes(style.id);
                }
                return true;
              }).map((style: SignatureStyle, idx: number) => {
                const isSelected = selectedStyleId === style.id;
                return (
                  <div
                    key={style.id}
                    onClick={() => setSelectedStyleId(style.id)}
                    className={`p-4 rounded-2xl border-2 transition-all cursor-pointer relative ${
                      isSelected
                        ? "border-[#673DE6] bg-purple-50/30 shadow-md ring-2 ring-[#673DE6]/20"
                        : "border-gray-200 hover:border-purple-200 bg-white hover:bg-gray-50/50 shadow-2xs"
                    }`}
                  >
                    {/* Header Row of Style Card */}
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            isSelected ? "border-[#673DE6] bg-[#673DE6]" : "border-gray-400"
                          }`}
                        >
                          {isSelected && <span className="text-white text-[10px]">✓</span>}
                        </div>
                        <span className="text-xs font-extrabold text-gray-900">
                          #{idx + 1}. {style.name}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-[#673DE6]">
                          {style.badge}
                        </span>
                      </div>
                      <span className="text-[11px] text-gray-400 font-mono">
                        ID: {style.id}
                      </span>
                    </div>

                    <p className="text-[11px] text-gray-500 mb-3">{style.description}</p>

                    {/* Live HTML Rendering of the Signature Style */}
                    <div className="p-3.5 bg-white border border-gray-100 rounded-xl overflow-x-auto shadow-2xs pointer-events-none">
                      <div className="text-[11px] text-gray-400 mb-1 italic font-mono">
                        Kind regards,
                      </div>
                      <div
                        dangerouslySetInnerHTML={{
                          __html: style.renderHtml(data),
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span>Selected Style:</span>
            <strong className="text-gray-900">{selectedStyle.name}</strong>
            <span className="text-gray-400">•</span>
            <span className="text-[11px] text-purple-700 font-medium">
              Will be placed automatically after &ldquo;Kind regards,&rdquo;
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 border border-gray-200 rounded-xl bg-white hover:bg-gray-50 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-6 py-2 text-xs font-bold text-white bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] rounded-xl shadow-md shadow-purple-500/25 transition cursor-pointer flex items-center gap-1.5"
            >
              <span>✍️</span> Apply Signature to Email
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
