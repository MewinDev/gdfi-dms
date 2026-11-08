import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page depends on the signed-in user (session cookie), so pages render dynamically.
  // Cache Components is left off on purpose.
  poweredByHeader: false,
  // The Playwright server runs beside the person's own `next dev` (other database, other port), so it
  // needs its own build folder: Next.js allows one dev server per folder (.next/dev/lock).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Import (Settings / Users) sends a CSV of up to 2 MB to a Server Action; leave room for form overhead.
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
};

export default nextConfig;
