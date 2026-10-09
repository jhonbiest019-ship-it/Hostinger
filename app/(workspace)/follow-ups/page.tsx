import { PageHeader } from "@/components/page-header";
import { FollowUpBuilder } from "@/components/follow-up-builder";

export default function FollowUpsPage() { return <><PageHeader eyebrow="Sequence automation" title="Follow-ups" description="Configure step-based follow-ups. Actual sending is handled by the server queue and stops when a genuine reply is detected." /><FollowUpBuilder /></>; }
