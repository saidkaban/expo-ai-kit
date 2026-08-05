import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repository also has a package-lock.json at its root. Keep Turbopack
  // scoped to this standalone docs app when it is built from docs/.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
