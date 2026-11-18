import type { NextConfig } from "next";

// Every screen is per-user and per-organisation, so pages render dynamically.
// Cache Components is off; data is always read fresh under row-level security.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

// Content Security Policy for the app's own pages. Next.js needs inline scripts for hydration
// (no nonces with dynamic rendering here), so scripts are limited to this origin plus inline.
// Images can come from design-reference sites over https. Previews of generated sites are
// served with their own, stricter policy and are excluded below.
const appCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  cacheComponents: false,
  poweredByHeader: false,
  serverExternalPackages: ["playwright", "playwright-core", "@sparticuz/chromium", "undici", "sharp"],
  // GeoNames town data is read from disk by these routes.
  outputFileTracingIncludes: {
    // Self-hosted fonts are read from disk whenever a prototype version is saved.
    // The builder screenshots its drafts with a serverless Chromium (compressed browser files).
    "/**": ["./data/fonts/**/*", "./data/vendor/**/*", "./node_modules/@sparticuz/chromium/bin/**"],
    "/api/places/**": ["./data/geonames/**"],
    "/opportunities": ["./data/geonames/**"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "3mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Everything except the sandboxed site previews, which set their own policy.
      { source: "/((?!api/preview/).*)", headers: [{ key: "Content-Security-Policy", value: appCsp }] },
    ];
  },
};

export default nextConfig;
