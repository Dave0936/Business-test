import "server-only";
import fs from "node:fs";
import path from "node:path";
import { selfHostFonts, type FontManifest } from "./fonts";
import type { SiteFiles } from "./spec";

const DIR = path.join(process.cwd(), "data", "fonts");
let manifest: FontManifest | null = null;

function loadManifest(): FontManifest {
  manifest ??= JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8")) as FontManifest;
  return manifest;
}

/** Rewrite a site's Google Fonts links to bundled font files. Leaves the site unchanged if anything is missing. */
export function withSelfHostedFonts(files: SiteFiles): SiteFiles {
  try {
    return selfHostFonts(files, loadManifest(), (id, file) => {
      if (!/^[a-z0-9-]+$/.test(id) || !/^[a-z-]+-\d{3}\.woff2$/.test(file)) return null;
      const p = path.join(DIR, id, file);
      return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null;
    }).files;
  } catch {
    return files;
  }
}
