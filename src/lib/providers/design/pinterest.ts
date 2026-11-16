import "server-only";

/**
 * Pinterest API v5. Searching public pins requires Pinterest's approval for the
 * partner search endpoint; a standard token can only read the account's own boards.
 * We support both:
 *  - partner search (GET /v5/search/partner/pins) when the token has access;
 *  - the account's own boards (GET /v5/boards, /v5/boards/{id}/pins), which suits
 *    agencies that curate inspiration boards by sector.
 * Pins are stored as references (link + thumbnail + attribution), never re-hosted.
 */
export interface PinRef {
  id: string;
  title: string | null;
  link: string;
  imageUrl: string | null;
  attribution: string;
}

const API = "https://api.pinterest.com/v5";

async function call<T>(token: string, path: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (res.status === 401 || res.status === 403) throw new Error("Pinterest token lacks access to this endpoint");
  if (!res.ok) throw new Error(`Pinterest API error ${res.status}`);
  return (await res.json()) as T;
}

interface Pin {
  id: string;
  title?: string;
  description?: string;
  link?: string;
  media?: { images?: Record<string, { url: string }> };
  pinner?: { username?: string };
}

function toRef(p: Pin): PinRef {
  const imgs = p.media?.images ?? {};
  const img = imgs["600x"]?.url ?? imgs["400x300"]?.url ?? Object.values(imgs)[0]?.url ?? null;
  return {
    id: p.id,
    title: p.title || p.description?.slice(0, 120) || null,
    link: `https://www.pinterest.com/pin/${p.id}/`,
    imageUrl: img,
    attribution: p.pinner?.username ? `Pinterest · ${p.pinner.username}` : "Pinterest",
  };
}

export async function searchPins(token: string, term: string, countryCode = "GB", limit = 12): Promise<PinRef[]> {
  const q = new URLSearchParams({ term, country_code: countryCode, limit: String(Math.min(limit, 50)) });
  const json = await call<{ items: Pin[] }>(token, `/search/partner/pins?${q}`);
  return json.items.map(toRef);
}

export interface Board {
  id: string;
  name: string;
  pinCount: number | null;
  description: string | null;
}

/** The connected account's own boards (works with a standard token). */
export async function listBoards(token: string, fetchImpl: typeof fetch = fetch): Promise<Board[]> {
  const out: Board[] = [];
  let bookmark: string | null = null;
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ page_size: "100" });
    if (bookmark) q.set("bookmark", bookmark);
    const json = await call<{ items: { id: string; name: string; pin_count?: number; description?: string }[]; bookmark?: string | null }>(token, `/boards?${q}`, fetchImpl);
    out.push(...json.items.map((b) => ({ id: b.id, name: b.name, pinCount: b.pin_count ?? null, description: b.description || null })));
    bookmark = json.bookmark ?? null;
    if (!bookmark) break;
  }
  return out;
}

/** One page of a board's pins; pass the returned bookmark to get the next page. */
export async function boardPinsPage(token: string, boardId: string, opts: { limit?: number; bookmark?: string | null } = {}, fetchImpl: typeof fetch = fetch): Promise<{ pins: PinRef[]; bookmark: string | null }> {
  if (!/^[0-9]+$/.test(boardId)) throw new Error("Invalid Pinterest board id");
  const q = new URLSearchParams({ page_size: String(Math.min(opts.limit ?? 12, 100)) });
  if (opts.bookmark) q.set("bookmark", opts.bookmark);
  const json = await call<{ items: Pin[]; bookmark?: string | null }>(token, `/boards/${boardId}/pins?${q}`, fetchImpl);
  return { pins: json.items.map(toRef), bookmark: json.bookmark ?? null };
}

export async function boardPins(token: string, boardNameContains: string, limit = 12): Promise<PinRef[]> {
  const boards = await call<{ items: { id: string; name: string }[] }>(token, "/boards?page_size=100");
  const board = boards.items.find((b) => b.name.toLowerCase().includes(boardNameContains.toLowerCase()));
  if (!board) return [];
  const pins = await call<{ items: Pin[] }>(token, `/boards/${board.id}/pins?page_size=${Math.min(limit, 100)}`);
  return pins.items.map(toRef);
}
