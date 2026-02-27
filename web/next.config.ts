import type { NextConfig } from "next";

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

export default nextConfig;
