import type { Metadata } from "next";
import { PhaseNotice } from "@/components/app/phase-notice";

export const metadata: Metadata = { title: "Website editor" };

export default function Page() {
  return <PhaseNotice title="Website editor" phase={5} summary="Live preview and editing of text, images, fonts, colours and layout, with section and full-site regeneration." available={[{ href: "/builder", label: "All prototypes" }]} />;
}
