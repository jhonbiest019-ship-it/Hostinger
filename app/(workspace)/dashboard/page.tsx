import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui";
import { cookies } from "next/headers";
import { getAuthenticatedUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const userId = await getAuthenticatedUserId((await cookies()).get("outreach_session")?.value);
  const [contactCount, campaignCount, draftCount, readyCount, scheduledCount, pendingJobs, sentCount, failedCount, activeCampaigns, activeFollowUps, scheduledFollowUps, sentFollowUps, failedFollowUps, repliedContacts] = userId ? await Promise.all([
    prisma.contact.count({ where: { userId } }),
    prisma.campaign.count({ where: { userId } }),
    prisma.campaign.count({ where: { userId, status: "DRAFT" } }),
    prisma.campaign.count({ where: { userId, status: "READY" } }),
    prisma.scheduledJob.count({ where: { userId, status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.scheduledJob.count({ where: { userId, status: "PENDING" } }),
    prisma.emailMessage.count({ where: { userId, status: "SENT" } }),
    prisma.emailMessage.count({ where: { userId, status: "FAILED" } }),
    prisma.campaign.count({ where: { userId, status: { in: ["SCHEDULED", "SENDING"] } } }),
    prisma.followUpRule.count({ where: { userId, enabled: true } }),
    prisma.scheduledJob.count({ where: { userId, jobType: "FOLLOW_UP", status: "PENDING" } }),
    prisma.emailMessage.count({ where: { userId, followUpStep: { not: null }, status: "SENT" } }),
    prisma.emailMessage.count({ where: { userId, followUpStep: { not: null }, status: "FAILED" } }),
    prisma.campaignRecipient.count({ where: { campaign: { userId }, status: "REPLIED" } }),
  ]) : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const stats = [["Total Contacts", String(contactCount), "Your workspace contacts"], ["Total Campaigns", String(campaignCount), `${draftCount} drafts · ${readyCount} ready`], ["Draft Campaigns", String(draftCount), "Not ready for sending"], ["Ready Campaigns", String(readyCount), "Validated campaigns"], ["Emails Sent", String(sentCount), "Actual SMTP results"], ["Emails Scheduled", String(scheduledCount), `${pendingJobs} pending jobs`], ["Active Campaigns", String(activeCampaigns), "Queued or scheduled"], ["Failed Emails", String(failedCount), "Review email logs"], ["Active Follow-ups", String(activeFollowUps), "Enabled sequence steps"], ["Scheduled Follow-ups", String(scheduledFollowUps), "Pending follow-up jobs"], ["Sent Follow-ups", String(sentFollowUps), "Actual SMTP results"], ["Failed Follow-ups", String(failedFollowUps), "Retry or review logs"], ["Replied Contacts", String(repliedContacts), "Future follow-ups stopped"]];
  return <><PageHeader eyebrow="Overview" title="Good morning, workspace" description="A clear view of your outreach foundation. Prepare campaigns and recipients without sending anything yet." action={<Badge tone="blue">Phase 5 workspace</Badge>} /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stats.map(([label, value, note], i) => <div key={label} className={`card p-5 ${i === 0 ? "border-ink/20" : ""}`}><p className="text-sm text-slate-500">{label}</p><p className="mt-4 text-3xl font-bold tracking-tight">{value}</p><p className="mt-2 text-xs text-slate-400">{note}</p></div>)}</div><div className="mt-6 grid gap-6 xl:grid-cols-3"><div className="card p-6 xl:col-span-2"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Workspace readiness</h2><p className="mt-1 text-sm text-slate-500">Your foundation is ready for controlled recipient selection.</p></div><Badge tone="green">Ready</Badge></div><div className="mt-6 space-y-4">{["Secure account and session active", "User data isolation model enabled", "Campaign recipient safeguards enabled"].map((item) => <div key={item} className="flex items-center gap-3 text-sm"><span className="grid h-6 w-6 place-items-center rounded-full bg-mint text-xs font-bold text-emerald-700">✓</span>{item}</div>)}</div></div><div className="rounded-xl bg-ink p-6 text-white"><p className="text-xs font-bold uppercase tracking-widest text-slate-300">Next step</p><h2 className="mt-3 text-xl font-bold">Review a campaign</h2><p className="mt-3 text-sm leading-6 text-slate-300">Campaign sending, scheduling, and follow-ups remain disabled until later phases.</p></div></div></>;
}
