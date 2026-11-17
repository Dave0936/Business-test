import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import type { SiteFiles } from "@/lib/sites/spec";

/**
 * Serves a prototype version to signed-in members of its organisation (RLS).
 * Pages are shown inside <iframe sandbox="allow-scripts allow-forms"> without
 * allow-same-origin, and served with a strict CSP, so generated code can never
 * read the app's cookies or call its APIs.
 */
/**
 * The preview runs sandboxed (opaque origin). Safari treats 'self' in such a document as
 * matching nothing, which blocks the page's own stylesheet, script and fonts, so the app's
 * origin is named explicitly instead.
 */
function previewCsp(origin: string): string {
  const o = /^https?:\/\/[a-z0-9.:-]+$/i.test(origin) ? origin : "'self'";
  return `default-src ${o}; img-src ${o} https://images.unsplash.com data:; style-src ${o} https://fonts.googleapis.com; font-src ${o} https://fonts.gstatic.com; script-src ${o}; form-action 'none'; base-uri ${o}; object-src 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms`;
}

const TOKEN_RE = /^~\d{10}\.[0-9a-f]{64}$/;
const TYPES: Record<string, string> = { woff2: "font/woff2", html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", svg: "image/svg+xml", txt: "text/plain; charset=utf-8" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ versionId: string; path?: string[] }> }) {
  const { versionId, path } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createUserClient();
  // Signed link (/api/preview/<version>/~<token>/page.html): the sandboxed iframe sends no
  // cookies for subresources, so the signature stands in for them. Issued by sign_preview()
  // only to members who can read the version; it expires after two hours.
  const segments = [...(path ?? [])];
  let files: SiteFiles | null = null;
  if (segments[0] && TOKEN_RE.test(segments[0])) {
    const token = segments.shift()!.slice(1);
    const { data } = await supabase.rpc("preview_files", { p_version: versionId, p_token: token });
    if (!data) return new NextResponse("This preview link has expired. Reload the page.", { status: 403 });
    files = data as SiteFiles;
  } else {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return new NextResponse("Sign in required", { status: 401 });
    const { data: v } = await supabase.from("website_versions").select("files").eq("id", versionId).maybeSingle();
    if (!v) return new NextResponse("Not found", { status: 404 });
    files = v.files as SiteFiles;
  }

  const key = segments.join("/") || "index.html";
  if (key.includes("..") || key.startsWith("_")) return new NextResponse("Not found", { status: 404 });
  const f = files[key];
  if (f === undefined) return new NextResponse("Not found", { status: 404 });

  const ext = key.split(".").pop() ?? "";
  const body = typeof f === "string" ? f : Buffer.from(f.base64, "base64");
  return new NextResponse(body, {
    headers: {
      "content-type": typeof f === "string" ? TYPES[ext] ?? "application/octet-stream" : f.contentType,
      "content-security-policy": previewCsp(new URL(req.url).origin),
      "x-robots-tag": "noindex",
      "cache-control": "private, max-age=0, no-store",
      "x-content-type-options": "nosniff",
      // Fonts are fetched in CORS mode from the sandboxed (opaque-origin) preview.
      ...(ext === "woff2" ? { "access-control-allow-origin": "*" } : {}),
    },
  });
}
