import type { Metadata } from "next";
import "./globals.css";
import { validateServerConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: "Hostinger by Farani",
  description: "Hostinger Webmail & Hostinger by Farani Workspace",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  validateServerConfig();
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body>{children}</body>
    </html>
  );
}
