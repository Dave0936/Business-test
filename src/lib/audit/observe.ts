import * as cheerio from "cheerio";

/**
 * Observed facts about a page, derived only from what was fetched.
 * No opinions here: anything subjective belongs to the AI judgement step.
 */
export interface Observations {
  fetched: boolean;
  finalUrl: string | null;
  httpStatus: number | null;
  https: boolean;
  redirectedToHttps: boolean;
  timeToFirstByteMs: number | null;
  totalTimeMs: number | null;
  pageBytes: number | null;
  error: string | null;
  robotsDisallowed: boolean;
  title: string | null;
  metaDescription: string | null;
  lang: string | null;
  viewportMeta: string | null;
  hasResponsiveViewport: boolean;
  mediaQueryCount: number;
  h1Count: number;
  imageCount: number;
  imagesMissingAlt: number;
  linkCount: number;
  internalLinks: string[];
  formCount: number;
  inputCount: number;
  telLinks: string[];
  mailtoLinks: string[];
  publishedEmails: string[];
  contactPageUrl: string | null;
  bookingLinks: string[];
  bookingPlatforms: string[];
  ctaCount: number;
  ctaTexts: string[];
  generator: string | null;
  deprecatedTags: string[];
  tableLayoutSignals: number;
  usesFlashOrApplets: boolean;
  jqueryVersion: string | null;
  mixedContentCount: number;
  structuredData: boolean;
  openGraph: boolean;
  canonical: string | null;
  latestYearMentioned: number | null;
  scriptCount: number;
  stylesheetCount: number;
  wordCount: number;
  textExcerpt: string;
  brokenLinks: { url: string; status: number | string }[];
  linksChecked: number;
  mobileRender: { checked: boolean; horizontalOverflow?: boolean; viewportWidth?: number; contentWidth?: number; screenshotPath?: string } | null;
}

export function emptyObservations(partial: Partial<Observations> = {}): Observations {
  return {
    fetched: false, finalUrl: null, httpStatus: null, https: false, redirectedToHttps: false,
    timeToFirstByteMs: null, totalTimeMs: null, pageBytes: null, error: null, robotsDisallowed: false,
    title: null, metaDescription: null, lang: null, viewportMeta: null, hasResponsiveViewport: false,
    mediaQueryCount: 0, h1Count: 0, imageCount: 0, imagesMissingAlt: 0, linkCount: 0, internalLinks: [],
    formCount: 0, inputCount: 0, telLinks: [], mailtoLinks: [], publishedEmails: [], contactPageUrl: null,
    bookingLinks: [], bookingPlatforms: [], ctaCount: 0, ctaTexts: [], generator: null, deprecatedTags: [],
    tableLayoutSignals: 0, usesFlashOrApplets: false, jqueryVersion: null, mixedContentCount: 0,
    structuredData: false, openGraph: false, canonical: null, latestYearMentioned: null, scriptCount: 0,
    stylesheetCount: 0, wordCount: 0, textExcerpt: "", brokenLinks: [], linksChecked: 0, mobileRender: null,
    ...partial,
  };
}

