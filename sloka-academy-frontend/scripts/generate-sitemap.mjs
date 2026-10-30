// Writes public/sitemap.xml from the static domain data. Runs before each build.
import { writeFileSync } from "node:fs";
import { VISIBLE_DOMAINS } from "../src/data/domains.ts";

const SITE_URL = "https://www.slokaacademy.com"; // keep in sync with src/config/site.ts
const pages = ["", "domains/", "internship-course-program/", "pre-register/", "certificate/", "verify/", "about/", "contact/", "privacy/", "terms/", "refund-policy/"];
const urls = [...pages, ...VISIBLE_DOMAINS.map((d) => `domains/${d.id}/`)];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE_URL}/${u}</loc></url>`).join("\n")}
</urlset>
`;
writeFileSync(new URL("../public/sitemap.xml", import.meta.url), xml);
console.log(`✓ sitemap.xml: ${urls.length} URLs`);
