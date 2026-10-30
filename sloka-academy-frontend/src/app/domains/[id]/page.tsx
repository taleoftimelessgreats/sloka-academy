import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { AvailabilityLabel, ClosingCta, DomainCard, Em, FeeSummary, Note, PageHeader, PreRegisterButton, PricingCard } from "@/components/ui";
import { site } from "@/config/site";
import { DOMAINS, VISIBLE_DOMAINS, getDomain, type Category, type Domain } from "@/data/domains";
import { streamLabel } from "@/data/streams";

export const dynamicParams = false;

export function generateStaticParams() {
  return VISIBLE_DOMAINS.map((d) => ({ id: d.id }));
}

export async function generateMetadata({ params }: PageProps<"/domains/[id]">): Promise<Metadata> {
  const { id } = await params;
  const domain = getDomain(id);
  if (!domain) return {};
  return {
    title: `${domain.name} ${site.programName}`,
    description: `${domain.summary} Part of Sloka Academy's 2-Month ${site.programName}.`,
    alternates: { canonical: `/domains/${domain.id}/` },
    openGraph: { title: `${domain.name} | ${site.name}`, description: domain.summary },
  };
}

const CATEGORY_IMAGE: Record<Category, string> = {
  "Software Development": "/images/code.webp",
  "Testing and Foundations": "/images/code.webp",
  "Enterprise Applications": "/images/practice.webp",
  "Design and Digital": "/images/workshop.webp",
  "AI and Data": "/images/practice.webp",
  "Cloud and DevOps": "/images/datacenter.webp",
  "Security and Emerging Computing": "/images/datacenter.webp",
  "Embedded and Smart Systems": "/images/engineering.webp",
  "Engineering and Advanced Science": "/images/engineering.webp",
  "Bio and Life Sciences": "/images/lab.webp",
  "Healthcare and Clinical": "/images/lab.webp",
  "Business Finance and Management": "/images/workshop.webp",
};

function Block({ n, title, children }: { n: string; title: ReactNode; children: ReactNode }) {
  return (
    <section className="reveal">
      <div className="flex items-baseline gap-5">
        <span className="font-mono text-sm text-red-hi">{n}</span>
        <h2 className="display text-[clamp(1.8rem,1.5rem+1.2vw,2.6rem)]">{title}</h2>
      </div>
      <div className="hr-glow mb-9 mt-6 opacity-60" aria-hidden="true" />
      {children}
    </section>
  );
}

