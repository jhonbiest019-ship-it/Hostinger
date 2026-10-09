import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  if (!request.cookies.has("outreach_session")) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/mailboxes/:path*", "/contacts/:path*", "/templates/:path*", "/campaigns/:path*", "/follow-ups/:path*", "/inbox/:path*", "/scheduled/:path*", "/email-logs/:path*", "/settings/:path*"] };
