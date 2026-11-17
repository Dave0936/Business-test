import type { Metadata } from "next";
import { createUserClient } from "@/lib/supabase/server";
import { UnsubscribeForm } from "./unsubscribe-form";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Public unsubscribe page linked from every email. Shows only the sender and a masked address. */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = /^[A-Za-z0-9_-]{32,128}$/.test(token);
  const db = await createUserClient();
  const { data } = valid ? await db.rpc("unsubscribe_token_info", { p_token: token }) : { data: null };
  const info = (data as { agency_name: string; masked_email: string; already_done: boolean }[] | null)?.[0];
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
      <div className="space-y-4 rounded-xl border bg-card p-6 shadow-xs">
        <h1 className="text-xl font-semibold">Unsubscribe</h1>
        {!info ? (
          <p className="text-sm text-muted-foreground">This link is not valid. If you received an email you did not want, reply to it with “unsubscribe” and the sender must stop.</p>
        ) : info.already_done ? (
          <p role="status">{info.masked_email} is already unsubscribed. {info.agency_name} will not email it again.</p>
        ) : (
          <>
            <p>Stop all email from <span className="font-medium">{info.agency_name}</span> to <span className="font-medium">{info.masked_email}</span>?</p>
            <UnsubscribeForm token={token} sender={info.agency_name} />
            <p className="text-xs text-muted-foreground">This takes effect straight away. Nothing else is needed.</p>
          </>
        )}
      </div>
    </main>
  );
}
