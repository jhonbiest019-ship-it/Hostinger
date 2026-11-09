import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserId, logSecurityEvent, revokeUserSessions } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const token = request.cookies.get("outreach_session")?.value;
  const userId = await getAuthenticatedUserId(token);

  if (userId) {
    // Invalidate session on server side
    await revokeUserSessions(userId).catch(() => undefined);
    await logSecurityEvent("LOGOUT", userId, {}, request);
  }

  const response = NextResponse.json({ success: true, message: "Logged out successfully." });
  response.cookies.set("outreach_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
