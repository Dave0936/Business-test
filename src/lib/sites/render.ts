import { artFileName, artSvg } from "./images";
import type { ResolvedImage, Section, SiteFiles, SiteSpec } from "./spec";

/**
 * Renders a SiteSpec into a static, dependency-free website:
 * semantic HTML, one stylesheet, one small script, Cloudflare Pages _headers.
 * All text is HTML-escaped; links are limited to local pages, tel:, mailto: and https:.
 */

export const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const RADIUS = { none: "0px", small: "6px", medium: "12px", large: "22px" } as const;
const SPACE = { compact: "64px", comfortable: "88px", airy: "120px" } as const;

type Page = SiteSpec["content"]["pages"][number];

function pageFile(slug: string) {
  return slug === "index" ? "index.html" : `${slug}.html`;
}

function hasPage(spec: SiteSpec, slug: string) {
  return spec.content.pages.some((p) => p.slug === slug);
}

function ctaHref(spec: SiteSpec, target: string): string {
  const b = spec.business;
  switch (target) {
    case "booking":
      return hasPage(spec, "booking") ? "booking.html" : "contact.html#enquiry";
    case "call":
      return b.phone ? `tel:${b.phone.replace(/[^+\d]/g, "")}` : "contact.html";
    case "email":
      return b.email ? `mailto:${b.email}` : "contact.html";
    case "services":
      return hasPage(spec, "services") ? "services.html" : "index.html#services";
    default:
      return hasPage(spec, "contact") ? "contact.html" : "index.html#contact";
  }
}

