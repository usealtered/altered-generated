import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@altered/api-contract"],
  typedRoutes: true,
};

export default nextConfig;
