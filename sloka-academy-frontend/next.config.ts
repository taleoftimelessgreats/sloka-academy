import type { NextConfig } from "next";

// Local development only. On Vercel the website, the staff dashboard (public/admin) and the API share
// one domain (vercel.json). `next dev` mirrors that: /api goes to the API server (sloka-academy-backend,
// `npm run dev`) and /admin/ serves the dashboard page.
const devApiTarget =
  process.env.NODE_ENV === "development" ? (process.env.API_DEV_TARGET || "http://localhost:4000").replace(/\/$/, "") : null;

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
  ...(devApiTarget && {
    async rewrites() {
      return [
        { source: "/admin/", destination: "/admin/index.html" },
        { source: "/api/:path*", destination: `${devApiTarget}/api/:path*` },
      ];
    },
  }),
};

export default nextConfig;
