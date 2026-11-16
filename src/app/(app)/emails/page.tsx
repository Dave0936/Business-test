import type { Metadata } from "next";
import { PhaseNotice } from "@/components/app/phase-notice";

export const metadata: Metadata = { title: "Email Campaigns" };

export default function Page() {
  return <PhaseNotice title="Email Campaigns" phase={8} summary="Draft, review, approve and send personalised emails through Resend, with compliance checks, suppression lists, unsubscribe handling and delivery tracking. Sending is blocked in the database without approval." available={[{ href: "/settings", label: "Agency details for email footers" }]} />;
}
