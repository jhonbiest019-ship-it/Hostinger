import { AppShell } from "@/components/app-shell";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedUserId } from "@/lib/auth";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) { const userId = await getAuthenticatedUserId((await cookies()).get("outreach_session")?.value); if (!userId) redirect("/login"); return <AppShell>{process.env.EMAIL_TEST_MODE === "true" && <div role="status" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Test mode: sends are simulated. No real emails are delivered and inbox sync is disabled.</div>}{children}</AppShell>; }
