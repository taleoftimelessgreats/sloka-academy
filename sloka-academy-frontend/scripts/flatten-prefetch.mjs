// Runs after `next build` (npm "postbuild").
// Next writes each page's prefetch data in nested folders, e.g. out/domains/__next.domains/__PAGE__.txt,
// but the browser requests it by a flattened name: /domains/__next.domains.__PAGE__.txt.
// Vercel's Next.js preset maps one to the other; vercel.json deploys out/ as plain static files (so the
// /api function can sit beside the site), so a copy is written under the flattened name as well.
// Without it every prefetch is a 404 and in-site navigation falls back to full page loads.
import fs from "node:fs";
import path from "node:path";

const out = path.resolve("out");
let copied = 0;

function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesIn(full) : [full];
  });
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (!entry.name.startsWith("__next.")) {
      walk(full);
      continue;
    }
    // out/domains/__next.domains/$d$id/__PAGE__.txt -> out/domains/__next.domains.$d$id.__PAGE__.txt
    for (const file of filesIn(full)) {
      const flat = path.relative(dir, file).split(path.sep).join(".");
      fs.copyFileSync(file, path.join(dir, flat));
      copied++;
    }
  }
}

if (!fs.existsSync(out)) {
  console.error("flatten-prefetch: out/ not found; run next build first");
  process.exit(1);
}
walk(out);
console.log(`flatten-prefetch: wrote ${copied} prefetch file(s) under their requested names`);
