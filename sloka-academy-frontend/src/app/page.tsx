import Image from "next/image";
import Link from "next/link";
import { DomainFinder } from "@/components/DomainFinder";
import { Icon } from "@/components/Icon";
import { Brochures, Certifications, StudentReviews } from "@/components/Showcase";
import { ClosingCta, Em, FaqList, FeeSection, PreRegisterButton, PricingCard, SectionIntro } from "@/components/ui";
import { formatINR, site } from "@/config/site";
import { CATEGORIES, VISIBLE_DOMAINS } from "@/data/domains";
import { FAQS, ROADMAP } from "@/data/program";
import { STREAMS } from "@/data/streams";

export default function Home() {
  const marquee = VISIBLE_DOMAINS.map((d) => d.name);

  return (
    <>
      {/* ================================================================ HERO */}
      <section className="noise relative isolate flex min-h-[min(calc(100svh-var(--header-h)),920px)] flex-col overflow-hidden">
        <Image
          src="images\home-hero.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="slow-zoom -z-30 object-cover object-[70%_center] opacity-70"
        />
        <div className="absolute inset-0 -z-20 bg-gradient-to-r from-bg via-bg/80 to-bg/10" aria-hidden="true" />
        <div className="absolute inset-0 -z-20 bg-gradient-to-t from-bg via-bg/10 to-bg/50" aria-hidden="true" />
        <div className="grid-lines absolute inset-0 -z-10" aria-hidden="true" />
        <div className="glow-orb breathe -z-10 -left-48 top-1/4 h-[640px] w-[640px] opacity-70" aria-hidden="true" />

        <div className="wrap flex flex-1 flex-col justify-center pb-16 pt-20 lg:pt-24">
          <p className="kicker rise">The 2-Month {site.programName}</p>
          <h1 className="display h-hero rise rise-2 mt-8 max-w-5xl">
            Learn the craft.
            <span className="block">
              <Em>Then prove it.</Em>
            </span>
          </h1>
          <p className="lede rise rise-3 mt-9 max-w-xl">
            Two months of structured teaching, guided practice and real project work in one of{" "}
            {VISIBLE_DOMAINS.length} domains. You leave with a certificate, and with work you are proud to show.
          </p>
          <div className="rise rise-4 mt-11 flex flex-col gap-3 sm:flex-row">
            <PreRegisterButton />
            <Link href="/domains/" className="btn btn-glass">
              Explore domains
            </Link>
          </div>
        </div>

        {/* Bottom glass bar */}
        <div className="wrap rise rise-4 pb-10">
          <div className="glass grid grid-cols-2 divide-line overflow-hidden !rounded-2xl md:grid-cols-4 md:divide-x">
            {[
              ["Duration", "8 weeks"],
              ["Domains", String(VISIBLE_DOMAINS.length)],
              ["Streams", String(STREAMS.length)],
            ].map(([label, value]) => (
              <div key={label} className="px-6 py-5">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-muted-2">{label}</p>
                <p className="display mt-2 text-3xl">{value}</p>
              </div>
            ))}
            <a href="#fee" className="col-span-2 border-t border-line px-6 py-5 transition-colors hover:bg-white/[0.03] md:col-span-1 md:border-t-0">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-muted-2">Program fee</p>
              <p className="mt-2 flex items-baseline gap-3">
                <span className="display text-glow text-3xl text-red-hi">{formatINR(site.fee.current)}</span>
                <span className="strike text-sm">{formatINR(site.fee.original)}</span>
              </p>
            </a>
          </div>
        </div>
      </section>

      {/* ============================================================= MARQUEE */}
      <section aria-label="Domains offered" className="marquee overflow-hidden border-y border-line bg-bg-2 py-6">
        <div className="marquee-track" aria-hidden="true">
          {[0, 1].map((copy) => (
            <ul key={copy} className="flex shrink-0 items-center">
              {marquee.map((name) => (
                <li key={name} className="display flex items-center whitespace-nowrap text-[1.35rem] text-text/35">
                  <span className="px-7">{name}</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-red shadow-[0_0_10px_var(--glow)]" />
                </li>
              ))}
            </ul>
          ))}
        </div>
        <p className="sr-only">{marquee.join(", ")}</p>
      </section>

      {/* =========================================================== STATEMENT */}
      <section className="section relative overflow-hidden">
        <div className="glow-orb -right-60 top-0 h-[520px] w-[520px] opacity-40" aria-hidden="true" />
        <div className="wrap">
          <p className="kicker">Why this program</p>
          <p className="reveal mt-10 max-w-5xl text-[clamp(1.7rem,1.1rem+2.4vw,3.2rem)] font-semibold leading-[1.2] tracking-[-0.015em] text-muted-2">
            Most courses stop at theory. <span className="text-text">Ours is built around what you make.</span> One
            domain, learned properly, <span className="text-text">practised under guidance</span> and finished with a
            project <span className="font-bold text-red-hi">you can stand behind.</span>
          </p>
        </div>
      </section>

      {/* =============================================================== BENTO */}
      <section className="pb-[clamp(5.5rem,4rem+6vw,10rem)]">
        <div className="wrap grid auto-rows-[minmax(220px,auto)] gap-4 md:grid-cols-6">
          {/* Image tile */}
          <div className="reveal photo-cine relative min-h-[420px] overflow-hidden rounded-[var(--radius-lg)] border border-line md:col-span-4 md:row-span-2">
            <Image
              src="/images/home-mentoring.webp"
              alt="Two university students working through a problem together on a laptop"
              fill
              sizes="(min-width: 768px) 66vw, 100vw"
              className="object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 z-10 p-8 sm:p-10">
              <p className="kicker">Weeks 1–5</p>
              <h3 className="display mt-4 max-w-lg text-[clamp(1.8rem,1.3rem+1.6vw,2.7rem)]">
                Learn it session by session. <Em>Practise it every week.</Em>
              </h3>
            </div>
          </div>

          <div className="reveal glass edge relative flex flex-col justify-between overflow-hidden p-8 md:col-span-2">
            <div className="glow-orb -right-20 -top-20 h-60 w-60 opacity-60" aria-hidden="true" />
            <p className="kicker relative">Domains</p>
            <div className="relative">
              <p className="display text-glow text-[5.5rem] leading-none">{VISIBLE_DOMAINS.length}</p>
              <p className="mt-2 text-muted">across {CATEGORIES.length} fields, from VLSI to medical coding.</p>
            </div>
          </div>

          <div className="reveal glass flex flex-col justify-between p-8 md:col-span-2">
            <Icon name="rocket" size={28} className="text-red-hi" />
            <div>
              <h3 className="h-sub">A project you see through</h3>
              <p className="mt-2 text-[0.95rem] text-muted">Weeks six and seven go into one piece of real work, reviewed by your mentor.</p>
            </div>
          </div>

          <div className="reveal glass flex flex-col justify-between p-8 md:col-span-2">
            <Icon name="briefcase" size={28} className="text-red-hi" />
            <div>
              <h3 className="h-sub">Internship opportunity</h3>
              <p className="mt-2 text-[0.95rem] text-muted">A short-term internship so you can apply your skills in a working context.</p>
            </div>
          </div>

          <div className="reveal photo-cine relative min-h-[260px] overflow-hidden rounded-[var(--radius-lg)] border border-line md:col-span-2">
            <Image src="/images/home-engineering.webp" alt="A student in safety glasses soldering a circuit board on a robot kit" fill sizes="33vw" className="object-cover" />
            <p className="display absolute bottom-6 left-7 z-10 text-3xl">Engineering</p>
          </div>

          <div className="reveal glass edge relative flex flex-col justify-between overflow-hidden p-8 md:col-span-2">
            <Icon name="award" size={28} className="text-red-hi" />
            <div>
              <h3 className="h-sub">Certificate on completion</h3>
              <p className="mt-2 text-[0.95rem] text-muted">Plus portfolio help and career guidance in the final week.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================= DOMAINS */}
      <section className="section relative border-t border-line bg-bg-2">
        <div className="wrap">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <SectionIntro kicker="Domains" title={<>Pick your field. <Em>Go deep.</Em></>}>
              Every domain runs on the same two-month structure. Start with your stream, or search all{" "}
              {VISIBLE_DOMAINS.length} domains.
            </SectionIntro>
            <Link href="/domains/" className="link-glow shrink-0">
              Domain details
              <Icon name="arrow" size={18} />
            </Link>
          </div>

          <div className="mt-12">
            <DomainFinder />
          </div>
        </div>
      </section>

      {/* ============================================================= JOURNEY */}
      <section className="section relative overflow-hidden">
        <div className="wrap grid gap-16 lg:grid-cols-[1fr_1.3fr] lg:gap-24">
          <div className="lg:sticky lg:top-[calc(var(--header-h)+56px)] lg:self-start">
            <SectionIntro kicker="The eight weeks" title={<>From day one <Em>to done.</Em></>}>
              A clear sequence, from orientation to certification. The detail inside each stage is specific to your
              domain.
            </SectionIntro>
            <Link href="/internship-course-program/" className="link-glow mt-10">
              How the program works
              <Icon name="arrow" size={18} />
            </Link>
          </div>

          <ol className="relative">
            <span
              className="absolute bottom-6 left-[15px] top-3 w-px bg-gradient-to-b from-red-hi via-red/40 to-transparent shadow-[0_0_12px_var(--glow)]"
              aria-hidden="true"
            />
            {ROADMAP.map((step, i) => (
              <li key={step.weeks} className="reveal relative grid grid-cols-[48px_1fr] pb-12 last:pb-0">
                <span
                  className={`relative z-10 mt-1 grid h-[31px] w-[31px] place-items-center rounded-full border ${
                    i === ROADMAP.length - 1
                      ? "border-red-hi bg-red shadow-[0_0_24px_var(--glow)]"
                      : "border-line-2 bg-bg"
                  }`}
                  aria-hidden="true"
                >
                  <span className={`h-2 w-2 rounded-full ${i === ROADMAP.length - 1 ? "bg-white" : "bg-red-hi"}`} />
                </span>
                <div className="glass p-6 sm:p-7">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-red-hi">{step.weeks}</p>
                  <h3 className="display mt-3 text-[1.6rem]">{step.title}</h3>
                  <p className="mt-3 text-[0.97rem] leading-relaxed text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ================================================================= FEE */}
      <FeeSection className="border-t border-line bg-bg-2">
        <SectionIntro align="center" kicker="Program fee" title={<>One fee. <Em>Every domain.</Em></>}>
          Reduced from {formatINR(site.fee.original)} to {formatINR(site.fee.current)} for the complete program,
          whichever domain you choose.
        </SectionIntro>
        <div className="mx-auto mt-16 max-w-3xl">
          <PricingCard />
          <p className="mt-6 text-center text-sm text-muted-2">
            Admissions will explain the pre-registration amount and payment schedule before you pay anything.
          </p>
        </div>
      </FeeSection>

      {/* ======================================================== PROOF + INFO */}
      {/* Content lives in src/data/showcase.ts. */}
      <StudentReviews />
      <Certifications />
      <Brochures />

      {/* ================================================================= FAQ */}
      <section className="section border-t border-line">
        <div className="wrap grid gap-14 lg:grid-cols-[1fr_1.5fr] lg:gap-24">
          <div>
            <SectionIntro kicker="Questions" title={<>Asked <Em>often.</Em></>} />
            <div className="glass mt-10 max-w-sm p-6">
              <p className="text-sm text-muted">Something else on your mind?</p>
              <a href={site.contact.phones[0].href} className="display mt-2 block text-2xl transition-colors hover:text-red-hi">
                {site.contact.phones[0].display}
              </a>
            </div>
          </div>
          <FaqList items={FAQS} />
        </div>
      </section>

      <ClosingCta />

    </>
  );
}
