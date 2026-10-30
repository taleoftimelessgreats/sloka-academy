import { formatINR, formsEnabled, site } from "@/config/site";
import { PROGRAM_BROCHURE, STREAM_BROCHURES } from "./showcase";
import { streamLabel, type StreamId } from "./streams";

/** One sentence stating the fee, for FAQ answers, page descriptions and policy text. */
export function feeSentence(): string {
  return `The program fee is ${formatINR(site.fee.current)}, reduced from ${formatINR(site.fee.original)}.`;
}

export interface Brochure {
  file: string;
  title: string;
  stream?: StreamId;
  /** The brochure for the whole program. */
  program?: true;
}

/** The program brochure, then optional stream syllabi. */
export const BROCHURES: Brochure[] = [
  ...(PROGRAM_BROCHURE ? [{ file: PROGRAM_BROCHURE.file, title: PROGRAM_BROCHURE.title, program: true as const }] : []),
  ...STREAM_BROCHURES.map((b) => ({ file: b.file, title: `${streamLabel(b.stream)} syllabus`, stream: b.stream })),
];

/** The eight weeks of the Internship Course Program (brochure). Sequence can vary by domain. */
export const ROADMAP: { weeks: string; title: string; body: string }[] = [
  {
    weeks: "Week 1",
    title: "Orientation",
    body: "You meet your mentor, get set up on the LMS and the tools of your domain, and agree what you want to walk away with.",
  },
  {
    weeks: "Weeks 2–3",
    title: "Foundations",
    body: "The core ideas and tools of the field, taught session by session, with short exercises to check your understanding.",
  },
  {
    weeks: "Weeks 4–5",
    title: "Guided practice",
    body: "Longer assignments that make you apply what you have learned, with feedback on what to fix and why.",
  },
  {
    weeks: "Weeks 6–7",
    title: "Project or internship work",
    body: "You take on a project or internship assignment and see it through, with your mentor reviewing the work as it develops.",
  },
  {
    weeks: "Week 8",
    title: "Review and certification",
    body: "A final review of your work, help shaping it into a portfolio, your certificate, and a conversation about next steps.",
  },
];

export interface Faq {
  q: string;
  a: string;
  link?: { href: string; label: string };
}


/** Shown on the home page and program page. */
export const FAQS: Faq[] = [
  {
    q: "Who is the Internship Course Program for?",
    a: "Students in their final years, recent graduates and early-career professionals who want hands-on experience in a specific field. You do not need to be from a computer science background; we have domains for engineering, pharmacy, life sciences, management and commerce students too.",
  },
  {
    q: "What does the program cost?",
    a: `${feeSentence()} It is the same for every domain and covers the full two months. Admissions will take you through the payment schedule before you register.`,
  },
  {
    q: "How do I choose the right domain?",
    a: "Start with the Domains page and filter by your stream. If two or three look right, call us. We will look at your background and tell you honestly which one suits you, including any prerequisites.",
  },
  {
    q: "Is the internship paid? Is a job guaranteed?",
    a: "No to both. The program includes a short-term internship opportunity so you can apply your skills in a working context, but we do not promise paid internships, jobs or placements. What we do promise is structured teaching and real work to show for it.",
  },
  {
    q: "Do I get a certificate?",
    a: "Yes. You receive a certificate once you meet the completion requirements for your domain, which we share with you at the start of the program.",
  },
  BROCHURES.length
    ? {
        q: "Can I get a brochure?",
        a: `Yes. Download a brochure from the Brochures section on the home page.${
          formsEnabled ? " We ask for your name and number first so admissions can answer any questions it raises." : ""
        }`,
        link: { href: "/#brochures", label: "Go to brochures" },
      }
    : {
        q: "Can I get a brochure?",
        a: "Yes. Call or email admissions and we will send you the brochure for the domain you are interested in.",
      },
  {
    q: "Where do classes and materials live?",
    a: "On the Sloka Academy LMS, hosted on Teachmint. Use the LMS link at the top of any page. Your login details are shared when you enrol.",
  },
];
