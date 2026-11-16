"use client";
import { useEffect, useState } from "react";

const KEYS = ["series-1", "series-2", "series-3", "series-4", "series-5", "series-6", "series-other", "card", "grid", "muted-foreground", "foreground", "border", "primary"] as const;
export type ThemeColors = Record<(typeof KEYS)[number], string>;

function read(): ThemeColors {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(KEYS.map((k) => [k, cs.getPropertyValue(`--${k}`).trim()])) as ThemeColors;
}

/**
 * Chart colours from the active theme tokens. SVG presentation attributes cannot use var(),
 * so the values are read from CSS and re-read when the theme class or device preference changes.
 */
export function useThemeColors(): ThemeColors | null {
  const [colors, setColors] = useState<ThemeColors | null>(null);
  useEffect(() => {
    const update = () => setColors(read());
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", update);
    };
  }, []);
  return colors;
}