function Curriculum({ domain }: { domain: Domain }) {
  if (domain.modules?.length) {
    return (
      <div className="space-y-3">
        {domain.modules.map((m, i) => (
          <details key={m.title} className="disclosure glass !rounded-2xl px-6" open={i === 0}>
            <summary className="flex items-center justify-between gap-6 py-5">
              <span className="flex items-baseline gap-4">
                <span className="font-mono text-sm text-red-hi">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-lg font-medium">{m.title}</span>
              </span>
              <span className="plus text-red-hi" aria-hidden="true" />
            </summary>
            <ol className="list-decimal space-y-1.5 pb-6 pl-14 text-muted">
              {m.sessions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    );
  }
  return (
    <>
      <ol className="grid gap-3 sm:grid-cols-2">
        {domain.focusAreas.map((area, i) => (
          <li
            key={area}
            className={`relative flex min-h-[124px] flex-col justify-between overflow-hidden rounded-2xl border p-6 ${
              i % 2 === 0
                ? "border-red/40 bg-gradient-to-br from-red/30 via-red-deep/25 to-transparent shadow-[0_20px_50px_-30px_var(--glow)]"
                : "border-line bg-white/[0.03]"
            }`}
          >
            <span className="font-mono text-xs text-text/50">{String(i + 1).padStart(2, "0")}</span>
            <span className="mt-5 text-[1.05rem] font-medium leading-snug">{area}</span>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm text-muted-2">
        The full session-by-session plan is in the domain brochure. Ask admissions and we will send it to you.
      </p>
    </>
  );
}

export default async function DomainPage({ params }: PageProps<"/domains/[id]">) {
  const { id } = await params;
  const domain = getDomain(id);
  if (!domain || !domain.visible) notFound();

  const related = DOMAINS.filter((d) => d.visible && d.id !== domain.id && d.category === domain.category).slice(0, 3);
  const enquiryHref = `mailto:${site.contact.email}?subject=${encodeURIComponent(`Enquiry: ${domain.name} ${site.programName}`)}`;
  const isOpen = domain.availability === "open";

  const facts: [string, ReactNode][] = [
    ["Duration", "Two months (8 weeks)"],
    ["Program fee", <FeeSummary key="fee" />],
    ["Learning platform", "Sloka Academy LMS, hosted on Teachmint"],
    ["Completion", "Certificate on meeting the program requirements"],
  ];
  if (domain.deliveryMode) facts.push(["Format", domain.deliveryMode]);
  if (domain.prerequisites) facts.push(["Prerequisites", domain.prerequisites]);
  if (domain.batches?.length) facts.push(["Upcoming batches", domain.batches.join(", ")]);

  return (
    <>
      <PageHeader
        kicker={domain.category}
        title={domain.name}
        image={CATEGORY_IMAGE[domain.category]}
        breadcrumb={
          <nav aria-label="Breadcrumb" className="text-sm text-muted">
            <ol className="flex flex-wrap gap-2">
              <li>
                <Link href="/domains/" className="hover:text-text">Domains</Link>
              </li>
              <li aria-hidden="true" className="text-muted-2">/</li>
              <li aria-current="page" className="text-text">{domain.name}</li>
            </ol>
          </nav>
        }
      >
        <p className="lede max-w-2xl">{domain.summary}</p>
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
          <AvailabilityLabel availability={domain.availability} />
          <span className="text-sm text-muted">
            2 months · <FeeSummary />
          </span>
        </div>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          {isOpen ? (
            <PreRegisterButton />
          ) : (
            <a href={enquiryHref} className="btn btn-red">
              Enquire about the next batch
              <Icon name="arrow" size={18} />
            </a>
          )}
          {domain.brochure && (
            <a href={domain.brochure} download className="btn btn-glass">
              <Icon name="download" size={18} />
              Download brochure
            </a>
          )}
        </div>
      </PageHeader>

      <div className="wrap grid gap-20 overflow-x-clip py-24 lg:grid-cols-[1fr_400px] lg:py-32">
        <div className="min-w-0 space-y-24">
          <Block n="01" title={<>Who it&rsquo;s <Em>for</Em></>}>
            <p className="text-[clamp(1.3rem,1.1rem+0.8vw,1.75rem)] leading-snug text-text/90">{domain.audience}</p>
            <ul className="mt-8 flex flex-wrap gap-2">
              {domain.streams.map((s) => (
                <li key={s}>
                  <Link href={`/domains/?stream=${s}`} className="chip inline-flex items-center">
                    {streamLabel(s)}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted-2">
              Listed under these streams. We confirm any prerequisites with you before you register.
            </p>
          </Block>

          <Block n="02" title={<>What you&rsquo;ll <Em>study</Em></>}>
            <Curriculum domain={domain} />
          </Block>

          <Block n="03" title={<>What you&rsquo;ll <Em>build</Em></>}>
            {domain.projects?.length ? (
              <ul className="space-y-3">
                {domain.projects.map((p) => (
                  <li key={p} className="glass flex gap-4 p-5">
                    <Icon name="rocket" size={20} className="mt-0.5 shrink-0 text-red-hi" />
                    {p}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="glass p-7">
                  <Icon name="code" size={24} className="text-red-hi" />
                  <h3 className="h-sub mt-5">Practice tasks</h3>
                  <p className="mt-2 text-[0.95rem] leading-relaxed text-muted">
                    Short assignments after each block of sessions, from the first week onwards. Each one is reviewed,
                    so you know exactly what to improve.
                  </p>
                </div>
                <div className="glass edge relative p-7">
                  <Icon name="rocket" size={24} className="text-red-hi" />
                  <h3 className="h-sub mt-5">Your domain project</h3>
                  <p className="mt-2 text-[0.95rem] leading-relaxed text-muted">
                    In weeks six and seven you take on a project that pulls the whole curriculum together. Briefs are
                    set for each batch.
                  </p>
                </div>
              </div>
            )}
          </Block>

          <Block n="04" title={<>How it <Em>runs</Em></>}>
            <dl className="glass divide-y divide-line overflow-hidden">
              {facts.map(([label, value]) => (
                <div key={label} className="grid gap-1 px-6 py-5 sm:grid-cols-[200px_1fr] sm:gap-6">
                  <dt className="text-sm text-muted-2">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5">
              <Note>
                Batch dates, class timings and the internship arrangement for {domain.name} are shared by admissions
                when you get in touch.
              </Note>
            </div>
          </Block>

          <Block n="05" title={<>Where it can <Em>lead</Em></>}>
            <ul className="grid gap-3 sm:grid-cols-3">
              {domain.roles.map((r) => (
                <li key={r} className="glass p-5 font-medium leading-snug">
                  {r}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm text-muted-2">
              Examples of roles this domain relates to. The program does not guarantee a job or placement.
            </p>
          </Block>
        </div>

        <aside className="lg:sticky lg:top-[calc(var(--header-h)+32px)] lg:self-start">
          <PricingCard compact />
          <div className="mt-6 space-y-1 px-2 text-sm">
            <a href={enquiryHref} className="flex items-center gap-3 py-1.5 text-muted transition-colors hover:text-text">
              <Icon name="mail" size={17} className="text-red-hi" /> Email about {domain.name}
            </a>
            <a href={site.contact.phones[0].href} className="flex items-center gap-3 py-1.5 text-muted transition-colors hover:text-text">
              <Icon name="phone" size={17} className="text-red-hi" /> {site.contact.phones[0].display}
            </a>
          </div>
        </aside>
      </div>

      {related.length > 0 && (
        <section className="section-sm border-t border-line bg-bg-2">
          <div className="wrap">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="kicker">Related</p>
                <h2 className="display mt-5 text-[clamp(1.8rem,1.5rem+1.2vw,2.6rem)]">More in {domain.category}</h2>
              </div>
              <Link href="/domains/" className="link-glow">
                All domains
                <Icon name="arrow" size={18} />
              </Link>
            </div>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((d) => (
                <li key={d.id}>
                  <DomainCard domain={d} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <ClosingCta
        title={<>Ready for <Em>{domain.name}?</Em></>}
        body="Call or email admissions. We will confirm the next batch date, check the fit with your background and explain how pre-registration works."
        image={CATEGORY_IMAGE[domain.category]}
      />
    </>
  );
}
