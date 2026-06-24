import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Next 16 构建默认不运行 ESLint，无需额外配置 */
  serverExternalPackages: ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai"],
};

export default nextConfig;