function image(spec: SiteSpec, query: string, cls = "", eager = false): string {
  const img: ResolvedImage | undefined = spec.images[query];
  const src = img?.src ?? artFileName(query);
  const alt = img?.alt ?? "";
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

function section(spec: SiteSpec, s: Section, idx: number): string {
  const id = `s${idx}`;
  switch (s.type) {
    case "hero": {
      const layout = spec.theme.heroLayout;
      const ctas = `<div class="actions"><a class="btn btn-primary" href="${esc(ctaHref(spec, s.primary_cta.target))}">${esc(s.primary_cta.label)}</a>${s.secondary_cta ? `<a class="btn btn-ghost" href="${esc(ctaHref(spec, s.secondary_cta.target))}">${esc(s.secondary_cta.label)}</a>` : ""}</div>`;
      const text = `<div class="hero-text"><p class="eyebrow">${esc(spec.content.tagline)}</p><h1>${esc(s.heading)}</h1><p class="lead">${esc(s.subheading)}</p>${ctas}</div>`;
      if (layout === "full-bleed") return `<section class="hero hero-bleed" id="${id}"><div class="hero-media">${image(spec, s.image_query, "", true)}</div><div class="wrap">${text}</div></section>`;
      if (layout === "centered") return `<section class="hero hero-centered" id="${id}"><div class="wrap">${text}</div></section>`;
      return `<section class="hero hero-split" id="${id}"><div class="wrap split">${text}<div class="hero-media">${image(spec, s.image_query, "", true)}</div></div></section>`;
    }
    case "text":
      return `<section class="band" id="${id}"><div class="wrap narrow"><h2>${esc(s.heading)}</h2>${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div></section>`;
    case "services":
      return `<section class="band" id="services"><div class="wrap"><div class="section-head"><h2>${esc(s.heading)}</h2><p>${esc(s.intro)}</p></div><ul class="cards">${s.items.map((i) => `<li class="card"><h3>${esc(i.name)}</h3><p>${esc(i.description)}</p></li>`).join("")}</ul></div></section>`;
    case "features":
      return `<section class="band band-alt" id="${id}"><div class="wrap"><h2>${esc(s.heading)}</h2><ul class="features">${s.items.map((i, n) => `<li><span class="num" aria-hidden="true">${String(n + 1).padStart(2, "0")}</span><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></li>`).join("")}</ul></div></section>`;
    case "gallery":
      return `<section class="band" id="gallery"><div class="wrap"><h2>${esc(s.heading)}</h2><div class="gallery" data-count="${Math.min(s.image_queries.length, 5)}">${s.image_queries.map((q) => `<figure>${image(spec, q)}</figure>`).join("")}</div></div></section>`;
    case "cta":
      return `<section class="band cta-band" id="${id}"><div class="wrap cta-inner"><div><h2>${esc(s.heading)}</h2><p>${esc(s.text)}</p></div><a class="btn btn-light" href="${esc(ctaHref(spec, s.cta.target))}">${esc(s.cta.label)}</a></div></section>`;
    case "contact":
      return `<section class="band" id="contact"><div class="wrap split contact"><div><h2>${esc(s.heading)}</h2><p>${esc(s.text)}</p>${contactDetails(spec)}</div>${contactForm(spec)}</div></section>`;
    case "booking":
      return `<section class="band" id="booking"><div class="wrap narrow"><h2>${esc(s.heading)}</h2><p>${esc(s.text)}</p>${bookingForm(spec, s.fields)}</div></section>`;
    case "faq":
      return `<section class="band" id="${id}"><div class="wrap narrow"><h2>${esc(s.heading)}</h2>${s.items.map((i) => `<details><summary>${esc(i.question)}</summary><p>${esc(i.answer)}</p></details>`).join("")}</div></section>`;
  }
}

function contactDetails(spec: SiteSpec): string {
  const b = spec.business;
  const rows: string[] = [];
  if (b.phone) rows.push(`<li><span>Phone</span><a href="tel:${esc(b.phone.replace(/[^+\d]/g, ""))}">${esc(b.phone)}</a></li>`);
  if (b.email) rows.push(`<li><span>Email</span><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></li>`);
  const addr = [b.address, b.city].filter(Boolean).join(", ");
  if (addr) rows.push(`<li><span>Address</span><span>${esc(addr)}</span></li>`);
  return rows.length ? `<ul class="details">${rows.join("")}</ul>` : `<p class="muted">Contact details would be confirmed with the business.</p>`;
}

const conceptNote = (spec: SiteSpec) => `<p class="form-note" role="note">This is a concept. Messages are not sent to ${esc(spec.business.name)}.</p>`;

function contactForm(spec: SiteSpec): string {
  return `<form class="form" id="enquiry" data-concept-form novalidate>
<div class="field"><label for="c-name">Name</label><input id="c-name" name="name" autocomplete="name" required></div>
<div class="field"><label for="c-email">Email</label><input id="c-email" name="email" type="email" autocomplete="email" required></div>
<div class="field"><label for="c-phone">Phone <span class="opt">(optional)</span></label><input id="c-phone" name="phone" type="tel" autocomplete="tel"></div>
<div class="field"><label for="c-message">Message</label><textarea id="c-message" name="message" rows="5" required></textarea></div>
<button class="btn btn-primary" type="submit">Send message</button>
<p class="form-status" role="status" aria-live="polite"></p>${conceptNote(spec)}</form>`;
}

function bookingForm(spec: SiteSpec, fields: string[]): string {
  const f: Record<string, string> = {
    date: `<div class="field"><label for="b-date">Date</label><input id="b-date" name="date" type="date" required></div>`,
    time: `<div class="field"><label for="b-time">Preferred time</label><input id="b-time" name="time" type="time" required></div>`,
    party_size: `<div class="field"><label for="b-size">Number of people</label><input id="b-size" name="party_size" type="number" min="1" max="30" required></div>`,
    service: `<div class="field"><label for="b-service">Service</label><input id="b-service" name="service" required></div>`,
    notes: `<div class="field field-wide"><label for="b-notes">Anything we should know? <span class="opt">(optional)</span></label><textarea id="b-notes" name="notes" rows="3"></textarea></div>`,
  };
  return `<form class="form form-grid" data-concept-form novalidate>
<div class="field"><label for="b-name">Name</label><input id="b-name" name="name" autocomplete="name" required></div>
<div class="field"><label for="b-email">Email</label><input id="b-email" name="email" type="email" autocomplete="email" required></div>
${fields.map((k) => f[k] ?? "").join("\n")}
<div class="field-wide"><button class="btn btn-primary" type="submit">Request booking</button><p class="form-status" role="status" aria-live="polite"></p>${conceptNote(spec)}</div></form>`;
}

function fontsHref(spec: SiteSpec): string {
  const fam = [...new Set([spec.theme.fonts.heading, spec.theme.fonts.body])].map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700`);
  return `https://fonts.googleapis.com/css2?${fam.join("&")}&display=swap`;
}

function jsonLd(spec: SiteSpec): string {
  const b = spec.business;
  const data: Record<string, unknown> = { "@context": "https://schema.org", "@type": "LocalBusiness", name: b.name };
  if (b.phone) data.telephone = b.phone;
  if (b.email) data.email = b.email;
  if (b.address || b.city) data.address = { "@type": "PostalAddress", streetAddress: b.address ?? undefined, addressLocality: b.city ?? undefined, addressCountry: b.countryCode };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function layout(spec: SiteSpec, page: Page): string {
  const nav = spec.content.pages.map((p) => `<li><a href="${pageFile(p.slug)}"${p.slug === page.slug ? ' aria-current="page"' : ""}>${esc(p.nav_label)}</a></li>`).join("");
  const hero = page.sections.find((s) => s.type === "hero") as Extract<Section, { type: "hero" }> | undefined;
  const primary = hero?.primary_cta ?? { label: "Get in touch", target: "contact" as const };
  const mobileCta = spec.business.phone
    ? `<a class="btn btn-primary" href="tel:${esc(spec.business.phone.replace(/[^+\d]/g, ""))}">Call</a><a class="btn btn-ghost" href="${esc(ctaHref(spec, primary.target))}">${esc(primary.label)}</a>`
    : `<a class="btn btn-primary" href="${esc(ctaHref(spec, primary.target))}">${esc(primary.label)}</a>`;
  const credits = Object.values(spec.images).filter((i) => i.credit).map((i) => `<a href="${esc(i.credit!.url)}" rel="noopener">${esc(i.credit!.name)}</a>`);
  const agency = spec.agency.website ? `<a href="${esc(spec.agency.website)}" rel="noopener">${esc(spec.agency.name)}</a>` : esc(spec.agency.name);
  const body = page.sections.map((s, i) => section(spec, s, i)).join("\n");
  const h1Present = page.sections.some((s) => s.type === "hero");

  return `<!doctype html>
<html lang="${esc(spec.business.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.meta_description)}">
<meta name="robots" content="noindex, nofollow">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.meta_description)}">
<meta property="og:type" content="website">
<meta name="theme-color" content="${esc(spec.theme.colors.primary)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(fontsHref(spec))}">
<link rel="stylesheet" href="styles.css">
<script type="application/ld+json">${jsonLd(spec)}</script>
<script src="script.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="concept-bar" role="note">Independent website concept created by ${agency}. It has not been commissioned or endorsed by ${esc(spec.business.name)}.</div>
<header class="site-header">
<div class="wrap header-inner">
<a class="brand" href="index.html">${esc(spec.business.name)}</a>
<button class="nav-toggle" aria-expanded="false" aria-controls="site-nav"><span class="sr">Menu</span><span aria-hidden="true"></span></button>
<nav id="site-nav" aria-label="Main"><ul>${nav}</ul></nav>
<a class="btn btn-primary header-cta" href="${esc(ctaHref(spec, primary.target))}">${esc(primary.label)}</a>
</div>
</header>
<main id="main">
${h1Present ? "" : `<div class="page-title"><div class="wrap"><h1>${esc(page.title.split(" · ")[0])}</h1></div></div>`}
${body}
</main>
<footer class="site-footer">
<div class="wrap footer-grid">
<div><p class="brand">${esc(spec.business.name)}</p><p class="muted">${esc(spec.content.tagline)}</p></div>
<div>${contactDetails(spec)}</div>
<nav aria-label="Footer"><ul>${nav}</ul></nav>
</div>
<div class="wrap footer-legal">
<p>Concept by ${agency}. Not commissioned or endorsed by ${esc(spec.business.name)}. Business details are taken from public listings.</p>
${credits.length ? `<p>Photos from Unsplash by ${credits.join(", ")}.</p>` : ""}
</div>
</footer>
<div class="mobile-cta">${mobileCta}</div>
</body>
</html>
`;
}

function css(spec: SiteSpec): string {
  const c = spec.theme.colors;
  return `:root{--primary:${c.primary};--secondary:${c.secondary};--accent:${c.accent};--bg:${c.background};--surface:${c.surface};--text:${c.text};--muted:${c.muted};--radius:${RADIUS[spec.theme.radius]};--space:${SPACE[spec.theme.density]};--font-h:"${spec.theme.fonts.heading}",Georgia,serif;--font-b:"${spec.theme.fonts.body}",system-ui,-apple-system,"Segoe UI",sans-serif;--maxw:1180px}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:400 1.0625rem/1.65 var(--font-b);padding-bottom:72px}
@media (min-width:860px){body{padding-bottom:0}}
img{max-width:100%;display:block;height:auto}
a{color:var(--primary)}
h1,h2,h3{font-family:var(--font-h);line-height:1.12;margin:0 0 .5em;letter-spacing:-.01em;color:var(--text)}
h1{font-size:clamp(2.3rem,5.4vw,4.1rem);font-weight:600}
h2{font-size:clamp(1.7rem,3.4vw,2.5rem);font-weight:600}
h3{font-size:1.2rem;font-weight:600}
p{margin:0 0 1em}
.wrap{width:min(var(--maxw),100% - 40px);margin-inline:auto}
.narrow{max-width:760px}
.muted{color:var(--muted)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.skip{position:absolute;left:-999px;top:8px;background:var(--surface);padding:8px 12px;z-index:100}
.skip:focus{left:8px}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.concept-bar{background:var(--text);color:var(--bg);font-size:.8rem;text-align:center;padding:6px 16px;line-height:1.4}
.concept-bar a{color:inherit}
.site-header{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid color-mix(in srgb,var(--text) 8%,transparent)}
.header-inner{display:flex;align-items:center;gap:24px;min-height:68px}
.brand{font-family:var(--font-h);font-weight:700;font-size:1.25rem;color:var(--text);text-decoration:none;margin:0}
#site-nav{margin-left:auto}
#site-nav ul{display:flex;gap:26px;list-style:none;margin:0;padding:0}
#site-nav a{color:var(--text);text-decoration:none;font-size:.95rem;font-weight:500;padding:6px 0;border-bottom:2px solid transparent}
#site-nav a:hover,#site-nav a[aria-current=page]{border-bottom-color:var(--accent)}
.nav-toggle{display:none;margin-left:auto;background:none;border:0;width:44px;height:44px;cursor:pointer}
.nav-toggle span[aria-hidden]{display:block;width:22px;height:2px;background:var(--text);margin:auto;box-shadow:0 7px 0 var(--text),0 -7px 0 var(--text)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 22px;border-radius:var(--radius);font-weight:600;font-size:.98rem;text-decoration:none;border:2px solid transparent;cursor:pointer;transition:transform .15s ease,background .15s ease,box-shadow .15s ease;font-family:var(--font-b)}
.btn:hover{transform:translateY(-1px)}
.btn-primary{background:var(--primary);color:#fff;box-shadow:0 6px 18px -8px var(--primary)}
.btn-ghost{background:transparent;color:var(--text);border-color:color-mix(in srgb,var(--text) 25%,transparent)}
.btn-light{background:#fff;color:#111}
.hero{position:relative;padding:calc(var(--space) * .9) 0}
.hero .eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:.78rem;font-weight:600;color:var(--muted);margin-bottom:14px}
.hero .lead{font-size:1.18rem;color:var(--muted);max-width:56ch}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.split{display:grid;gap:48px;align-items:center}
@media (min-width:860px){.split{grid-template-columns:1.05fr .95fr}}
.hero-split .hero-media img{aspect-ratio:4/5;object-fit:cover;width:100%;border-radius:calc(var(--radius) * 1.4)}
@media (max-width:859px){.hero-split .hero-media img{aspect-ratio:16/10}}
.hero-centered{text-align:center;background:radial-gradient(ellipse at top,color-mix(in srgb,var(--accent) 22%,var(--bg)),var(--bg) 70%)}
.hero-centered .hero-text{max-width:820px;margin:auto}
.hero-centered .lead{margin-inline:auto}
.hero-centered .actions{justify-content:center}
.hero-bleed{min-height:min(88vh,760px);display:flex;align-items:flex-end;color:#fff;padding-bottom:calc(var(--space) * .8)}
.hero-bleed .hero-media{position:absolute;inset:0}
.hero-bleed .hero-media img{width:100%;height:100%;object-fit:cover}
.hero-bleed .hero-media::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.2),rgba(0,0,0,.72))}
.hero-bleed .wrap{position:relative}
.hero-bleed h1,.hero-bleed .lead,.hero-bleed .eyebrow{color:#fff}
.hero-bleed .lead{opacity:.92}
.hero-bleed .btn-ghost{color:#fff;border-color:rgba(255,255,255,.6)}
.page-title{padding:calc(var(--space) * .6) 0 0}
.band{padding:var(--space) 0}
.band-alt{background:var(--surface)}
.section-head{display:grid;gap:8px;margin-bottom:36px;max-width:680px}
.section-head p{color:var(--muted)}
.cards{list-style:none;padding:0;margin:0;display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.card{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 9%,transparent);border-radius:var(--radius);padding:26px;transition:border-color .2s ease,transform .2s ease}
.card:hover{border-color:var(--accent);transform:translateY(-2px)}
.card p{color:var(--muted);margin:0}
.features{list-style:none;padding:0;margin:28px 0 0;display:grid;gap:32px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.features .num{display:block;font-family:var(--font-h);font-size:.9rem;color:var(--accent);font-weight:700;margin-bottom:10px}
.features p{color:var(--muted)}
.gallery{display:grid;gap:14px;grid-template-columns:repeat(2,1fr);margin-top:24px}
@media (min-width:860px){.gallery{grid-template-columns:repeat(4,1fr)}.gallery figure:first-child{grid-column:span 2;grid-row:span 2}.gallery[data-count="3"]{grid-template-columns:2fr 1fr}.gallery[data-count="3"] figure:first-child{grid-column:auto}.gallery[data-count="4"]{grid-template-columns:2fr 1fr 1fr}.gallery[data-count="4"] figure:first-child{grid-column:auto}.gallery[data-count="4"] figure:nth-child(4){grid-column:span 2}}
.gallery figure{margin:0;overflow:hidden;border-radius:var(--radius)}
.gallery img{width:100%;height:100%;aspect-ratio:1;object-fit:cover;transition:transform .5s ease}
.gallery figure:hover img{transform:scale(1.04)}
.cta-band{background:var(--primary);color:#fff}
.cta-band h2,.cta-band p{color:#fff}
.cta-inner{display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:space-between}
.details{list-style:none;padding:0;margin:20px 0 0;display:grid;gap:12px}
.details li{display:grid;grid-template-columns:90px 1fr;gap:8px}
.details li>span:first-child{color:var(--muted);font-size:.9rem}
.form{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 10%,transparent);border-radius:calc(var(--radius) * 1.2);padding:28px;display:grid;gap:16px}
.form-grid{grid-template-columns:1fr}
@media (min-width:640px){.form-grid{grid-template-columns:1fr 1fr}.field-wide{grid-column:1/-1}}
.field{display:grid;gap:6px}
.field label{font-weight:600;font-size:.92rem}
.opt{font-weight:400;color:var(--muted)}
input,textarea{font:inherit;color:var(--text);background:var(--bg);border:1.5px solid color-mix(in srgb,var(--text) 18%,transparent);border-radius:calc(var(--radius) * .7);padding:12px 14px;width:100%}
input:focus,textarea:focus{border-color:var(--primary);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 20%,transparent)}
input[aria-invalid=true],textarea[aria-invalid=true]{border-color:#b42318}
.form-status{margin:0;font-weight:600}
.form-note{margin:0;font-size:.82rem;color:var(--muted)}
details{border-bottom:1px solid color-mix(in srgb,var(--text) 12%,transparent);padding:16px 0}
summary{cursor:pointer;font-weight:600}
.site-footer{background:var(--text);color:var(--bg);padding:64px 0 28px;margin-top:0}
.site-footer .brand,.site-footer a{color:var(--bg)}
.site-footer .muted,.site-footer .details li>span:first-child{color:color-mix(in srgb,var(--bg) 70%,transparent)}
.footer-grid{display:grid;gap:32px}
@media (min-width:860px){.footer-grid{grid-template-columns:1.2fr 1fr .8fr}}
.site-footer nav ul{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.footer-legal{border-top:1px solid color-mix(in srgb,var(--bg) 18%,transparent);margin-top:40px;padding-top:20px;font-size:.82rem;color:color-mix(in srgb,var(--bg) 70%,transparent)}
.mobile-cta{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;gap:10px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:var(--surface);border-top:1px solid color-mix(in srgb,var(--text) 10%,transparent)}
.mobile-cta .btn{flex:1}
@media (min-width:860px){.mobile-cta{display:none}}
@media (max-width:859px){
.header-cta{display:none}
.nav-toggle{display:block}
#site-nav{position:absolute;left:0;right:0;top:100%;background:var(--bg);border-bottom:1px solid color-mix(in srgb,var(--text) 10%,transparent);display:none}
#site-nav.open{display:block}
#site-nav ul{flex-direction:column;gap:0;padding:8px 20px 16px}
#site-nav a{display:block;padding:12px 0}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`;
}

const SCRIPT = `(function(){
var t=document.querySelector('.nav-toggle'),n=document.getElementById('site-nav');
if(t&&n){t.addEventListener('click',function(){var o=n.classList.toggle('open');t.setAttribute('aria-expanded',o?'true':'false');});}
document.querySelectorAll('form[data-concept-form]').forEach(function(f){
f.addEventListener('submit',function(e){e.preventDefault();var ok=true;
f.querySelectorAll('input,textarea').forEach(function(i){var v=i.checkValidity();i.setAttribute('aria-invalid',v?'false':'true');if(!v&&ok){i.focus();ok=false;}});
var s=f.querySelector('.form-status');
if(!ok){if(s)s.textContent='Please complete the highlighted fields.';return;}
if(s)s.textContent='Thanks. This is a concept site, so nothing was sent.';f.reset();});});
})();`;

export function renderSite(spec: SiteSpec): SiteFiles {
  const files: SiteFiles = {};
  for (const page of spec.content.pages) files[pageFile(page.slug)] = layout(spec, page);
  files["styles.css"] = css(spec);
  files["script.js"] = SCRIPT;
  files["robots.txt"] = "User-agent: *\nDisallow: /\n";
  files["_headers"] = `/*
  Content-Security-Policy: default-src 'self'; img-src 'self' https://images.unsplash.com data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'self' ${spec.agency.website ? new URL(spec.agency.website).origin : ""}; base-uri 'self'; object-src 'none'
  X-Robots-Tag: noindex, nofollow
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`;
  // Generated artwork for any image without a resolved photo.
  const queries = new Set<string>();
  for (const p of spec.content.pages) for (const s of p.sections) {
    if (s.type === "hero") queries.add(s.image_query);
    if (s.type === "gallery") s.image_queries.forEach((q) => queries.add(q));
  }
  for (const q of queries) {
    if (!spec.images[q]) files[artFileName(q)] = artSvg(q, spec.theme.colors);
  }
  for (const img of Object.values(spec.images)) {
    if (img.kind === "upload" && img.src.startsWith("assets/")) {
      // Uploaded files are added to the bundle by the builder (binary, base64).
    }
  }
  return files;
}

export function imageQueries(spec: Pick<SiteSpec, "content">): string[] {
  const q = new Set<string>();
  for (const p of spec.content.pages) for (const s of p.sections) {
    if (s.type === "hero") q.add(s.image_query);
    if (s.type === "gallery") s.image_queries.forEach((x) => q.add(x));
  }
  return [...q];
}
