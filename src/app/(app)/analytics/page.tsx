import type { Metadata } from "next";
import { PhaseNotice } from "@/components/app/phase-notice";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return <PhaseNotice title="Analytics" phase={10} summary="Reports by country, industry and opportunity type, conversion rates, API costs and CSV exports. Headline figures are on the Overview dashboard." available={[{ href: "/overview", label: "Overview" }]} />;
}
