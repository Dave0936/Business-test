"use client";
import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Mode = "light" | "dark" | "system";
const NEXT: Record<Mode, Mode> = { light: "dark", dark: "system", system: "light" };
const LABEL: Record<Mode, string> = { light: "Light", dark: "Dark", system: "Match device" };

/** Cycles light → dark → system. Applies instantly and remembers the choice in a cookie. */
export function ThemeToggle({ initial }: { initial: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  return (
    <button
      type="button"
      onClick={() => {
        const next = NEXT[mode];
        setMode(next);
        const root = document.documentElement;
        root.classList.remove("light", "dark");
        if (next !== "system") root.classList.add(next);
        document.cookie = `wo_theme=${next}; path=/; max-age=31536000; samesite=lax`;
      }}
      className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={`Theme: ${LABEL[mode]}. Switch to ${LABEL[NEXT[mode]]}`}
      title={`Theme: ${LABEL[mode]}`}
    >
      <Icon className="size-4" />
    </button>
  );
}
