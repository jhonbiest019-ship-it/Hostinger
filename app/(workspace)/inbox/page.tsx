import { Suspense } from "react";
import { HostingerMailDashboard } from "@/components/hostinger-mail-dashboard";

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-gray-400">Loading inbox...</div>}>
      <HostingerMailDashboard />
    </Suspense>
  );
}
