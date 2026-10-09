import type { Metadata } from "next";
import "./globals.css";
import { validateServerConfig } from "@/lib/config";

export const metadata: Metadata = { title: "Outreach Studio", description: "Professional outreach workspace" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  validateServerConfig();
  return <html lang="en"><body>{children}</body></html>;
}
