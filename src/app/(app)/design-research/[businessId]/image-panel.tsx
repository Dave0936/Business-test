"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { generateImagesAction, quoteImagesAction, type QuoteState } from "../image-actions";
import type { ActionStateLike } from "@/components/app/action-button";

export interface PanelImage {
  id: string;
  slot: string;
  status: string;
  url: string | null;
  error: string | null;
}

/** AI photos: the estimate always comes first, and nothing runs until it is confirmed. */
export function ImagePanel({ businessId, connected, canEdit, images }: { businessId: string; connected: boolean; canEdit: boolean; images: PanelImage[] }) {
  const [quote, getQuote, quoting] = useActionState<QuoteState, FormData>(quoteImagesAction, {});
  const [run, start, starting] = useActionState<ActionStateLike, FormData>(generateImagesAction, {});
  return (
    <div className="space-y-3" data-testid="image-panel">
      {!connected ? (
        <p className="text-sm text-muted-foreground">Connect Higgsfield under Integrations to generate photos for this site. Until then the builder uses Unsplash photos (if connected), your own pictures, or none.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <form action={getQuote}>
            <input type="hidden" name="businessId" value={businessId} />
            <Button type="submit" size="sm" variant="outline" disabled={!canEdit || quoting}>{quoting ? "Asking Higgsfield…" : "Get a price for photos"}</Button>
          </form>
          {quote.quote && !run.ok && (
            <form action={start}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="quotedTotal" value={String(quote.quote.totalUsd)} />
              <Button type="submit" size="sm" disabled={!canEdit || starting}>{starting ? "Starting…" : `Generate ${quote.quote.count} photos for about $${quote.quote.totalUsd.toFixed(2)}`}</Button>
            </form>
          )}
          {quote.quote && <span className="text-xs text-muted-foreground">Higgsfield&apos;s estimate for: {quote.quote.slots.join(" · ")}. Failed or moderated images aren&apos;t charged.</span>}
          {(quote.error || quote.message) && <span role="status" className={`text-xs ${quote.error ? "text-destructive" : "text-muted-foreground"}`}>{quote.error ?? quote.message}</span>}
          {(run.error || run.message) && <span role="status" className={`text-xs ${run.error ? "text-destructive" : "text-success"}`}>{run.error ?? run.message}</span>}
        </div>
      )}
      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {images.map((im) => (
            <li key={im.id} className="overflow-hidden rounded-lg border bg-card text-xs">
              <div className="aspect-[3/2] bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link to private storage */}
                {im.url ? <img src={im.url} alt={im.slot} className="size-full object-cover" /> : <div className="flex size-full items-center justify-center p-2 text-center text-muted-foreground">{im.status === "failed" ? "Failed" : "Generating…"}</div>}
              </div>
              <div className="space-y-1 p-2">
                <p className="line-clamp-2">{im.slot}</p>
                <Badge variant={im.status === "completed" ? "success" : im.status === "failed" ? "destructive" : "secondary"}>{im.status === "completed" ? "AI photo" : im.status}</Badge>
                {im.error && <p className="text-destructive">{im.error}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Photos are generic scenes for this kind of business, never shown as the business itself. Sites that use them say so.</p>
    </div>
  );
}
