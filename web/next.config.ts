import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Treat certain Node-only packages as external to avoid bundling issues
  // (e.g. pdf-parse / pdfjs-dist worker resolution).
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
