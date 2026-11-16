import type { Metadata } from "next";
import { PhaseNotice } from "@/components/app/phase-notice";

export const metadata: Metadata = { title: "Cloudflare Deployments" };

export default function Page() {
  return <PhaseNotice title="Cloudflare Deployments" phase={7} summary="Deployment history and live preview URLs. Deployment runs only after an approval of the exact version, and is recorded as successful only when Cloudflare confirms it." available={[{ href: "/integrations", label: "Integrations" }]} />;
}
