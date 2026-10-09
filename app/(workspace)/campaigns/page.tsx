import { PageHeader } from "@/components/page-header";
import { CampaignWorkspace } from "@/components/campaign-workspace";

export default function CampaignsPage() { return <><PageHeader eyebrow="Campaign management" title="Campaigns" description="Organize recipients and prepare outreach campaigns. Sending and scheduling are intentionally disabled in Phase 5." /><CampaignWorkspace /></>; }
