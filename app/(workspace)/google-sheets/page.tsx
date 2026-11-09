import { PageHeader } from "@/components/page-header";
import { CampaignWorkspace } from "@/components/campaign-workspace";

export const metadata = {
  title: "Google Sheets Importer - Hostinger Mail",
  description: "Import brand outreach contacts directly from Google Sheets.",
};

export default function GoogleSheetsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Cloud Data Source"
        title="Google Sheets Importer"
        description="Paste any public Google Sheet link to read rows, select your outreach batch range, and send campaign emails."
      />
      <CampaignWorkspace initialSourceMode="googlesheet" />
    </>
  );
}
