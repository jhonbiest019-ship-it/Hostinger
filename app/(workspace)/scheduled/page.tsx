import { PageHeader } from "@/components/page-header";
import { ScheduledWorkspace } from "@/components/scheduled-workspace";

export default function ScheduledPage() { return <><PageHeader eyebrow="Queue" title="Scheduled emails" description="Server-side queue jobs waiting for controlled processing. Your browser does not need to stay open." /><ScheduledWorkspace /></>; }
