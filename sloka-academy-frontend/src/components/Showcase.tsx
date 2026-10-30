import Image from "next/image";
import type { ReactNode } from "react";
import { formsEnabled } from "@/config/site";
import { getDomain } from "@/data/domains";
import { BROCHURES } from "@/data/program";
import {
  PROGRAM_BROCHURE,
  RECOGNITIONS,
  REVIEWS,
  SAMPLE_CERTIFICATE,
  STUDENT_TESTIMONIALS,
  SHOW_STUDENT_TESTIMONIALS,
} from "@/data/showcase";
import { BrochureDownload, BrochureRequest } from "./BrochureDownload";
import { Icon } from "./Icon";
import { Pending, devPreview } from "./Pending";
import { ReviewMarquee, type ReviewCard } from "./ReviewMarquee";
import { Em, SectionIntro } from "./ui";

const domainName = (id: string) => getDomain(id)?.name ?? id;

/**
 * Shared frame for the proof sections. Returns nothing in the built site while
 * the section has no content; in development it shows what is still needed.
 */
function ShowcaseSection({
  id,
  hasContent,
  intro,
  needs,
  file = "src/data/showcase.ts",
  className = "",
  children,
  bleed,
}: {
  id?: string;
  hasContent: boolean;
  intro: ReactNode;
  needs: string[];
  file?: string;
  className?: string;
  children?: ReactNode;
  /** Full-width content under the section (e.g. a marquee), outside the page margins. */
  bleed?: ReactNode;
}) {
  if (!hasContent && !devPreview) return null;
  return (
    <section id={id} className={`section relative overflow-hidden border-t border-line ${className}`}>
      <div className="wrap relative">
        {intro}
        {!hasContent ? (
          <div className="mt-14">
            <Pending file={file} needs={needs} />
          </div>
        ) : (
          children && <div className="mt-14">{children}</div>
        )}
      </div>
      {hasContent && bleed && <div className="relative mt-12">{bleed}</div>}
    </section>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** Two rows: each starts with a genuine review, then the samples split between them. */
function reviewRows(): ReviewCard[][] {
  const genuine: ReviewCard[] = REVIEWS.map((r, i) => ({
    kind: "review",
    key: `review-${i}`,
    name: r.name,
    quote: r.quote,
    source: r.source,
    rating: r.rating,
    published: monthYear(r.published),
  }));
  const samples: ReviewCard[] = (SHOW_STUDENT_TESTIMONIALS ? STUDENT_TESTIMONIALS : []).map((t, i) => ({
    kind: "sample",
    key: `sample-${i}`,
    name: t.name,
    quote: t.quote,
    domain: domainName(t.domain),
    detail: t.detail,
  }));
  const rows: ReviewCard[][] = [[], []];
  genuine.forEach((c, i) => rows[i % 2].push(c));
  samples.forEach((c, i) => rows[i % 2].push(c));
  return rows.filter((r) => r.length > 0);
}

export function StudentReviews() {
  const withSamples = SHOW_STUDENT_TESTIMONIALS && STUDENT_TESTIMONIALS.length > 0;
  const rows = reviewRows();
  return (
    <ShowcaseSection
      hasContent={REVIEWS.length > 0 || withSamples}
      intro={
        <SectionIntro kicker="Student reviews" title={<>In their <Em>own words.</Em></>}>
          {withSamples
            ? "Reviews our students have posted on Google, alongside student testimonials that show the kind of experience the program aims for. Samples are written by Sloka Academy, are always marked, and are not reviews from real students."
            : "Reviews our students have posted on Google."}
        </SectionIntro>
      }
      needs={[
        "Per review: the reviewer's name, the quote exactly as published, the source and month, and written permission",
        "Optional: student testimonials, always shown marked as samples",
      ]}
      bleed={<ReviewMarquee rows={rows} />}
    />
  );
}

const CERTIFICATE_SHOWS: [string, string][] = [
  ["Your name", "Printed as you want it to appear."],
  ["Your domain", "The field you completed, such as Artificial Intelligence & Machine Learning."],
  ["Your internship dates", "When you started and when you finished."],
  ["Signatures and seal", "Signed by the Director and an Authorized Signatory, with the Sloka Academy seal."],
];

export function Certifications() {
  const hasContent = Boolean(SAMPLE_CERTIFICATE) || RECOGNITIONS.length > 0;
  return (
    <ShowcaseSection
      className="bg-bg-2"
      hasContent={hasContent}
      intro={
        <SectionIntro kicker="Certification" title={<>The certificate <Em>you earn.</Em></>}>
          Awarded once you meet the completion requirements for your domain.
        </SectionIntro>
      }
      needs={[
        "A sample student certificate image, issued to a sample name",
        "Only recognitions, registrations or partnerships Sloka genuinely holds, with the document available on request",
      ]}
    >
      <div className={`grid items-start gap-10 ${SAMPLE_CERTIFICATE ? "lg:grid-cols-[1.5fr_1fr] lg:gap-14" : ""}`}>
        {SAMPLE_CERTIFICATE && (
          <figure className="reveal">
            <a
              href={SAMPLE_CERTIFICATE.src}
              target="_blank"
              rel="noopener"
              className="glass block overflow-hidden p-2.5 transition-[border-color,box-shadow] duration-300 hover:border-[rgb(255_90_96/0.35)] hover:shadow-[0_24px_60px_-30px_var(--glow)] sm:p-3"
            >
              <Image
                src={SAMPLE_CERTIFICATE.src}
                alt={SAMPLE_CERTIFICATE.alt}
                width={SAMPLE_CERTIFICATE.width}
                height={SAMPLE_CERTIFICATE.height}
                sizes="(min-width: 1280px) 760px, (min-width: 1024px) 58vw, 100vw"
                className="h-auto w-full rounded-xl"
              />
              <span className="sr-only">Open the sample certificate full size</span>
            </a>
            <figcaption className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-muted">
              <span>Sample certificate, issued to a sample name.</span>
              <a href={SAMPLE_CERTIFICATE.src} target="_blank" rel="noopener" className="link-glow">
                View full size
                <Icon name="arrowUpRight" size={15} />
              </a>
            </figcaption>
          </figure>
        )}
        <div className="grid gap-12">
          {SAMPLE_CERTIFICATE && (
            <div>
              <h3 className="h-sub">What your certificate shows</h3>
              <ul className="mt-6 divide-y divide-line border-y border-line">
                {CERTIFICATE_SHOWS.map(([title, body]) => (
                  <li key={title} className="flex gap-4 py-5">
                    <Icon name="check" size={20} strokeWidth={2.2} className="mt-0.5 shrink-0 text-red-hi" />
                    <div>
                      <p className="font-medium">{title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {RECOGNITIONS.length > 0 && (
            <div>
              <h3 className="h-sub">Recognitions and registrations</h3>
              <ul className="mt-6 divide-y divide-line border-y border-line">
                {RECOGNITIONS.map((r) => (
                  <li key={r.name} className="flex gap-4 py-5">
                    <Icon name="shield" size={20} className="mt-0.5 shrink-0 text-red-hi" />
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-sm text-muted">
                        {r.issuer}
                        {r.detail && <> · {r.detail}</>}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-sm text-muted-2">Documents are available on request from admissions.</p>
            </div>
          )}
        </div>
      </div>
    </ShowcaseSection>
  );
}

export function Brochures() {
  const others = BROCHURES.filter((b) => !b.program);
  return (
    <ShowcaseSection
      id="brochures"
      hasContent={BROCHURES.length > 0}
      file="src/data/showcase.ts (program and stream brochures)"
      intro={
        <SectionIntro kicker="Brochure" title={<>Take the details <Em>with you.</Em></>}>
          {formsEnabled
            ? "The full program brochure: the eight-week roadmap, every domain and how to reach us. We ask for your name and number first so admissions can help with any questions."
            : "The full program brochure: the eight-week roadmap, every domain and how to reach us."}
        </SectionIntro>
      }
      needs={["The program brochure PDF", "Optional: one PDF per stream with the syllabus"]}
    >
      {PROGRAM_BROCHURE && (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.2fr] lg:gap-8">
          <div className="reveal glass edge relative overflow-hidden p-8 sm:p-10">
            <div className="glow-orb -right-24 -top-24 h-64 w-64 opacity-50" aria-hidden="true" />
            <Icon name="file" size={30} className="relative text-red-hi" />
            <h3 className="display relative mt-6 text-[clamp(1.6rem,1.3rem+1vw,2.1rem)] leading-tight">{PROGRAM_BROCHURE.title}</h3>
            <p className="relative mt-2 text-sm text-muted">
              PDF · {PROGRAM_BROCHURE.pages} pages · {PROGRAM_BROCHURE.sizeMb} MB
            </p>
            <p className="relative mt-9 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-muted-2">Inside</p>
            <ul className="relative mt-4 grid gap-3">
              {PROGRAM_BROCHURE.contents.map((c) => (
                <li key={c} className="flex gap-3 text-[0.97rem] text-text/90">
                  <Icon name="check" size={18} strokeWidth={2.2} className="mt-0.5 shrink-0 text-red-hi" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="glass p-6 sm:p-9">
            <h3 className="h-sub">{formsEnabled ? "Where can admissions reach you?" : "Download the brochure"}</h3>
            <p className="mb-7 mt-2 text-[0.95rem] leading-relaxed text-muted">
              {formsEnabled
                ? "Fill this in and the download button appears straight away."
                : "No sign-up needed."}
            </p>
            <BrochureRequest file={PROGRAM_BROCHURE.file} title={PROGRAM_BROCHURE.title} />
          </div>
        </div>
      )}
      {others.length > 0 && (
        <ul className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${PROGRAM_BROCHURE ? "mt-10" : ""}`}>
          {others.map((b) => (
            <li key={b.file} className="glass flex flex-col p-7">
              <Icon name="file" size={28} className="text-red-hi" />
              <h3 className="h-sub mt-6">{b.title}</h3>
              <p className="mt-1 text-sm text-muted">Stream syllabus (PDF)</p>
              <div className="mt-8">
                <BrochureDownload file={b.file} title={b.title} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ShowcaseSection>
  );
}