const BOOKING_PLATFORMS: [RegExp, string][] = [
  [/opentable\./i, "OpenTable"], [/resy\.com/i, "Resy"], [/sevenrooms\./i, "SevenRooms"],
  [/fresha\.com/i, "Fresha"], [/booksy\.com/i, "Booksy"], [/treatwell\./i, "Treatwell"],
  [/calendly\.com/i, "Calendly"], [/simplybook\./i, "SimplyBook"], [/setmore\.com/i, "Setmore"],
  [/acuityscheduling\.com/i, "Acuity"], [/square(up)?\.com\/appointments/i, "Square Appointments"],
  [/booking\.com/i, "Booking.com"], [/thefork\./i, "TheFork"], [/mindbodyonline\./i, "Mindbody"],
  [/designmynight\./i, "DesignMyNight"], [/quandoo\./i, "Quandoo"], [/zocdoc\./i, "Zocdoc"],
];
const BOOKING_WORDS = /\b(book|booking|reserve|reservation|appointment|schedule a|réserver|reservar|prenota|termin|afspraak)\b/i;
const CTA_WORDS = /\b(book|call|contact|get a quote|quote|enquire|inquire|order|reserve|schedule|start|request|buy|shop|get in touch|sign up|free consultation)\b/i;
const DEPRECATED = ["font", "center", "marquee", "blink", "frameset", "frame", "big", "tt", "strike"];
const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function analyseHtml(html: string, pageUrl: string): Partial<Observations> {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const abs = (href: string) => {
    try {
      return new URL(href, base).toString();
    } catch {
      return null;
    }
  };

  const links = $("a[href]").toArray().map((a) => ({ href: ($(a).attr("href") ?? "").trim(), text: $(a).text().replace(/\s+/g, " ").trim() }));
  const tel = links.filter((l) => /^tel:/i.test(l.href)).map((l) => l.href.replace(/^tel:/i, ""));
  const mailto = links.filter((l) => /^mailto:/i.test(l.href)).map((l) => l.href.replace(/^mailto:/i, "").split("?")[0].toLowerCase());

  const internal = new Set<string>();
  const bookingLinks = new Set<string>();
  const platforms = new Set<string>();
  let contactPage: string | null = null;
  for (const l of links) {
    if (/^(mailto|tel|javascript|#)/i.test(l.href) || !l.href) continue;
    const u = abs(l.href);
    if (!u) continue;
    const host = new URL(u).hostname;
    for (const [re, name] of BOOKING_PLATFORMS) if (re.test(u)) { platforms.add(name); bookingLinks.add(u); }
    if (BOOKING_WORDS.test(l.text)) bookingLinks.add(u);
    if (host === base.hostname) {
      internal.add(u.split("#")[0]);
      if (!contactPage && /contact|kontakt|contacto|contatti|nous-contacter/i.test(u + " " + l.text)) contactPage = u;
    }
  }
  $("iframe[src], script[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    for (const [re, name] of BOOKING_PLATFORMS) if (re.test(src)) platforms.add(name);
  });

  const ctaTexts = [
    ...$("a, button, input[type=submit]").toArray().map((el) => ($(el).text() || $(el).attr("value") || "").replace(/\s+/g, " ").trim()),
  ].filter((t) => t.length > 0 && t.length < 60 && CTA_WORDS.test(t));

  const styleText = $("style").text();
  const viewport = $('meta[name="viewport"]').attr("content") ?? null;
  const imgs = $("img").toArray();
  const missingAlt = imgs.filter((i) => $(i).attr("alt") === undefined).length;
  const deprecated = DEPRECATED.filter((t) => $(t).length > 0);
  const tableLayout = $("table").filter((_, t) => $(t).find("table").length > 0 || $(t).attr("width") !== undefined).length;
  const jq = html.match(/jquery[-.]?(\d+\.\d+(\.\d+)?)(\.min)?\.js/i);

  // Visible text only (scripts/styles removed). Used for the AI excerpt and fact extraction.
  $("script, style, noscript, svg").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const years = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((m) => Number(m[1])).filter((y) => y > 1990 && y < 2100);
  const textEmails = [...new Set((text.match(EMAIL_IN_TEXT) ?? []).map((e) => e.toLowerCase()))].filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e));

  return {
    title: $("title").first().text().trim() || null,
    metaDescription: $('meta[name="description"]').attr("content")?.trim() || null,
    lang: $("html").attr("lang") ?? null,
    viewportMeta: viewport,
    hasResponsiveViewport: Boolean(viewport && /width\s*=\s*device-width/i.test(viewport)),
    mediaQueryCount: (styleText.match(/@media/gi) ?? []).length,
    h1Count: cheerio.load(html)("h1").length,
    imageCount: imgs.length,
    imagesMissingAlt: missingAlt,
    linkCount: links.length,
    internalLinks: [...internal].slice(0, 50),
    formCount: cheerio.load(html)("form").length,
    inputCount: cheerio.load(html)("input, textarea, select").length,
    telLinks: [...new Set(tel)].slice(0, 5),
    mailtoLinks: [...new Set(mailto)].slice(0, 5),
    publishedEmails: [...new Set([...mailto, ...textEmails])].slice(0, 10),
    contactPageUrl: contactPage,
    bookingLinks: [...bookingLinks].slice(0, 10),
    bookingPlatforms: [...platforms],
    ctaCount: ctaTexts.length,
    ctaTexts: [...new Set(ctaTexts)].slice(0, 10),
    generator: cheerio.load(html)('meta[name="generator"]').attr("content") ?? null,
    deprecatedTags: deprecated,
    tableLayoutSignals: tableLayout,
    usesFlashOrApplets: /\.swf\b|<applet|application\/x-shockwave-flash/i.test(html),
    jqueryVersion: jq ? jq[1] : null,
    mixedContentCount: base.protocol === "https:" ? (html.match(/(src|href)=["']http:\/\//gi) ?? []).length : 0,
    structuredData: /application\/ld\+json/i.test(html),
    openGraph: /property=["']og:/i.test(html),
    canonical: cheerio.load(html)('link[rel="canonical"]').attr("href") ?? null,
    latestYearMentioned: years.length ? Math.max(...years) : null,
    scriptCount: cheerio.load(html)("script[src]").length,
    stylesheetCount: cheerio.load(html)('link[rel="stylesheet"]').length,
    wordCount: text ? text.split(" ").length : 0,
    textExcerpt: text.slice(0, 4000),
  };
}

/** Minimal robots.txt check for our user agent and "*". */
export function robotsDisallowsRoot(robotsTxt: string, ua = "WebOpportunityAI"): boolean {
  const groups: { agents: string[]; rules: string[] }[] = [];
  let current: { agents: string[]; rules: string[] } | null = null;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "user-agent") {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(m[2].toLowerCase());
    } else if (current) {
      current.rules.push(`${key}:${m[2]}`);
    }
  }
  const pick = groups.find((g) => g.agents.some((a) => a !== "*" && ua.toLowerCase().includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  if (!pick) return false;
  const disallowRoot = pick.rules.some((r) => r === "disallow:/");
  const allowRoot = pick.rules.some((r) => r === "allow:/");
  return disallowRoot && !allowRoot;
}
