import { PageHeader } from "@/components/page-header";
import { MailboxWorkspace } from "@/components/mailbox-workspace";

export default function MailboxesPage() { return <><PageHeader eyebrow="Workspace" title="Mailboxes" description="Connect your email mailbox and verify SMTP sending and IMAP access. Connection tests do not send email." /><MailboxWorkspace /></>; }
