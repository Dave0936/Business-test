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

const nextConfig: NextConfig = {
  cacheComponents: false,
  poweredByHeader: false,
  serverExternalPackages: ["playwright", "undici"],
  // GeoNames town data is read from disk by these routes.
  outputFileTracingIncludes: {
    // Self-hosted fonts are read from disk whenever a prototype version is saved.
    "/**": ["./data/fonts/**/*"],
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
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
