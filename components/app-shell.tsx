"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { useState } from "react";

const navigation = [
  ["Dashboard", "/dashboard", "DB"], ["Mailboxes", "/mailboxes", "MB"], ["Contacts", "/contacts", "CT"], ["Templates", "/templates", "TP"], ["Compose", "/compose", "EM"],
  ["Campaigns", "/campaigns", "CP"], ["Follow-ups", "/follow-ups", "FU"],
  ["Inbox", "/inbox", "IN"], ["Scheduled", "/scheduled", "SC"], ["Email Logs", "/email-logs", "LG"], ["Settings", "/settings", "ST"],
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return <div className="min-h-screen bg-cloud">
    <aside className={`fixed inset-y-0 left-0 z-30 w-64 border-r border-line bg-white px-4 py-5 transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center gap-3 px-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-xs font-bold text-white">OS</div><div><p className="font-bold tracking-tight">Outreach Studio</p><p className="text-[11px] text-slate-400">Campaign workspace</p></div></div>
      <nav className="mt-8 space-y-1" aria-label="Main navigation">{navigation.map(([label, href, icon]) => <Link key={href} href={href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${pathname === href ? "bg-ink text-white" : "text-slate-600 hover:bg-cloud hover:text-ink"}`}><span className="w-6 text-[10px] font-bold opacity-70">{icon}</span>{label}</Link>)}</nav>
      <div className="absolute bottom-5 left-4 right-4 rounded-xl bg-cloud p-4"><p className="text-xs font-semibold">Secure workspace</p><p className="mt-1 text-xs leading-5 text-slate-500">Mailbox connections and sending remain separated by phase.</p></div>
    </aside>
    {open && <button className="fixed inset-0 z-20 bg-ink/30 lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)} />}
    <div className="lg:pl-64"><header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-line bg-white/90 px-5 backdrop-blur sm:px-8"><button className="rounded-lg border border-line px-3 py-2 text-sm lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">Menu</button><div className="hidden text-sm text-slate-500 sm:block">Workspace <span className="mx-2">/</span> <span className="font-medium text-ink">{navigation.find(([, href]) => href === pathname)?.[0] ?? "Dashboard"}</span></div><div className="ml-auto flex items-center gap-3"><div className="hidden text-right sm:block"><p className="text-sm font-semibold">Your workspace</p><button className="text-xs text-slate-400 hover:text-ink" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }}>Sign out</button></div><div className="grid h-9 w-9 place-items-center rounded-full bg-mint text-xs font-bold text-emerald-800">OS</div></div></header><main className="mx-auto max-w-[1500px] p-5 sm:p-8">{children}</main></div>
  </div>;
}
