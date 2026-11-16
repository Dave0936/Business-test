"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { NAV } from "./nav";
import { cn } from "@/lib/utils";

export function Sidebar({ counts, organisationName }: { counts: Record<string, number>; organisationName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <>
      <button className="fixed top-3 left-3 z-40 rounded-lg border bg-card p-2 text-foreground shadow-sm lg:hidden" onClick={() => setOpen(!open)} aria-label={open ? "Close navigation" : "Open navigation"}>
        {open ? <X className="size-4" /> : <Menu className="size-4" />}
      </button>
      <aside className={cn("fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <Link href="/overview" className="flex h-16 items-center gap-3 px-5">
          <span className="grid size-9 place-items-center rounded-xl bg-brand text-sm font-bold text-brand-foreground shadow-sm">
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden><path fill="currentColor" d="M12 3c3.5 2.6 5.6 5.7 5.6 9.2A5.6 5.6 0 0 1 12 18a5.6 5.6 0 0 1-5.6-5.8C6.4 8.7 8.5 5.6 12 3Zm0 16.2V21" stroke="currentColor" strokeWidth="1.2" /></svg>
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold">WebOpportunity</span>
            <span className="block max-w-36 truncate text-xs text-sidebar-muted">{organisationName}</span>
          </span>
        </Link>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
          {groups.map((g) => (
            <div key={g}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">{g}</p>
              <ul className="space-y-0.5">
                {NAV.filter((n) => n.group === g).map((n) => {
                  const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
                  const count = counts[n.href];
                  return (
                    <li key={n.href}>
                      <Link
                        href={n.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                          active ? "bg-sidebar-active font-medium text-sidebar-active-foreground shadow-sm" : "hover:bg-sidebar-hover",
                        )}
                      >
                        <n.icon className="size-4 shrink-0 opacity-85" />
                        <span className="flex-1">{n.label}</span>
                        {count ? <span className="rounded-full bg-highlight px-1.5 text-[10px] font-semibold text-highlight-foreground">{count}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <p className="mx-3 mb-3 rounded-xl bg-sidebar-hover px-4 py-3 text-[11px] leading-snug text-sidebar-muted">Deployments and emails always wait for an owner or administrator to approve them.</p>
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}
