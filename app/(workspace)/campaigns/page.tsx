import { PageHeader } from "@/components/page-header";
import { CampaignWorkspace } from "@/components/campaign-workspace";

export default function CampaignsPage() { return <><PageHeader eyebrow="Campaign management" title="Campaigns" description="Choose recipients, templates and schedules, then monitor your campaigns." /><CampaignWorkspace /></>; }
