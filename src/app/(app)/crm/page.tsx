import type { Metadata } from "next";
import { PhaseNotice } from "@/components/app/phase-notice";

export const metadata: Metadata = { title: "CRM" };

export default function Page() {
  return <PhaseNotice title="CRM" phase={2} summary="Pipeline board and follow-up reminders. Lead records with full activity history are already available under Business Leads." available={[{ href: "/leads", label: "Business Leads" }]} />;
}
