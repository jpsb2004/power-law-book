import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Quotes are re-fetched per request and cached for seconds, not minutes.
  // See lib/quotes.ts.
  cacheComponents: true,
};

export default nextConfig;
