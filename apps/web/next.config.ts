import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/*는 빌드 없이 TS 소스를 그대로 내보내므로 Next.js가 직접 컴파일한다.
  transpilePackages: [
    "@office/command-core",
    "@office/ui",
    "@office/excel",
    "@office/docs",
    "@office/ppt",
  ],
};

export default nextConfig;
