"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { NAV } from "./nav";
import { cn } from "@/lib/utils";

export function Sidebar({ counts }: { counts: Record<string, number> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <>
      <button className="fixed top-3 left-3 z-40 rounded-md bg-sidebar p-2 text-white lg:hidden" onClick={() => setOpen(!open)} aria-label={open ? "Close navigation" : "Open navigation"}>
        {open ? <X className="size-4" /> : <Menu className="size-4" />}
      </button>
      <aside className={cn("fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <Link href="/overview" className="flex h-14 items-center gap-2 px-5 text-sm font-semibold text-white">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-[11px] font-bold">WO</span>
          WebOpportunity AI
        </Link>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3" aria-label="Main">
          {groups.map((g) => (
            <div key={g}>
              <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">{g}</p>
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
                        className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-active hover:text-white", active && "bg-sidebar-active font-medium text-white")}
                      >
                        <n.icon className="size-4 opacity-80" />
                        <span className="flex-1">{n.label}</span>
                        {count ? <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white">{count}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <p className="border-t border-white/10 px-5 py-3 text-[11px] leading-snug text-sidebar-muted">Deployments and emails always wait for an owner or administrator to approve them.</p>
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}
