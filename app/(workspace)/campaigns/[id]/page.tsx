import { PageHeader } from "@/components/page-header";
import { CampaignDetail } from "@/components/campaign-detail";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <><PageHeader eyebrow="Campaign review" title="Campaign details" description="Select recipients, configure follow-ups and control when this campaign runs." /><CampaignDetail id={id} /></>; }
