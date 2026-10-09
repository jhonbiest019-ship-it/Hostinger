import { AppShell } from "@/components/app-shell";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedUserId } from "@/lib/auth";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) { const userId = await getAuthenticatedUserId((await cookies()).get("outreach_session")?.value); if (!userId) redirect("/login"); return <AppShell>{children}</AppShell>; }
