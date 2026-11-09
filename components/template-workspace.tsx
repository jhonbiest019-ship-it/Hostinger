"use client";

import { FormEvent, useEffect, useState } from "react";
import { Badge, EmptyState } from "@/components/ui";
import { renderTemplate, autoFormatGreetingWithBrand, formatEmailBodyToHtml } from "@/lib/email/template";

type Template = {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  isDefault: boolean;
};

const blank = { name: "", subject: "", body: "", isDefault: false };

const sample = {
  brandName: "Lang's Chocolates",
  productCategory: "Gourmet Chocolates & Candies",
  category: "Gourmet Chocolates & Candies",
  email: "contact@langschocolates.com",
  brandEmail: "contact@langschocolates.com",
  website: "https://langschocolates.com",
  firstName: "Marketing Team",
};

export function TemplateWorkspace() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(false);
  const [previewModalTpl, setPreviewModalTpl] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function request(path: string, options?: RequestInit) {
    const response = await fetch(path, {
      ...options,
      credentials: "include",
      headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Request failed.");
    return body;
  }

  async function load() {
    try {
      const body = await request(`/api/templates?search=${encodeURIComponent(search)}`);
      setTemplates(body.templates || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load templates.");
    }
  }

  useEffect(() => {
    void load();
  }, [search]);

  function reset() {
    setEditing(null);
    setForm(blank);
    setPreview(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const formattedBody = autoFormatGreetingWithBrand(form.body);
      await request(editing ? `/api/templates/${editing}` : "/api/templates", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({ ...form, body: formattedBody }),
      });
      setMessage(editing ? "Template updated successfully." : "Template created successfully.");
      reset();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save template.");
    } finally {
      setBusy(false);
    }
  }

  async function activate(id: string) {
    try {
      setBusy(true);
      // Optimistically update UI
      setTemplates((prev) =>
        prev.map((t) => ({ ...t, isDefault: t.id === id }))
      );
      await request(`/api/templates/${id}/activate`, { method: "POST", body: "{}" });
      const target = templates.find((t) => t.id === id);
      setMessage(`"${target?.name || "Template"}" is now active and set as the primary outreach template.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to activate template.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(id: string) {
    try {
      await request(`/api/templates/${id}/duplicate`, { method: "POST", body: "{}" });
      setMessage("Template duplicated.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to duplicate template.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Archive this template?")) return;
    try {
      await request(`/api/templates/${id}`, { method: "DELETE", body: "{}" });
      setMessage("Template archived.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to archive template.");
    }
  }

  function addTag(tag: string) {
    setForm((prev) => ({ ...prev, body: `${prev.body} {{${tag}}}` }));
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
      <div className="border-b border-gray-200 pb-5">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Email Templates</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">
          Insert dynamic tags like Brand Name and Product Category. Activate any template to use it automatically in outreach campaigns.
        </p>
      </div>

      {message && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs sm:text-sm font-semibold text-emerald-800 flex items-center justify-between">
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setMessage("")}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Template Form */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">
            {editing ? "Edit Template" : "Create New Outreach Template"}
          </h2>
          {editing && (
            <button type="button" onClick={reset} className="text-xs font-semibold text-gray-500 hover:text-black underline">
              Cancel
            </button>
          )}
        </div>

        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Template Name <span className="text-red-500">*</span>
              </label>
              <input
                required
                placeholder="e.g. Brand Partnership Intro"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-xl border border-gray-200 p-2.5 text-xs sm:text-sm focus:border-[#673DE6] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Email Subject <span className="text-red-500">*</span>
              </label>
              <input
                required
                placeholder="e.g. Collaboration with {{brandName}} - {{productCategory}}"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="w-full rounded-xl border border-gray-200 p-2.5 text-xs sm:text-sm focus:border-[#673DE6] focus:outline-none font-medium"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Email Body <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={8}
              placeholder="Hi {{brandName}} Team, We love your {{productCategory}} products..."
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              className="w-full rounded-xl border border-gray-200 p-3 text-xs sm:text-sm focus:border-[#673DE6] focus:outline-none leading-relaxed"
            />
          </div>

          {/* Quick Insert Dynamic Variable Tags */}
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">
              Click to insert dynamic tags (Auto-populated from spreadsheet):
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => addTag("brandName")}
                className="rounded-lg bg-purple-50 border border-purple-200 px-3 py-1 text-xs font-semibold text-[#673DE6] hover:bg-purple-100"
              >
                + {"{{brandName}}"} (Brand Name)
              </button>
              <button
                type="button"
                onClick={() => addTag("productCategory")}
                className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
              >
                + {"{{productCategory}}"} (Category)
              </button>
              <button
                type="button"
                onClick={() => addTag("brandEmail")}
                className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              >
                + {"{{brandEmail}}"} (Email)
              </button>
              <button
                type="button"
                onClick={() => addTag("website")}
                className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100"
              >
                + {"{{website}}"} (Website)
              </button>
            </div>
          </div>

          {/* Set as Active Template Checkbox */}
          <div className="pt-1">
            <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-700">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-[#673DE6] focus:ring-[#673DE6]"
              />
              <span>Set as active template for new outreach campaigns</span>
            </label>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setPreview(!preview)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer shadow-2xs"
            >
              {preview ? "Hide Sample Preview" : "👁 Show Sample Preview"}
            </button>

            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-gradient-to-r from-[#673DE6] to-[#5025D1] hover:from-[#784ef7] hover:to-[#5f2ee0] px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-purple-500/25 hover:shadow-lg hover:shadow-purple-500/35 hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50 cursor-pointer"
            >
              {busy ? "Saving..." : editing ? "Update Template" : "Save Template"}
            </button>
          </div>
        </form>

        {preview && (
          <div className="rounded-xl border border-purple-100 bg-purple-50/40 p-4 space-y-3 mt-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700">
              Sample Auto-Replaced Output (Exact Brand View &amp; Layout)
            </span>
            <p className="text-sm font-bold text-gray-900">{renderTemplate(form.subject || "Subject", sample)}</p>
            <div
              className="p-5 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm text-gray-900 leading-relaxed font-sans shadow-2xs overflow-x-auto"
              dangerouslySetInnerHTML={{
                __html: formatEmailBodyToHtml(renderTemplate(form.body || "Body", sample)),
              }}
            />
          </div>
        )}
      </section>

      {/* Templates List */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Saved Templates ({templates.length})</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Activate any template below to make it your primary outreach template.
            </p>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="rounded-full border border-gray-200 px-4 py-1.5 text-xs focus:border-[#673DE6] focus:outline-none"
          />
        </div>

        {templates.length === 0 ? (
          <EmptyState
            title="No templates created yet"
            description="Create your first outreach template above with {{brandName}} and {{productCategory}} tags."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((tpl) => {
              const isActive = Boolean(tpl.isDefault);
              return (
                <div
                  key={tpl.id}
                  className={`rounded-2xl bg-white p-5 flex flex-col justify-between transition-all duration-200 ${
                    isActive
                      ? "border-2 border-emerald-500 shadow-md ring-4 ring-emerald-500/10"
                      : "border border-gray-200 shadow-xs hover:border-gray-300"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                            isActive ? "bg-emerald-500 animate-pulse" : "bg-gray-300"
                          }`}
                          title={isActive ? "Active Template" : "Inactive Template"}
                        />
                        <h3 className="text-sm font-bold text-gray-900 truncate">{tpl.name}</h3>
                      </div>
                      <Badge tone={isActive ? "green" : "neutral"}>
                        {isActive ? "ACTIVE" : "INACTIVE"}
                      </Badge>
                    </div>

                    <p className="text-xs font-semibold text-gray-700 mt-2 truncate">
                      Subject: {tpl.subject}
                    </p>
                    <p className="text-xs text-gray-500 mt-2 line-clamp-3 leading-relaxed whitespace-pre-wrap">
                      {tpl.body}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-gray-100 mt-4 gap-2">
                    <div>
                      {isActive ? (
                        <span className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-300 px-3.5 py-1.5 text-xs font-extrabold text-emerald-800 shadow-2xs">
                          <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Active
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void activate(tpl.id)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 hover:scale-105 text-white px-3.5 py-1.5 text-xs font-bold shadow-xs hover:shadow-md hover:shadow-emerald-500/25 transition-all duration-200 cursor-pointer disabled:opacity-50"
                        >
                          Activate
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewModalTpl(tpl)}
                        className="rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 text-xs font-bold text-blue-700 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer shadow-2xs"
                      >
                        👁️ Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(tpl.id);
                          setForm({
                            name: tpl.name,
                            subject: tpl.subject,
                            body: tpl.body,
                            isDefault: Boolean(tpl.isDefault),
                          });
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 text-xs font-bold text-[#673DE6] hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void duplicate(tpl.id)}
                        className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer shadow-2xs"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(tpl.id)}
                        className="rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 px-3 py-1.5 text-xs font-bold text-red-600 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      {/* Full Layout Preview Modal */}
      {previewModalTpl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl border border-purple-100 my-8 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-purple-100 text-[#673DE6] flex items-center justify-center text-sm font-bold">
                  ✉️
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-gray-900">{previewModalTpl.name}</h3>
                  <p className="text-xs text-gray-500">Brand Inbox View (Exact HTML layout &amp; signature)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewModalTpl(null)}
                className="text-gray-400 hover:text-gray-600 text-sm p-1.5 rounded-xl hover:bg-gray-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <span className="text-[11px] font-bold text-gray-500 block mb-1">Subject:</span>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs sm:text-sm font-bold text-gray-900">
                  {renderTemplate(previewModalTpl.subject, sample)}
                </div>
              </div>

              <div>
                <span className="text-[11px] font-bold text-gray-500 block mb-1">Email Body &amp; 2-Column Signature:</span>
                <div
                  className="p-5 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm text-gray-900 leading-relaxed min-h-[160px] font-sans shadow-2xs overflow-x-auto max-h-[60vh]"
                  dangerouslySetInnerHTML={{
                    __html: formatEmailBodyToHtml(renderTemplate(previewModalTpl.body, sample)),
                  }}
                />
              </div>
            </div>

            <div className="flex items-center justify-end pt-4 border-t border-gray-100 mt-5">
              <button
                type="button"
                onClick={() => setPreviewModalTpl(null)}
                className="rounded-xl bg-gray-900 text-white px-5 py-2 text-xs font-bold hover:bg-black transition cursor-pointer"
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
