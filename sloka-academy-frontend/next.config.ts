import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: `next build` writes a plain HTML/CSS/JS site to `out/`.
  // Cache Components / Partial Prefetching need a Node server, so they are off for static export.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactCompiler: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
