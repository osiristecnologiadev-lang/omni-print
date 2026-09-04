import type { NextConfig } from "next";

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
};

export default nextConfig;
