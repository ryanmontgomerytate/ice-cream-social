import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const sentryEnvironment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV;
const sentryRelease = process.env.SENTRY_RELEASE;
const sentryUploadEnabled =
  process.env.SENTRY_UPLOAD_ENABLED === "true" ||
  (process.env.CI === "true" &&
    Boolean(process.env.SENTRY_AUTH_TOKEN) &&
    Boolean(process.env.SENTRY_ORG) &&
    Boolean(process.env.SENTRY_PROJECT));

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
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    disable: !sentryUploadEnabled,
  },
  release: {
    name: sentryRelease,
    create: sentryUploadEnabled,
    finalize: sentryUploadEnabled,
    setCommits: sentryUploadEnabled
      ? {
          auto: true,
          ignoreMissing: true,
          ignoreEmpty: true,
        }
      : undefined,
    deploy:
      sentryUploadEnabled && sentryEnvironment
        ? {
            env: sentryEnvironment,
          }
        : undefined,
  },
  errorHandler(error) {
    console.warn(`[sentry] release/sourcemap warning: ${error.message}`);
  },
});
