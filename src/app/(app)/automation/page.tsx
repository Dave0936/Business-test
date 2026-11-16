import type { Metadata } from "next";
import { PhaseNotice } from "@/components/app/phase-notice";

export const metadata: Metadata = { title: "Automation Centre" };

export default function Page() {
  return <PhaseNotice title="Automation Centre" phase={9} summary="Scheduled workflows with per-agent switches, lead and prototype limits, cost monitoring, pause and resume." available={[{ href: "/opportunities", label: "Find Opportunities" }]} />;
}
