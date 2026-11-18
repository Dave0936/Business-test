// Copies the animation libraries prototypes may use into data/vendor (MIT licensed; bundled
// with each site that uses them, so pages never load scripts from elsewhere).
// Run after updating the motion or lenis packages: node scripts/build-vendor.mjs
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("data/vendor");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const strip = (s) => s.replace(/\n?\/\/# sourceMappingURL=.*$/m, "");
const files = [
  ["node_modules/motion/dist/motion.js", "motion.js"],
  ["node_modules/lenis/dist/lenis.min.js", "lenis.min.js"],
  ["node_modules/lenis/dist/lenis.css", "lenis.css"],
];
for (const [src, dest] of files) fs.writeFileSync(path.join(OUT, dest), strip(fs.readFileSync(src, "utf8")));
const licence = (pkg) => fs.readFileSync(path.resolve("node_modules", pkg, fs.readdirSync(path.resolve("node_modules", pkg)).find((f) => /^licen[cs]e/i.test(f))), "utf8");
fs.writeFileSync(path.join(OUT, "LICENSES.txt"), `motion ${JSON.parse(fs.readFileSync("node_modules/motion/package.json", "utf8")).version}\n${licence("motion")}\n\nlenis ${JSON.parse(fs.readFileSync("node_modules/lenis/package.json", "utf8")).version}\n${licence("lenis")}\n`);
console.log("Copied", files.map((f) => f[1]).join(", "), "to data/vendor");
