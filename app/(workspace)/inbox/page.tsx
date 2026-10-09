import { PageHeader } from "@/components/page-header";
import { InboxWorkspace } from "@/components/inbox-workspace";

export default function InboxPage() { return <><PageHeader eyebrow="Inbound replies" title="Inbox" description="Review inbound messages and campaign replies synchronized from verified mailboxes." /><InboxWorkspace /></>; }
