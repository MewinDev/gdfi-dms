import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page depends on the signed-in user (session cookie), so pages render dynamically.
  // Cache Components is left off on purpose.
  poweredByHeader: false,
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
