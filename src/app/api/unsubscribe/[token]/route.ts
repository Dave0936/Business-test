import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";

/**
 * One-click unsubscribe (RFC 8058): mail apps POST "List-Unsubscribe=One-Click" here without
 * showing a page. Anyone holding the link may opt that address out; nothing else is revealed.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return new NextResponse("Not found", { status: 404 });
  const db = await createUserClient();
  const { data, error } = await db.rpc("unsubscribe_with_token", { p_token: token, p_source: "one_click" });
  if (error) return new NextResponse("Please try again later.", { status: 500 });
  return data ? new NextResponse("You have been unsubscribed.", { status: 200 }) : new NextResponse("Not found", { status: 404 });
}

/** A person who opens the address in a browser gets the confirmation page instead. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return NextResponse.redirect(new URL(`/u/${encodeURIComponent(token)}`, req.url), 303);
}
