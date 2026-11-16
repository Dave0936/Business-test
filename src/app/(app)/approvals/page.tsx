import type { Metadata } from "next";
import { PhaseNotice } from "@/components/app/phase-notice";

export const metadata: Metadata = { title: "Prototype Approvals" };

export default function Page() {
  return <PhaseNotice title="Prototype Approvals" phase={6} summary="Approve, reject or request changes on prototypes that passed quality checks. The database already refuses to approve a site without a passing quality report, and only owners and administrators can approve." available={[{ href: "/builder", label: "AI Website Builder" }]} />;
}
