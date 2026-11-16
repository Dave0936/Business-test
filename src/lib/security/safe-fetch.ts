import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * Fetching websites we do not control is the main SSRF risk in this app.
 * Every outbound request to a prospect's site goes through safeFetch, which:
 *  - allows only http/https on ports 80/443,
 *  - resolves DNS itself and refuses private, loopback, link-local, multicast
 *    and reserved addresses (checked at connect time, so DNS rebinding fails),
 *  - follows redirects manually, re-checking each hop (max 5),
 *  - enforces a timeout and a response size cap,
 *  - never sends cookies or credentials.
 */

export class UnsafeUrlError extends Error {}

const ALLOWED_PORTS = new Set(["", "80", "443"]);

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  return parsed.range() === "unicast";
}

export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Only http and https are allowed (got ${url.protocol})`);
  }
  if (!ALLOWED_PORTS.has(url.port)) throw new UnsafeUrlError(`Port ${url.port} is not allowed`);
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host) && !isPublicAddress(host)) {
    throw new UnsafeUrlError(`Address ${host} is not public`);
  }
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local") || lower.endsWith(".internal") || !lower.includes(".")) {
    throw new UnsafeUrlError(`Host ${host} is not a public hostname`);
  }
  return url;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: object, cb: LookupCb) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad || list.length === 0) {
      return cb(Object.assign(new UnsafeUrlError(`${hostname} resolves to a non-public address`), { code: "EUNSAFE" }), "");
    }
    const wantsAll = (options as { all?: boolean }).all;
    if (wantsAll) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

const agent = new Agent({
  connect: { lookup: guardedLookup as never, timeout: 10_000 },
  headersTimeout: 15_000,
  bodyTimeout: 15_000,
});

export interface SafeResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  truncated: boolean;
  redirects: string[];
  elapsedMs: number;
  timeToFirstByteMs: number;
}

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

export const DEFAULT_UA = "WebOpportunityAI-Auditor/1.0 (+website assessment; respects robots.txt)";

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 3_000_000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const started = performance.now();
  const redirects: string[] = [];
  let current = assertSafeUrl(rawUrl);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
    try {
      const res = await undiciFetch(current, {
        method: opts.method ?? "GET",
        redirect: "manual",
        dispatcher: agent,
        signal: controller.signal,
        headers: {
          "user-agent": opts.userAgent ?? DEFAULT_UA,
          accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        },
      });
      const ttfb = performance.now() - started;

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location")!, current);
        redirects.push(next.toString());
        current = assertSafeUrl(next.toString());
        await res.body?.cancel();
        continue;
      }

      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));

      let bytes = 0;
      let truncated = false;
      const chunks: Uint8Array[] = [];
      if (res.body && (opts.method ?? "GET") === "GET") {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            truncated = true;
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
      const body = Buffer.concat(chunks).toString("utf8");
      return {
        url: current.toString(),
        status: res.status,
        headers,
        body,
        bytes,
        truncated,
        redirects,
        elapsedMs: Math.round(performance.now() - started),
        timeToFirstByteMs: Math.round(ttfb),
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new UnsafeUrlError(`Too many redirects (>${maxRedirects})`);
}
