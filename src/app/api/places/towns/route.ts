import { NextResponse, type NextRequest } from "next/server";
import { searchTowns, PLACES_ATTRIBUTION } from "@/lib/places";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const towns = await searchTowns(sp.get("country") ?? "", (sp.get("q") ?? "").slice(0, 80), Number(sp.get("limit") ?? 12));
  return NextResponse.json({ attribution: PLACES_ATTRIBUTION, towns }, { headers: { "cache-control": "public, max-age=3600" } });
}
