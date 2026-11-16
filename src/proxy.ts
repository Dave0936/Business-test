import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on each request and sends signed-out
 * visitors to /login. Authorisation itself is enforced by RLS and server checks;
 * this is only a convenience redirect.
 */
const PUBLIC = [/^\/login/, /^\/auth\//, /^\/setup/, /^\/u\//, /^\/api\/webhooks\//, /^\/api\/cron\//, /^\/api\/health/, /^\/api\/places\//];

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;

  if (!url || !anon) {
    if (PUBLIC.some((re) => re.test(path))) return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });
  const { data, error } = await supabase.auth.getUser();
  // Optimistic check only (per the Next.js auth guide): pages verify the user again
  // server-side. A transient network error must not be treated as "signed out".
  const transient = error?.name === "AuthRetryableFetchError";
  if (transient) console.error("proxy: auth check skipped after network error:", error.message);

  if (!data.user && !transient && !PUBLIC.some((re) => re.test(path))) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
