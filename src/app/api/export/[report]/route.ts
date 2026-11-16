import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

/** CSV exports. Runs as the signed-in user, so row-level security limits the data to their organisation. */
const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formula injection from scraped data.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const supabase = await createUserClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse("Sign in required", { status: 401 });
  const { data: members } = await supabase.from("organisation_members").select("organisation_id").eq("user_id", auth.user.id);
  const preferred = (await cookies()).get("wo_org")?.value;
  const org = members?.find((m) => m.organisation_id === preferred)?.organisation_id ?? members?.[0]?.organisation_id;
  if (!org) return new NextResponse("No organisation", { status: 403 });

  if (report !== "leads") return new NextResponse("Unknown report", { status: 404 });
  const sp = req.nextUrl.searchParams;
  let q = supabase
    .from("businesses")
    .select("name, industry_id, category, city, region, country_code, website_url, email, email_source, phone, opportunity_type, lead_score, status, subscriber_type, follow_up_at, estimated_value, actual_revenue, is_demo, discovered_at, business_sources(provider, attribution, source_url)")
    .eq("organisation_id", org);
  if (sp.get("country")) q = q.eq("country_code", sp.get("country")!);
  if (sp.get("sector")) q = q.eq("industry_id", sp.get("sector")!);
  if (sp.get("opportunity")) q = q.eq("opportunity_type", sp.get("opportunity")!);
  if (sp.get("status")) q = q.eq("status", sp.get("status")!);
  if (sp.get("minScore")) q = q.gte("lead_score", Number(sp.get("minScore")));
  if (sp.get("from")) q = q.gte("discovered_at", new Date(sp.get("from")!).toISOString());
  if (sp.get("to")) q = q.lt("discovered_at", new Date(new Date(sp.get("to")!).getTime() + 86400_000).toISOString());
  if (sp.get("q")) q = q.ilike("name", `%${sp.get("q")!.replace(/[%_]/g, "")}%`);
  const { data, error } = await q.order("discovered_at", { ascending: false }).limit(10000);
  if (error) return new NextResponse(error.message, { status: 500 });

  const cols = ["name", "industry_id", "category", "city", "region", "country_code", "website_url", "email", "email_source", "phone", "opportunity_type", "lead_score", "status", "subscriber_type", "follow_up_at", "estimated_value", "actual_revenue", "is_demo", "discovered_at"];
  const rows = (data ?? []).map((r) => {
    const sources = (r.business_sources as { provider: string; attribution: string | null; source_url: string | null }[]) ?? [];
    return [...cols.map((c) => csvCell((r as Record<string, unknown>)[c])), csvCell(sources.map((s) => s.attribution ?? s.provider).join("; ")), csvCell(sources.map((s) => s.source_url).filter(Boolean).join(" "))].join(",");
  });
  const body = [[...cols, "attribution", "source_urls"].join(","), ...rows].join("\r\n");
  return new NextResponse(`﻿${body}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
