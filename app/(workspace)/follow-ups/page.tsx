import { PageHeader } from "@/components/page-header";
import { FollowUpWorkspace } from "@/components/follow-up-workspace";

export default function FollowUpsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Sequence automation"
        title="Follow-ups Tracking & Automation"
        description="Monitor every brand follow-up sequence in real time. Configured templates are strictly delivered on schedule, and follow-ups immediately stop whenever a brand responds."
      />
      <FollowUpWorkspace />
    </>
  );
}
