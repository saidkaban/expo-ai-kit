import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repository also has a package-lock.json at its root. Keep Turbopack
  // scoped to this standalone docs app when it is built from docs/.
  turbopack: {
    root: process.cwd(),
  },
  async redirects() {
    return [
      // The LLM guide was briefly published as /guides/text-generation.
      { source: "/guides/text-generation", destination: "/guides/llm", permanent: true },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.shields.io" },
      { protocol: "https", hostname: "github.com" },
    ],
  },
};

export default nextConfig;
