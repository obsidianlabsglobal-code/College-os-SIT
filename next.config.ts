import type { NextConfig } from "next";
const config: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "4400kb" } },
  agentRules: false,
  poweredByHeader: false,
};
export default config;
