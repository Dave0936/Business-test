import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { SiteFiles } from "./spec";
import { referencedVendor } from "./vendor";

const DIR = path.join(process.cwd(), "data", "vendor");
const cache = new Map<string, string>();
const read = (name: string) => {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(DIR, name), "utf8"));
  return cache.get(name)!;
};

/** Add the animation libraries the pages link, with their licences. */
export function withVendor(files: SiteFiles): SiteFiles {
  const used = referencedVendor(files);
  if (!used.length) return files;
  const out: SiteFiles = { ...files };
  for (const v of used) out[v] = read(v.replace(/^vendor\//, ""));
  out["vendor/LICENSES.txt"] = read("LICENSES.txt");
  return out;
}
