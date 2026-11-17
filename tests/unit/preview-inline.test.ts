import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { inlinePageAssets, inlinePreviewCsp } from "@/lib/sites/preview-inline";
import type { SiteFiles } from "@/lib/sites/spec";

const FILES: SiteFiles = {
  "index.html": '<!doctype html><html lang="en"><head><link rel="stylesheet" href="fonts/fonts.css"><link rel="stylesheet" href="styles.css"><script src="script.js" defer></script><script type="application/ld+json">{"@type":"Restaurant"}</script></head><body><h1>Hi</h1><img src="assets/generated/a.png" alt="x"></body></html>',
  "fr/index.html": '<!doctype html><html lang="fr"><head><link rel="stylesheet" href="../styles.css"></head><body><h1>Salut</h1><script src="../script.js"></script></body></html>',
  "styles.css": "body{color:#111}h1{font-family:Fraunces}",
  "fonts/fonts.css": '@font-face{font-family:"Fraunces";src:url("fraunces-latin-400.woff2") format("woff2")}',
  "fonts/fraunces-latin-400.woff2": { base64: Buffer.from("wOF2fake").toString("base64"), contentType: "font/woff2" },
  "script.js": 'document.body.dataset.ready="1"; var s="</script>";',
  "assets/generated/a.png": { base64: Buffer.alloc(10).toString("base64"), contentType: "image/png" },
};

describe("preview pages carry their own assets", () => {
  it("inlines stylesheets, fonts and scripts, leaving photos as links", () => {
    const { html, scriptHashes } = inlinePageAssets("index.html", FILES);
    expect(html).not.toMatch(/<link rel="stylesheet"/);
    expect(html).toContain("body{color:#111}");
    expect(html).toMatch(/url\("data:font\/woff2;base64,/);
    expect(html).not.toMatch(/<script src=/);
    expect(html).toContain('src="assets/generated/a.png"');
    expect(html).toMatch(/<script type="application\/ld\+json">/);
    // The script now sits at the end of <body>, and its hash matches its exact text.
    const body = html.slice(html.indexOf("<body>"));
    const m = body.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain("<\\/script>");
    expect(scriptHashes).toEqual([`'sha256-${createHash("sha256").update(m![1], "utf8").digest("base64")}'`]);
  });

  it("resolves files from pages in language folders", () => {
    const { html } = inlinePageAssets("fr/index.html", FILES);
    expect(html).toContain("body{color:#111}");
    expect(html).toContain('dataset.ready="1"');
  });

  it("allows only the page's own scripts", () => {
    const csp = inlinePreviewCsp("https://app.example", ["'sha256-abc'"]);
    expect(csp).toMatch(/script-src 'sha256-abc'(;|$)/);
    expect(csp).toMatch(/sandbox allow-scripts allow-forms/);
    expect(csp).toMatch(/connect-src 'none'/);
    expect(inlinePreviewCsp("https://app.example", [])).toMatch(/script-src 'none'/);
  });
});
