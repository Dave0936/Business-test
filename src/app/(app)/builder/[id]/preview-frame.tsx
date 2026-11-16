"use client";
import { useState } from "react";
import { Monitor, Smartphone, ExternalLink } from "lucide-react";

/**
 * Prototype preview. The iframe is sandboxed without allow-same-origin and the preview route
 * sends a strict CSP, so generated code cannot read the app's cookies or call its APIs.
 */
export function PreviewFrame({ versionId, pages }: { versionId: string; pages: string[] }) {
  const [page, setPage] = useState(pages.includes("index.html") ? "index.html" : pages[0] ?? "index.html");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const src = `/api/preview/${versionId}/${page}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="preview-page">Page</label>
        <select id="preview-page" value={page} onChange={(e) => setPage(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-sm">
          {pages.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Device">
          <button type="button" onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${device === "desktop" ? "bg-secondary" : ""}`}><Monitor className="size-3.5" aria-hidden /> Desktop</button>
          <button type="button" onClick={() => setDevice("mobile")} aria-pressed={device === "mobile"} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${device === "mobile" ? "bg-secondary" : ""}`}><Smartphone className="size-3.5" aria-hidden /> Phone</button>
        </div>
        <a href={src} target="_blank" rel="noopener" className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">Open in a new tab <ExternalLink className="size-3" aria-hidden /></a>
      </div>
      <div className="flex justify-center overflow-hidden rounded-xl border bg-muted p-2">
        <iframe
          key={`${versionId}-${page}`}
          title="Prototype preview"
          src={src}
          sandbox="allow-scripts allow-forms"
          className="h-[70vh] rounded-lg border bg-white transition-[width]"
          style={{ width: device === "mobile" ? 390 : "100%" }}
          data-testid="preview"
        />
      </div>
    </div>
  );
}
