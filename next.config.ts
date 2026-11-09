import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser", "@prisma/client"],
};

export default nextConfig;
