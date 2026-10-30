// Content completeness check for the static domain catalogue.
// Run with: npm run validate:data  (Node 22.18+ strips TypeScript types natively)

import { existsSync } from "node:fs";
import { DOMAINS, CATEGORIES } from "../src/data/domains.ts";
import {
  PROGRAM_BROCHURE,
  REVIEWS,
  SAMPLE_CERTIFICATE,
  STUDENT_TESTIMONIALS,
  STREAM_BROCHURES,
} from "../src/data/showcase.ts";
import { STREAMS } from "../src/data/streams.ts";

// Initial product taxonomy from the website brief (stream button -> domain names).
const SPEC = {
  "computer-science": [".NET", "Agentic AI", "AI/ML", "AWS", "Blockchain", "Business Analytics", "Cyber Security", "Data Analytics", "Data Engineering", "Data Science", "Data Structures", "DevOps", "Full Stack", "Generative AI & LLM", "Internet of Things (IoT)", "Java Programming", "Java Full Stack", "Python Full Stack Development", "Python Programming", "Quantum Computing", "Robotics", "Salesforce", "SAP", "Selenium Testing with Java", "ServiceNow", "UI/UX Design"],
  management: ["Business Analytics", "Data Analytics", "Digital Marketing", "Entrepreneurship", "Finance", "HR", "Investment Banking", "Salesforce", "SAP", "Supply Chain Management"],
  pharmacy: ["Clinical SAS", "Medical Coding", "Pharmacovigilance"],
  "life-sciences": ["Bioinformatics", "Clinical SAS", "Genetic Engineering", "Medical Coding", "Nano Science & Nanotechnology", "Pharmacovigilance"],
  civil: ["AutoCAD"],
  mechanical: ["AutoCAD", "Hybrid Electric Vehicles", "Internet of Things (IoT)", "Nano Science & Nanotechnology", "Robotics", "Supply Chain Management"],
  electronics: ["Embedded Systems", "Hybrid Electric Vehicles", "Internet of Things (IoT)", "Nano Science & Nanotechnology", "Quantum Computing", "Robotics", "VLSI"],
  eee: ["AutoCAD", "Embedded Systems", "Hybrid Electric Vehicles", "Internet of Things (IoT)", "Robotics", "VLSI"],
  commerce: ["Business Analytics", "Data Analytics", "Digital Marketing", "Entrepreneurship", "Finance", "HR", "Investment Banking", "Salesforce", "SAP", "Supply Chain Management"],
  more: ["Bioinformatics", "Blockchain", "Entrepreneurship", "Genetic Engineering", "Nano Science & Nanotechnology", "Quantum Computing", "Robotics"],
};

const errors = [];
const fail = (msg) => errors.push(msg);

if (DOMAINS.length !== 42) fail(`Expected 42 domain records, found ${DOMAINS.length}.`);

const ids = new Set();
const names = new Set();
for (const d of DOMAINS) {
  if (ids.has(d.id)) fail(`Duplicate id: ${d.id}`);
  if (names.has(d.name)) fail(`Duplicate name: ${d.name}`);
  ids.add(d.id);
  names.add(d.name);
  if (!CATEGORIES.includes(d.category)) fail(`${d.name}: unknown category "${d.category}"`);
  if (d.visible && d.streams.length === 0) fail(`${d.name}: visible domain has no stream tag`);
  if (new Set(d.streams).size !== d.streams.length) fail(`${d.name}: duplicate stream tags`);
  for (const s of d.streams) {
    if (!STREAMS.some((x) => x.id === s)) fail(`${d.name}: unknown stream "${s}"`);
  }
  if (/…|\.\.\.$/.test(d.name)) fail(`${d.name}: truncated display name`);
  if (!d.summary || d.focusAreas.length === 0) fail(`${d.name}: missing summary or focus areas`);
  if (d.brochure && !d.brochure.startsWith("/brochures/")) fail(`${d.name}: brochure must live in /public/brochures`);
}

for (const stream of STREAMS) {
  const expected = new Set(SPEC[stream.id] ?? []);
  const actual = new Set(DOMAINS.filter((d) => d.visible && d.streams.includes(stream.id)).map((d) => d.name));
  for (const n of expected) if (!actual.has(n)) fail(`${stream.label}: missing ${n}`);
  for (const n of actual) if (!expected.has(n)) fail(`${stream.label}: unexpected ${n} (update SPEC if intentional)`);
  for (const n of expected) if (!names.has(n)) fail(`${stream.label}: spec names unknown domain ${n}`);
}

// Acceptance examples from the brief.
const byStream = (s) => DOMAINS.filter((d) => d.streams.includes(s)).map((d) => d.name).sort();
const pharmacy = byStream("pharmacy").join(", ");
if (pharmacy !== "Clinical SAS, Medical Coding, Pharmacovigilance") fail(`Pharmacy example mismatch: ${pharmacy}`);
if (byStream("pharmacy").includes("VLSI")) fail("VLSI must not appear under Pharmacy");
if (!byStream("electronics").includes("VLSI")) fail("VLSI must appear under Electronics");

// Home page proof sections (src/data/showcase.ts).
const inPublic = (path) => path.startsWith("/") && existsSync(new URL(`../public${path}`, import.meta.url));
const checkFile = (label, path) => !inPublic(path) && fail(`${label}: file not found at public${path}`);
const checkBrochure = (label, path) => {
  if (!path.startsWith("/brochures/")) fail(`${label}: brochure must live in /public/brochures`);
  checkFile(label, path);
};
const domainIds = new Set(DOMAINS.map((d) => d.id));

for (const r of REVIEWS) {
  if (r.permissionOnFile !== true) fail(`${r.name}: review needs written permission on file`);
  if (!r.name || !r.quote) fail(`${r.name || "Review"}: review needs the reviewer's name and the quote`);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.published)) fail(`${r.name}: published must be YYYY-MM`);
  if (r.domain !== undefined && !domainIds.has(r.domain)) fail(`${r.name}: unknown domain id "${r.domain}"`);
  if (r.url !== undefined && !/^https:\/\//.test(r.url)) fail(`${r.name}: the link to the original must be https`);
}
for (const t of STUDENT_TESTIMONIALS) {
  if (!domainIds.has(t.domain)) fail(`Student testimonial ${t.name}: unknown domain id "${t.domain}"`);
  if (!t.name || !t.detail || !t.quote) fail(`S testimonial ${t.name || "?"}: needs a name, detail and quote`);
  if (t.quote.length > 170) fail(`S testimonial ${t.name}: keep the quote to 170 characters so the cards line up`);
  if (REVIEWS.some((r) => r.name === t.name)) fail(`S testimonial ${t.name}: must not reuse a genuine reviewer's name`);
}
if (PROGRAM_BROCHURE) checkBrochure("Program brochure", PROGRAM_BROCHURE.file);
if (SAMPLE_CERTIFICATE) checkFile("Sample certificate", SAMPLE_CERTIFICATE.src);
for (const b of STREAM_BROCHURES) {
  if (!STREAMS.some((s) => s.id === b.stream)) fail(`Stream brochure: unknown stream "${b.stream}"`);
  checkBrochure(`${b.stream} brochure`, b.file);
}

if (errors.length) {
  console.error(`✗ Data check failed (${errors.length}):\n  - ${errors.join("\n  - ")}`);
  process.exit(1);
}
console.log(`✓ ${DOMAINS.length} domains, ${STREAMS.length} streams, mappings match the brief. Showcase data OK.`);
