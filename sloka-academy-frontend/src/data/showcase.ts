import type { StreamId } from "./streams";

/**
 * Proof sections on the home page: student reviews, certification and brochures.
 *
 * Content rules (from the homepage blueprint):
 * - Publish only real, verifiable content supplied by Sloka Academy. Each
 *   section is hidden on the live site while its list is empty, and shows a
 *   "to be confirmed" placeholder in `npm run dev`.
 * - Reviews need written permission on file before they are added
 *   (`permissionOnFile: true` is a deliberate, required confirmation).
 * - The one exception is STUDENT_TESTIMONIALS: illustrative quotes that the site
 *   always labels as samples, kept apart from the genuine REVIEWS.
 * - No stock images: photos must be Sloka Academy's own.
 * - Images live under /public (e.g. /certificates/), brochures under /public/brochures/.
 *   Run `npm run validate:data` after edits.
 *
 * Keep this file free of runtime imports: scripts/validate-data.mjs loads it directly in Node.
 */

/** A genuine review a student published. Shown with its source and rating; never edited. */
export interface Review {
  /** Name as shown on the original review. */
  name: string;
  /** The review exactly as published. No edits, no excerpts that change the meaning. */
  quote: string;
  source: "Google" | "LinkedIn";
  /** Star rating given, when the source has one. */
  rating?: 1 | 2 | 3 | 4 | 5;
  /** Month it was published, YYYY-MM. */
  published: string;
  /** Only when the reviewer stated them. Domain id from src/data/domains.ts. */
  college?: string;
  domain?: string;
  /** Link to the original review, when there is one. */
  url?: string;
  /** Written permission to republish this review is on file. */
  permissionOnFile: true;
}

// Supplied by Sloka Academy from its Google Business Profile for the website (October 2026).
export const REVIEWS: Review[] = [
  {
    name: "Naveen Chowhan",
    quote:
      "⭐ Sloka Academy is a good platform for students to improve their skills, gain practical knowledge, and develop their careers. A good learning experience for students!",
    source: "Google",
    rating: 5,
    published: "2026-10",
    permissionOnFile: true,
  },
  {
    name: "Minnu Minnu",
    quote: "Good place to learn new skills and improve confidence.",
    source: "Google",
    rating: 5,
    published: "2026-10",
    permissionOnFile: true,
  },
];


export interface StudentTestimonial {
  name: string;
  /** Domain id from src/data/domains.ts. */
  domain: string;
  /** Minimal profile detail, e.g. "B.Tech ECE, 3rd year". No real college names. */
  detail: string;
  quote: string;
}

export const SHOW_STUDENT_TESTIMONIALS = true;

export const STUDENT_TESTIMONIALS: StudentTestimonial[] = [
  {
    name: "Sneha R.",
    domain: "data-analytics",
    detail: "B.Com, 3rd year",
    quote: "I came in knowing only basic Excel. By week five I was cleaning real datasets in Python and building dashboards I could explain properly.",
  },
  {
    name: "Karthik M.",
    domain: "vlsi",
    detail: "B.Tech ECE, 4th year",
    quote: "The Verilog sessions were well paced, and the guided tasks made me debug my own testbenches instead of copying answers. That is what made it stick.",
  },
  {
    name: "Ayesha F.",
    domain: "medical-coding",
    detail: "B.Pharm, final year",
    quote: "Clear explanations of ICD-10 coding with plenty of practice charts. Asking doubts was easy, and every exercise I submitted came back reviewed.",
  },
  {
    name: "Rohit K.",
    domain: "full-stack",
    detail: "B.Sc Computer Science",
    quote: "Building one project from start to finish taught me more than a semester of theory. The code reviews were honest and genuinely useful.",
  },
  {
    name: "Divya S.",
    domain: "ai-ml",
    detail: "B.Tech CSE, 3rd year",
    quote: "I finally understand what my models are doing instead of just running notebooks. The project weeks were challenging in a good way.",
  },
  {
    name: "Manoj T.",
    domain: "cyber-security",
    detail: "BCA, 2nd year",
    quote: "Hands-on labs every week kept me engaged, and I finished with a few lab write-ups I am happy to show.",
  },
  {
    name: "Lakshmi P.",
    domain: "bioinformatics",
    detail: "M.Sc Biotechnology",
    quote: "A good balance of biology and programming. I started with zero coding, and the step-by-step sessions made it manageable.",
  },
  {
    name: "Arjun V.",
    domain: "digital-marketing",
    detail: "BBA, final year",
    quote: "Practical from the first week: live campaign exercises, analytics, and feedback on every task. Online classes fitted around college.",
  },
];

/** A sample student certificate, issued to a sample name. */
export const SAMPLE_CERTIFICATE: { src: string; width: number; height: number; alt: string } | null = {
  src: "/certificates/sample-internship-certificate.webp",
  width: 2000,
  height: 1414,
  alt: "Sample Sloka Academy internship certificate, marked SAMPLE CERTIFICATE, issued to Aadhya Sharma for Artificial Intelligence & Machine Learning from 18 March 2026 to 15 May 2026, signed by the Director and an Authorized Signatory, with the Sloka Academy seal.",
};

export interface Recognition {
  name: string;
  issuer: string;
  /** e.g. registration number or validity. */
  detail?: string;
}

/** Recognitions, registrations or partnerships Sloka Academy genuinely holds (document available on request). */
export const RECOGNITIONS: Recognition[] = [];

/** The brochure for the whole program, offered after the short enquiry form. Path under /public/brochures/. */
export const PROGRAM_BROCHURE: { file: string; title: string; pages: number; sizeMb: number; contents: string[] } | null = {
  file: "/brochures/sloka-academy-2-month-internship-program.pdf",
  title: "2-Month Internship Program",
  pages: 10,
  sizeMb: 4.3,
  contents: [
    "About Sloka Academy",
    "The 8-week program roadmap",
    "Every domain, grouped by field",
    "Why students choose Sloka Academy",
    "Career paths the domains lead to",
    "Branches, phone and email",
  ],
};

/** Optional brochure per stream, with syllabus. Path under /public/brochures/. Plan brochures are set in plans.ts. */
export const STREAM_BROCHURES: { stream: StreamId; file: string }[] = [];
