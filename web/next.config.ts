import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Images from Supabase storage or external podcast CDNs
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // Build remains quiet in CI/dev unless there's an actual integration problem.
  silent: true,
});
