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
    // Next's Server Action body limit defaults to 1mb - the platform-admin
    // agent release publish form (publishAgentReleaseAction) uploads the
    // agent binary and Windows installer directly as FormData, both
    // routinely well over 1mb (confirmed failing with a generic "A server
    // error occurred" against a real ~12mb binary). Raised with headroom
    // for the binary to grow (embedded version info, larger installers).
    serverActions: { bodySizeLimit: "50mb" },
    // Separate limit, also hit by the same upload (confirmed via production
    // logs: "Request body exceeded 10MB ... Unexpected end of form") - every
    // request body is also cloned/re-read once by proxy.ts (this app's
    // middleware, renamed in Next 16), capped independently at 10mb by
    // default regardless of serverActions.bodySizeLimit above.
    proxyClientMaxBodySize: "50mb",
  },
  async headers() {
    if (process.env.NODE_ENV !== "production") {
      return [];
    }
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
