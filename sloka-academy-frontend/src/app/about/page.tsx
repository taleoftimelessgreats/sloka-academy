import type { Metadata } from "next";
import Image from "next/image";
import { ClosingCta, Em, PageHeader, SectionIntro } from "@/components/ui";
import { site } from "@/config/site";
import { CATEGORIES, VISIBLE_DOMAINS } from "@/data/domains";

export const metadata: Metadata = {
  title: "About",
  description:
    "Sloka Academy runs two-month Internship Course Programs that combine structured teaching, practical projects and internship opportunities.",
  alternates: { canonical: "/about/" },
};

const BELIEFS = [
  {
    title: "Depth over breadth",
    body: "Two months is enough to learn one field properly. It is not enough to learn five. So each learner commits to a single domain.",
  },
  {
    title: "Practice is the point",
    body: "Understanding grows when you have to use something. Assignments and a domain project take up a large share of the program for that reason.",
  },
  {
    title: "Say what we deliver",
    body: "We describe the program as it is. No promised salaries, no implied placements, no partnerships we cannot show you.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHeader kicker="About Sloka Academy" title={<>Short programs. <Em>Serious work.</Em></>} image="/images/studio.webp">
        <p className="lede max-w-xl">Sloka Academy exists for the gap between what a degree teaches and what a first role expects.</p>
      </PageHeader>

      <section className="section">
        <div className="wrap grid gap-14 lg:grid-cols-[1fr_1.2fr] lg:gap-24">
          <SectionIntro kicker="Why we started" title={<>Knowing a subject <Em>is not the same</Em> as working in it.</>} />
          <div className="lede space-y-6 !text-[1.15rem] lg:pt-14">
            <p>
              Plenty of students finish their course having read about the tools of their field without ever using them
              on a real problem. Our {site.programName} is a deliberate, compact answer to that: one domain, two
              months, and a sequence that ends in work you have actually produced.
            </p>
            <p>
              Today we offer {VISIBLE_DOMAINS.length} domains across {CATEGORIES.length} areas, from software, data
              and cloud to VLSI, life sciences, clinical research and finance. That range means students of computer
              science, engineering, pharmacy, life sciences, management and commerce can all find a path that builds on
              what they already know.
            </p>
          </div>
        </div>
      </section>

      <section className="section relative overflow-hidden border-y border-line bg-bg-2">
        <div className="glow-orb -left-40 top-1/3 h-[480px] w-[480px] opacity-40" aria-hidden="true" />
        <div className="wrap relative">
          <SectionIntro kicker="What we believe" title={<>Three principles. <Em>Every program.</Em></>} />
          <ol className="mt-16 grid gap-4 md:grid-cols-3">
            {BELIEFS.map((b, i) => (
              <li key={b.title} className={`reveal p-8 ${i === 1 ? "glass edge relative" : "glass"}`}>
                <span className="display text-glow text-5xl text-red-hi/90">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="display mt-8 text-[1.6rem]">{b.title}</h3>
                <p className="mt-4 leading-relaxed text-muted">{b.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CONFIRM: add verified team profiles (name, role, credentials, consented photo) here before launch. */}
      <section className="section">
        <div className="wrap grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
          <div className="photo-cine relative aspect-[4/3] rounded-[var(--radius-lg)] border border-line">
            <Image
              src="/images/session.webp"
              alt="A classroom session with learners facing a presenter"
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
            />
          </div>
          <div>
            <SectionIntro kicker="Visit us" title={<>Come and see us <Em>in Madhapur.</Em></>}>
              The best way to judge a program is to talk to the people who run it. Our admissions team is happy to meet
              you, look at your background and walk you through the domains.
            </SectionIntro>
            <address className="glass mt-10 p-6 not-italic leading-relaxed text-text/90">
              {site.contact.address.lines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          </div>
        </div>
      </section>

      <ClosingCta />
    </>
  );
}
