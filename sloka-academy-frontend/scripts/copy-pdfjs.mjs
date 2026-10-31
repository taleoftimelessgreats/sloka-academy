// Runs before `next build` and `next dev` (npm "prebuild" / "predev").
// The certificate previews draw the PDF with pdf.js (its legacy build, for older phone browsers). Its worker
// and the standard fonts the certificates use (Helvetica, Times, Courier: not embedded in the PDF) are served
// as plain files from public/pdfjs/<version>/, so they always match the installed pdfjs-dist. Not in git.
import fs from "node:fs";
import path from "node:path";

const pkg = path.resolve("node_modules/pdfjs-dist");
const { version } = JSON.parse(fs.readFileSync(path.join(pkg, "package.json"), "utf8"));
const root = path.resolve("public/pdfjs");
const dest = path.join(root, version);

if (!fs.existsSync(path.join(dest, "pdf.worker.min.js"))) {
  fs.rmSync(root, { recursive: true, force: true }); // drop other versions
  fs.mkdirSync(dest, { recursive: true });
  // Saved as .js so every server sends it as JavaScript (some send .mjs as a download, which a worker refuses).
  fs.copyFileSync(path.join(pkg, "legacy/build/pdf.worker.min.mjs"), path.join(dest, "pdf.worker.min.js"));
  fs.cpSync(path.join(pkg, "standard_fonts"), path.join(dest, "standard_fonts"), { recursive: true });
  console.log(`pdf.js ${version}: worker and standard fonts copied to public/pdfjs/${version}/`);
}
