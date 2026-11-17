"use server";
import { createUserClient } from "@/lib/supabase/server";

export interface UnsubscribeState { done?: boolean; error?: string }

/** Public: opt the address behind this link out of all further email from the sender. */
export async function unsubscribeAction(_p: UnsubscribeState, form: FormData): Promise<UnsubscribeState> {
  const token = String(form.get("token") ?? "");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return { error: "This link is not valid." };
  const db = await createUserClient();
  const { data, error } = await db.rpc("unsubscribe_with_token", { p_token: token, p_source: "unsubscribe_page" });
  if (error) return { error: "Something went wrong. Please try again, or reply to the email with “unsubscribe”." };
  return data ? { done: true } : { error: "This link is not valid." };
}
