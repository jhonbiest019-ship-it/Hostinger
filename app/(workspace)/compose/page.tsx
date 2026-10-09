import { PageHeader } from "@/components/page-header";
import { EmailComposer } from "@/components/email-composer";

export default function ComposePage() { return <><PageHeader eyebrow="Manual sending" title="Email composer" description="Send one reviewed email from a verified mailbox. Bulk sending and automation remain disabled." /><EmailComposer /></>; }
