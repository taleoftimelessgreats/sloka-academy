import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { ClosingCta, Em, FaqList, FeeSection, Note, PageHeader, PreRegisterButton, PricingCard, SectionIntro } from "@/components/ui";
import { formatINR, site } from "@/config/site";
import { FAQS, ROADMAP, feeSentence } from "@/data/program";

export const metadata: Metadata = {
  title: site.programName,
  description: `How Sloka Academy's 2-Month Internship Course Program works and what it includes. ${feeSentence()}`,
  alternates: { canonical: "/internship-course-program/" },
};

const COMPLETION = [
  "Attend the scheduled sessions for your domain",
  "Complete the practice assignments",
  "Submit your project or internship work for review",
  "Meet any domain-specific requirements we share at the start",
];

export default function ProgramPage() {
  return (
    <>
      <PageHeader
        kicker={`The 2-Month ${site.programName}`}
        title={<>Eight weeks, <Em>built with intent.</Em></>}
        image="/images/workshop.webp"
      >
        <p className="lede max-w-xl">
          The program moves in one direction: from understanding a field, to practising it, to producing real work in
          it. Here is how the two months come together.
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <PreRegisterButton />
          <a href="#fee" className="btn btn-glass">
            View program fee
          </a>
        </div>
      </PageHeader>

      {/* Week by week */}
      <section className="section">
        <div className="wrap">
          <SectionIntro kicker="Week by week" title={<>The shape of <Em>two months.</Em></>}>
            Every domain follows this structure. The detail inside each stage is specific to your subject.
          </SectionIntro>
          <ol className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {ROADMAP.map((step, i) => {
              const last = i === ROADMAP.length - 1;
              return (
                <li
                  key={step.weeks}
                  className={`reveal relative flex flex-col overflow-hidden p-7 ${last ? "glass edge" : "glass"}`}
                >
                  {last && <div className="glow-orb -bottom-20 -right-20 h-56 w-56 opacity-60" aria-hidden="true" />}
                  <span className="display text-glow relative text-5xl text-red-hi/90">{String(i + 1).padStart(2, "0")}</span>
                  <p className="relative mt-8 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-muted-2">{step.weeks}</p>
                  <h3 className="display relative mt-2 text-[1.45rem]">{step.title}</h3>
                  <p className="relative mt-3 text-[0.94rem] leading-relaxed text-muted">{step.body}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Internship & certification */}
      <section className="relative border-y border-line bg-bg-2">
        <div className="grid lg:grid-cols-2">
          <div className="photo-cine relative min-h-[420px]">
            <Image
              src="/images/engineering.webp"
              alt="A learner working on technical drawings at a desk"
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
            />
          </div>
          <div className="section px-5 sm:px-8 lg:pl-20 lg:pr-[max(3.5rem,calc((100vw-1320px)/2+3.5rem))]">
            <SectionIntro kicker="Internship" title={<>Real work, <Em>honestly described.</Em></>}>
              The program includes a short-term internship opportunity, so you can use what you have learned in a
              working context. Before you register, admissions explains who is eligible, how internships are allocated,
              who provides them and how long they run.
            </SectionIntro>
            <div className="mt-8 max-w-xl">
              <Note>
                Internships through the program are not guaranteed to be paid, and the program does not promise
                employment or placement.
              </Note>
            </div>

            <div className="hr-glow mt-14 opacity-60" aria-hidden="true" />
            <p className="kicker mt-12">Certification</p>
            <h3 className="display mt-5 text-[2rem]">Earning your certificate</h3>
            <ol className="mt-7 space-y-4">
              {COMPLETION.map((item, i) => (
                <li key={item} className="flex items-baseline gap-5">
                  <span className="font-mono text-sm text-red-hi">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-text/90">{item}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Fee */}
      <FeeSection>
        <SectionIntro align="center" kicker="Program fee" title={<>{formatINR(site.fee.current)}. <Em>All in.</Em></>}>
          Reduced from {formatINR(site.fee.original)}, and the same for every domain. Admissions will explain the
          pre-registration amount, the balance and when it is due before you pay anything.
        </SectionIntro>
        <div className="mx-auto mt-16 max-w-3xl">
          <PricingCard />
          <p className="mt-6 text-center text-sm text-muted-2">
            See our{" "}
            <Link href="/refund-policy/" className="text-text underline underline-offset-4">
              payment and refund policy
            </Link>
            .
          </p>
        </div>
      </FeeSection>

      {/* FAQ */}
      <section className="section border-t border-line bg-bg-2">
        <div className="wrap grid gap-14 lg:grid-cols-[1fr_1.5fr] lg:gap-24">
          <SectionIntro kicker="Questions" title={<>Before you <Em>decide.</Em></>} />
          <FaqList items={FAQS} />
        </div>
      </section>

      <section className="section-sm border-t border-line">
        <div className="wrap flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <h2 className="display text-[clamp(2.2rem,1.8rem+1.6vw,3.4rem)]">
            Next, <Em>choose your domain.</Em>
          </h2>
          <Link href="/domains/" className="btn btn-glass">
            Explore domains
            <Icon name="arrow" size={18} />
          </Link>
        </div>
      </section>

      <ClosingCta />
    </>
  );
}
