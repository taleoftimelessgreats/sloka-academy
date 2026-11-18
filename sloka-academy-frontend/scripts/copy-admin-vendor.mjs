// Runs before `next build` and `next dev` (npm "prebuild" / "predev").
// The admin portal converts Word (.docx) and PowerPoint (.pptx) templates to PDF in the browser
// (public/admin/convert/). The libraries it uses are served as plain files from public/admin/vendor/, copied from
// node_modules so they always match the installed versions. Not in git.
import fs from "node:fs";
import path from "node:path";

// [package, file in the package, name served]
const FILES = [
  ["jszip", "dist/jszip.min.js", "jszip.min.js"], // reads .docx (docx-preview expects the global JSZip)
  ["docx-preview", "dist/docx-preview.min.js", "docx-preview.min.js"], // renders Word documents as HTML
  ["pptxtojson", "dist/index.js", "pptxtojson.js"], // reads PowerPoint slides (ES module, self-contained)
  ["html2canvas", "dist/html2canvas.min.js", "html2canvas.min.js"], // draws a rendered page as an image
  ["pdf-lib", "dist/pdf-lib.min.js", "pdf-lib.min.js"], // writes the PDF
];

const dest = path.resolve("public/admin/vendor");
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
const versions = [];
for (const [pkg, file, name] of FILES) {
  const dir = path.resolve("node_modules", pkg);
  fs.copyFileSync(path.join(dir, file), path.join(dest, name));
  versions.push(`${pkg} ${JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version}`);
}
console.log(`admin converter libraries copied to public/admin/vendor/: ${versions.join(", ")}`);
