import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { zipFiles } from "@/lib/sites/zip";
import type { SiteFiles } from "@/lib/sites/spec";

/** Download a prototype version as a zip (members of its organisation only, via RLS). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createUserClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse("Sign in required", { status: 401 });
  const { data: v } = await supabase.from("website_versions").select("version, files, website_id").eq("id", versionId).maybeSingle();
  if (!v) return new NextResponse("Not found", { status: 404 });
  const { data: site } = await supabase.from("generated_websites").select("slug").eq("id", v.website_id).maybeSingle();
  const files = v.files as SiteFiles;
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, f]) => ({ name, data: typeof f === "string" ? new TextEncoder().encode(f) : new Uint8Array(Buffer.from(f.base64, "base64")) }));
  const slug = (site?.slug ?? "site").replace(/[^a-z0-9-]/gi, "");
  const body = zipFiles(entries);
  return new NextResponse(Buffer.from(body), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${slug}-v${v.version}.zip"`, "cache-control": "private, no-store" },
  });
}
