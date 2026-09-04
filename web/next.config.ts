import type { NextConfig } from "next";

// script-src/style-src need 'unsafe-inline': the root layout's theme-init
// script (see app/layout.tsx - runs beforeInteractive to avoid a flash of
// the wrong theme) and Next's own hydration/RSC-payload scripts are both
// inline, and this app doesn't thread a nonce through proxy.ts to allow
// removing that - a known, deliberate trade-off, not an oversight. Every
// other directive here still meaningfully narrows the attack surface
// (no arbitrary third-party script/object loading, no framing, no
// cross-origin fetches, no foreign <base>/form targets). Only applied in
// production - not worth risking friction with next dev's own HMR/tooling.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  // Turns off the floating "N" dev-tools button shown in `next dev` - a
  // local convenience only, has no effect on production builds.
  devIndicators: false,
  experimental: {
    // Enables the forbidden() function/forbidden.tsx boundary - used to show
    // a proper 403 page to customer-scoped users who land on a tenant-wide
    // route (e.g. /customers) instead of crashing with an unhandled error.
    authInterrupts: true,
  },
  async headers() {
    if (process.env.NODE_ENV !== "production") {
      return [];
    }
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
