import { PageHeader } from "@/components/page-header";
import { EmailLogWorkspace } from "@/components/email-log-workspace";

export default function EmailLogsPage() { return <><PageHeader eyebrow="Delivery history" title="Email logs" description="Review manual sent and failed emails belonging to your workspace." /><EmailLogWorkspace /></>; }
