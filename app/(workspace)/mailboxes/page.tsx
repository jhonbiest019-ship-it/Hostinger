import { PageHeader } from "@/components/page-header";
import { MailboxWorkspace } from "@/components/mailbox-workspace";

export default function MailboxesPage() { return <><PageHeader eyebrow="Workspace" title="Mailboxes" description="Connect an actual Hostinger email mailbox for secure SMTP and IMAP verification. This phase does not send or synchronize email." /><MailboxWorkspace /></>; }
