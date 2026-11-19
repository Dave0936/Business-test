import type { Metadata } from "next";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { getOrgContext, roleAtLeast } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ActionButton } from "@/components/app/action-button";
import { DemoBadge } from "@/components/app/badges";
import { formatDate } from "@/lib/utils";
import { SelectionBar, type SelectionOp } from "@/components/app/selection-bar";
import { binSelectionAction, purgeLeadAction, restoreLeadAction } from "./actions";

export const metadata: Metadata = { title: "Recycle bin" };

const BIN_DAYS = 30;

export default async function BinPage() {
  const ctx = await getOrgContext();
  const db = await createUserClient({ includeBinned: true });
  const { data: leads, error } = await db
    .from("businesses")
    .select("id, name, city, country_code, is_demo, deleted_at, deleter:users!businesses_deleted_by_fkey(full_name, email)")
    .eq("organisation_id", ctx.organisationId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const staff = roleAtLeast(ctx.role, "staff");
  const admin = roleAtLeast(ctx.role, "administrator");

  return (
    <>
      <PageHeader title="Recycle bin" description={`Leads moved to the bin are hidden everywhere and nothing is sent to them. They are deleted permanently, with everything about them, ${BIN_DAYS} days after they were binned.`} actions={<Link href="/leads" className="text-sm text-primary hover:underline">Back to leads</Link>} />
      {leads?.length ? (
        <Card>
          {staff && (
            <form id="bin-select">
              <SelectionBar action={binSelectionAction} name="businessId" ops={[
                { op: "restore", label: "Restore" },
                ...(admin ? [
                  { op: "purge", label: "Delete permanently", variant: "ghost", confirm: "Delete {n} lead(s) permanently, with their audits, designs, prototypes, emails and activity? This can't be undone." },
                  { op: "empty", label: "Empty the bin", variant: "ghost", noSelection: true, confirm: "Delete every lead in the recycle bin permanently? This can't be undone." },
                ] satisfies SelectionOp[] : []),
              ]} />
            </form>
          )}
          <CardContent>
            <ul className="divide-y" data-testid="bin">
              {leads.map((b) => {
                const who = b.deleter as unknown as { full_name: string | null; email: string } | null;
                const purgeOn = new Date(new Date(b.deleted_at!).getTime() + BIN_DAYS * 86400_000);
                return (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {staff && <input type="checkbox" form="bin-select" name="businessId" value={b.id} aria-label={`Select ${b.name}`} className="mt-1 size-4" />}
                      <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">{b.name}<DemoBadge show={b.is_demo} /></p>
                      <p className="text-xs text-muted-foreground">{b.city ?? "—"}, {b.country_code} · binned {formatDate(b.deleted_at!, true)}{who ? ` by ${who.full_name ?? who.email}` : ""} · deleted for good on {formatDate(purgeOn.toISOString())}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {staff && <ActionButton action={restoreLeadAction} hidden={{ businessId: b.id }} label="Restore" variant="outline" />}
                      {admin && <ActionButton action={purgeLeadAction} hidden={{ businessId: b.id }} label="Delete now" variant="ghost" confirm={`Delete ${b.name} permanently, with its audits, designs, prototypes, emails and activity? This can't be undone.`} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : <EmptyState icon={Trash2} title="The recycle bin is empty">Leads you move to the bin appear here for {BIN_DAYS} days.</EmptyState>}
    </>
  );
}
