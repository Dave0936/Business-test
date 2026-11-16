import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** GeoNames countries and towns (population 5,000+). Places: GeoNames, CC BY 4.0. */
export const PLACES_ATTRIBUTION = "Places: GeoNames (CC BY 4.0)";

export interface Country { code: string; name: string; languages: string[]; towns: number }
export interface Town { id: number; name: string; regionName: string; population: number; lat: number; lng: number; countryCode: string }

const dir = () => path.join(process.cwd(), "data", "geonames");
let countriesCache: Country[] | null = null;
const townCache = new Map<string, [number, string, string, string, number, number, number][]>();

export async function listCountries(): Promise<Country[]> {
  countriesCache ??= (JSON.parse(await readFile(path.join(dir(), "countries.json"), "utf8")) as { countries: Country[] }).countries;
  return countriesCache;
}

async function townRows(cc: string) {
  const code = cc.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return [];
  if (!townCache.has(code)) {
    try {
      townCache.set(code, JSON.parse(await readFile(path.join(dir(), "towns", `${code}.json`), "utf8")));
    } catch {
      townCache.set(code, []);
    }
  }
  return townCache.get(code)!;
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Towns whose name starts with the query first, then containing it; biggest first within each group. */
export async function searchTowns(countryCode: string, q: string, limit = 12): Promise<Town[]> {
  const rows = await townRows(countryCode);
  const needle = fold(q.trim());
  const starts: typeof rows = [];
  const contains: typeof rows = [];
  for (const r of rows) {
    if (!needle) { starts.push(r); if (starts.length >= limit) break; continue; }
    const n = fold(r[2] || r[1]);
    if (n.startsWith(needle) || fold(r[1]).startsWith(needle)) starts.push(r);
    else if (n.includes(needle)) contains.push(r);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, Math.min(limit, 50)).map((r) => ({ id: r[0], name: r[1], regionName: r[3], population: r[4], lat: r[5], lng: r[6], countryCode: countryCode.toUpperCase() }));
}

export async function townById(countryCode: string, id: number): Promise<Town | null> {
  const r = (await townRows(countryCode)).find((x) => x[0] === id);
  return r ? { id: r[0], name: r[1], regionName: r[3], population: r[4], lat: r[5], lng: r[6], countryCode: countryCode.toUpperCase() } : null;
}
