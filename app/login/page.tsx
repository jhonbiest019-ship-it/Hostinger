import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedUserId } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("outreach_session")?.value;
  const userId = await getAuthenticatedUserId(sessionToken);
  if (userId) redirect("/dashboard");
  return <AuthForm mode="login" />;
}
