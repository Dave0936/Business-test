import { NextResponse } from "next/server";
import { listCountries, PLACES_ATTRIBUTION } from "@/lib/places";

export async function GET() {
  return NextResponse.json({ attribution: PLACES_ATTRIBUTION, countries: await listCountries() }, { headers: { "cache-control": "public, max-age=86400" } });
}
