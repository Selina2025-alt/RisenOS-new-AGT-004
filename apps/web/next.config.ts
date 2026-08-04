import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@risen/content-contracts"],
  output: "standalone",
};

export default nextConfig;
