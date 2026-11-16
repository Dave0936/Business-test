import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import type { SiteFiles } from "@/lib/sites/spec";

/**
 * Serves a prototype version to signed-in members of its organisation (RLS).
 * Pages are shown inside <iframe sandbox="allow-scripts allow-forms"> without
 * allow-same-origin, and served with a strict CSP, so generated code can never
 * read the app's cookies or call its APIs.
 */
const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", svg: "image/svg+xml", txt: "text/plain; charset=utf-8" };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ versionId: string; path?: string[] }> }) {
  const { versionId, path } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createUserClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse("Sign in required", { status: 401 });
  const { data: v } = await supabase.from("website_versions").select("files").eq("id", versionId).maybeSingle();
  if (!v) return new NextResponse("Not found", { status: 404 });

  const key = (path ?? []).join("/") || "index.html";
  if (key.includes("..") || key.startsWith("_")) return new NextResponse("Not found", { status: 404 });
  const files = v.files as SiteFiles;
  const f = files[key];
  if (f === undefined) return new NextResponse("Not found", { status: 404 });

  const ext = key.split(".").pop() ?? "";
  const body = typeof f === "string" ? f : Buffer.from(f.base64, "base64");
  return new NextResponse(body, {
    headers: {
      "content-type": typeof f === "string" ? TYPES[ext] ?? "application/octet-stream" : f.contentType,
      "content-security-policy": "default-src 'self'; img-src 'self' https://images.unsplash.com data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; form-action 'none'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms",
      "x-robots-tag": "noindex",
      "cache-control": "private, max-age=0, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
