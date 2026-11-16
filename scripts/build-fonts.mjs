// Copies the self-hosted fonts used by prototypes from @fontsource packages into data/fonts.
// Only Latin and Latin Extended subsets, weights 400/600/700 (or the nearest available).
// Run after changing FONT_CHOICES: node scripts/build-fonts.mjs
import fs from "node:fs";
import path from "node:path";

const FONTS = ["Inter", "DM Sans", "Manrope", "Outfit", "Plus Jakarta Sans", "Work Sans", "Source Sans 3", "Nunito Sans",
  "Playfair Display", "Fraunces", "Cormorant Garamond", "Libre Baskerville", "Lora", "DM Serif Display",
  "Space Grotesk", "Sora", "Archivo", "Barlow", "Oswald", "Bebas Neue", "Poppins", "Montserrat", "Raleway"];
const SUBSETS = ["latin", "latin-ext"];
const WANT = [400, 600, 700];
const OUT = path.resolve("data/fonts");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const manifest = {};
for (const family of FONTS) {
  const id = family.toLowerCase().replace(/ /g, "-");
  const dir = path.resolve("node_modules/@fontsource", id);
  const unicode = JSON.parse(fs.readFileSync(path.join(dir, "unicode.json"), "utf8"));
  const files = fs.readdirSync(path.join(dir, "files"));
  const available = [...new Set(files.map((f) => f.match(new RegExp(`^${id}-latin-(\\d+)-normal\\.woff2$`))?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);
  const pick = (w) => available.reduce((best, a) => (Math.abs(a - w) < Math.abs(best - w) ? a : best), available[0]);
  const weights = [...new Set(WANT.map(pick))];
  manifest[family] = { id, weights, subsets: {} };
  fs.mkdirSync(path.join(OUT, id), { recursive: true });
  for (const subset of SUBSETS) {
    if (!unicode[subset]) continue;
    manifest[family].subsets[subset] = unicode[subset];
    for (const w of weights) {
      const src = path.join(dir, "files", `${id}-${subset}-${w}-normal.woff2`);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, id, `${subset}-${w}.woff2`));
    }
  }
  fs.copyFileSync(path.join(dir, "LICENSE"), path.join(OUT, id, "LICENSE"));
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`Copied ${Object.keys(manifest).length} families to data/fonts`);
