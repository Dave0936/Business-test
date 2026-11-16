"use server";
import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { z } from "zod";
import { createUserClient } from "@/lib/supabase/server";

export interface FormState {
  error?: string;
  message?: string;
}

const Creds = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(10, "Use at least 10 characters.").optional().or(z.literal("")),
  mode: z.enum(["signin", "signup", "magic"]),
  next: z.string().optional(),
});

function safeNext(next?: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/overview";
}

export async function authenticate(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = Creds.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, password, mode, next } = parsed.data;
  const supabase = await createUserClient();
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (mode === "magic") {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}` } });
    return error ? { error: error.message } : { message: "Check your inbox for a sign-in link." };
  }
  if (!password) return { error: "Enter your password." };
  if (mode === "signup") {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${origin}/auth/callback?next=/onboarding` } });
    if (error) return { error: error.message };
    if (!data.session) return { message: "Account created. Confirm your email address, then sign in." };
    redirect("/onboarding");
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Email or password is incorrect." };
  redirect(safeNext(next));
}

export async function createOrganisation(_prev: FormState, form: FormData): Promise<FormState> {
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 120) return { error: "Enter an agency name between 2 and 120 characters." };
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("create_organisation", { org_name: name });
  if (error) return { error: error.message };
  (await cookies()).set("wo_org", data as string, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  redirect("/settings?welcome=1");
}

export async function signOut() {
  const supabase = await createUserClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function switchOrganisation(form: FormData) {
  const id = String(form.get("organisation_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  (await cookies()).set("wo_org", id, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  redirect("/overview");
}
