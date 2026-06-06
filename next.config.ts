import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 部署时不让 ESLint 阻塞构建（vendored AI Elements / 输入框组件含 @ts-nocheck 等）；
  // TypeScript 类型检查仍然保留。
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
