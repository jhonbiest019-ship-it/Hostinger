"use client";

import { FormEvent, useEffect, useState } from "react";
import { Badge, EmptyState } from "@/components/ui";
import { csvValue, parseCsv } from "@/lib/csv";

type Contact = {
  id: string;
  name: string;
  brandName: string | null;
  companyName: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  notes: string | null; // used as Product Category
  status: string;
  createdAt: string;
};

type FormValues = {
  brandName: string;
  email: string;
  productCategory: string;
  website: string;
  status: string;
};

const emptyForm: FormValues = {
  brandName: "",
  email: "",
  productCategory: "",
  website: "",
  status: "ACTIVE",
};

export function ContactWorkspace() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [senderEmail, setSenderEmail] = useState<string>("Loading...");

  // CSV Import State
  const [csvRows, setCsvRows] = useState<any[]>([]);
  const [csvOpen, setCsvOpen] = useState(false);
  const [importing, setImporting] = useState(false);

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
      const params = new URLSearchParams({ pageSize: "100" });
      if (search) params.set("search", search);
      if (status) params.set("status", status);

      const [cBody, mBody] = await Promise.all([
        request(`/api/contacts?${params}`),
        request("/api/mailboxes"),
      ]);

      setContacts(cBody.contacts || []);
      setTotal(cBody.total || 0);

      const activeMailboxes = (mBody.mailboxes || []).filter(
        (m: any) => m.status === "ACTIVE" && m.smtpStatus === "CONNECTED"
      );
      if (activeMailboxes.length > 0) {
        setSenderEmail(activeMailboxes[0].emailAddress);
      } else if (mBody.mailboxes?.length > 0) {
        setSenderEmail(mBody.mailboxes[0].emailAddress);
      } else {
        setSenderEmail("No mailbox configured yet (Add in Mailboxes)");
      }
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to load contacts." });
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [search, status]);

  function change(name: keyof FormValues, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function reset() {
    setEditing(null);
    setForm(emptyForm);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.brandName.trim() || !form.email.trim()) {
      setMessage({ kind: "error", text: "Brand Name and Brand Email are required." });
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const payload = {
        name: form.brandName,
        fullName: form.brandName,
        brandName: form.brandName,
        email: form.email,
        notes: form.productCategory, // product category is stored in notes
        website: form.website || undefined,
        status: form.status,
      };

      await request(editing ? `/api/contacts/${editing}` : "/api/contacts", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });

      setMessage({ kind: "success", text: editing ? "Brand contact updated." : "Brand contact added." });
      reset();
      await load();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to save contact." });
    } finally {
      setBusy(false);
    }
  }

  async function remove(contact: Contact) {
    if (!window.confirm(`Delete ${contact.brandName || contact.name}?`)) return;
    try {
      await request(`/api/contacts/${contact.id}`, { method: "DELETE", body: "{}" });
      setMessage({ kind: "success", text: "Brand deleted." });
      await load();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to delete contact." });
    }
  }

  function handleCsvFile(file: File | undefined) {
    if (!file) return;
    void file.text().then((text) => {
      const raw = parseCsv(text);
      const mapped = raw.map((row) => ({
        brandName: csvValue(row, ["brand", "brand name", "company", "name"]),
        email: csvValue(row, ["email", "brand email", "email address", "mail"]),
        productCategory: csvValue(row, ["category", "product category", "niche", "product", "industry"]),
        website: csvValue(row, ["website", "site", "url"]),
        status: "ACTIVE",
      }));
      setCsvRows(mapped.filter((r) => r.email));
      setCsvOpen(true);
    });
  }

  async function importCsv() {
    setImporting(true);
    try {
      const formatted = csvRows.map((r) => ({
        fullName: r.brandName,
        brandName: r.brandName,
        email: r.email,
        notes: r.productCategory,
        website: r.website || undefined,
        status: "ACTIVE",
      }));

      await request("/api/contacts/import", {
        method: "POST",
        body: JSON.stringify({ rows: formatted, strategy: "skip" }),
      });

      setMessage({ kind: "success", text: `Imported ${csvRows.length} brand contacts successfully.` });
      setCsvOpen(false);
      setCsvRows([]);
      await load();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to import contacts." });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
      {/* Header with Sender Detail Badge */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Brand Contacts</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Manage your targeted brand outreach contacts, brand emails, and product categories.
          </p>
        </div>

        {/* Sender details badge */}
        <div className="flex items-center gap-2 rounded-2xl bg-purple-50 border border-purple-200 px-4 py-2 text-xs">
          <span className="text-purple-600 font-bold">📤 Connected Sender:</span>
          <span className="font-semibold text-gray-900">{senderEmail}</span>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-2xl p-4 text-xs sm:text-sm font-medium ${
            message.kind === "success"
              ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
              : "bg-red-50 border border-red-200 text-red-800"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Simplified Add/Edit Contact Form */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs">
        <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-5">
          <h2 className="text-base font-bold text-gray-900">
            {editing ? "Edit Brand Details" : "Add Brand Contact"}
          </h2>
          {editing && (
            <button
              type="button"
              onClick={reset}
              className="text-xs font-semibold text-gray-500 hover:text-black underline"
            >
              Cancel Edit
            </button>
          )}
        </div>

        <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Brand Name <span className="text-red-500">*</span>
            </label>
            <input
              required
              type="text"
              placeholder="e.g. Lang's Chocolates"
              value={form.brandName}
              onChange={(e) => change("brandName", e.target.value)}
              className="w-full rounded-xl border border-gray-200 p-2.5 text-xs sm:text-sm focus:border-[#673DE6] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Brand Email <span className="text-red-500">*</span>
            </label>
            <input
              required
              type="email"
              placeholder="e.g. sales@langschocolates.com"
              value={form.email}
              onChange={(e) => change("email", e.target.value)}
              className="w-full rounded-xl border border-gray-200 p-2.5 text-xs sm:text-sm focus:border-[#673DE6] focus:outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Product Category (Category)
            </label>
            <input
              type="text"
              placeholder="e.g. Gourmet Chocolates & Candies"
              value={form.productCategory}
              onChange={(e) => change("productCategory", e.target.value)}
              className="w-full rounded-xl border border-gray-200 p-2.5 text-xs sm:text-sm focus:border-[#673DE6] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Website (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. https://langschocolates.com"
              value={form.website}
              onChange={(e) => change("website", e.target.value)}
              className="w-full rounded-xl border border-gray-200 p-2.5 text-xs sm:text-sm focus:border-[#673DE6] focus:outline-none"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-end gap-3 pt-2">
            {!editing && (
              <button
                type="button"
                onClick={reset}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                Clear
              </button>
            )}
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-[#673DE6] hover:bg-[#5025D1] px-6 py-2.5 text-xs font-semibold text-white shadow-sm transition disabled:opacity-50"
            >
              {busy ? "Saving..." : editing ? "Update Brand" : "Save Brand Contact"}
            </button>
          </div>
        </form>
      </section>

      {/* Filter & Import Bar */}
      <section className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brand name, email, or category..."
            className="w-full rounded-full border border-gray-200 py-2 pl-4 pr-10 text-xs sm:text-sm text-gray-800 placeholder-gray-400 focus:border-[#673DE6] focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <label className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer shadow-2xs">
            📥 Import CSV / Sheet
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => handleCsvFile(e.target.files?.[0])}
            />
          </label>
          <span className="text-xs font-semibold text-gray-500">{total} Brands Total</span>
        </div>
      </section>

      {/* CSV Review Modal */}
      {csvOpen && (
        <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Review {csvRows.length} Imported Brands</h3>
            <button onClick={() => setCsvOpen(false)} className="text-xs font-bold text-gray-500 hover:text-black">
              ✕
            </button>
          </div>

          <div className="max-h-56 overflow-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                <tr>
                  <th className="p-2.5">Brand Name</th>
                  <th className="p-2.5">Brand Email</th>
                  <th className="p-2.5">Product Category</th>
                  <th className="p-2.5">Website</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {csvRows.slice(0, 20).map((r, i) => (
                  <tr key={i}>
                    <td className="p-2.5 font-semibold">{r.brandName || "—"}</td>
                    <td className="p-2.5 font-mono">{r.email}</td>
                    <td className="p-2.5 text-purple-700">{r.productCategory || "—"}</td>
                    <td className="p-2.5 text-gray-400">{r.website || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={() => setCsvOpen(false)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-700 bg-white"
            >
              Cancel
            </button>
            <button
              onClick={importCsv}
              disabled={importing}
              className="rounded-xl bg-[#673DE6] px-5 py-2 text-xs font-semibold text-white hover:bg-[#5025D1]"
            >
              {importing ? "Importing..." : `Import ${csvRows.length} Brands`}
            </button>
          </div>
        </div>
      )}

      {/* Contacts List Table */}
      {contacts.length === 0 ? (
        <EmptyState
          title="No brand contacts yet"
          description="Add a brand contact above or import an Excel/CSV file to build your outreach list."
        />
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-xs">
          <table className="w-full min-w-[900px] text-left text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold">
              <tr>
                <th className="p-4">Brand Name</th>
                <th className="p-4">Brand Email</th>
                <th className="p-4">Product Category</th>
                <th className="p-4">Website</th>
                <th className="p-4">Sender Mailbox</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contacts.map((contact) => (
                <tr key={contact.id} className="hover:bg-gray-50/60">
                  <td className="p-4 font-bold text-gray-900">{contact.brandName || contact.name}</td>
                  <td className="p-4 text-gray-700 font-mono text-xs">{contact.email}</td>
                  <td className="p-4 text-purple-700 font-medium">{contact.notes || "—"}</td>
                  <td className="p-4 text-gray-400 text-xs truncate max-w-48">
                    {contact.website ? (
                      <a href={contact.website} target="_blank" rel="noreferrer" className="hover:underline text-blue-600">
                        {contact.website.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-4 text-xs font-medium text-gray-500">{senderEmail}</td>
                  <td className="p-4">
                    <Badge tone={contact.status === "ACTIVE" ? "green" : contact.status === "REPLIED" ? "blue" : "neutral"}>
                      {contact.status}
                    </Badge>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(contact.id);
                          setForm({
                            brandName: contact.brandName || contact.name,
                            email: contact.email,
                            productCategory: contact.notes || "",
                            website: contact.website || "",
                            status: contact.status,
                          });
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(contact)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                      >
                        Delete
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
  );
}
