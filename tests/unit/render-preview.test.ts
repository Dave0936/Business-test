// Dev helper: RENDER_OUT=/some/dir npx vitest run tests/unit/render-preview.test.ts
import fs from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { renderSite } from "@/lib/sites/render";
import { demoSpec } from "./fixtures";

const out = process.env.RENDER_OUT;
it.runIf(Boolean(out))("writes demo prototypes to disk", () => {
  for (const industry of ["restaurant", "plumber", "beauty_salon"]) {
    for (const [name, f] of Object.entries(renderSite(demoSpec({}, industry)))) {
      const p = path.join(out!, industry, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, typeof f === "string" ? f : Buffer.from(f.base64, "base64"));
    }
  }
});
