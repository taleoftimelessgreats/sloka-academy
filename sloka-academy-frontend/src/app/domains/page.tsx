import type { Metadata } from "next";
import { Suspense } from "react";
import { DomainCatalogue, DomainCatalogueFallback } from "@/components/DomainCatalogue";
import { ClosingCta, Em, PageHeader } from "@/components/ui";
import { VISIBLE_DOMAINS } from "@/data/domains";

export const metadata: Metadata = {
  title: "Domains",
  description: `Search and filter all ${VISIBLE_DOMAINS.length} Sloka Academy Internship Course Program domains by stream — Computer Science, Management, Pharmacy, Life Sciences, Engineering, Commerce and more.`,
  alternates: { canonical: "/domains/" },
};

export default function DomainsPage() {
  return (
    <>
      <PageHeader kicker="The catalogue" title={<>{VISIBLE_DOMAINS.length} domains. <Em>Find yours.</Em></>} image="/images/code.webp">
        <p className="lede max-w-xl">
          Technology, engineering, life sciences, healthcare and business. Filter by what you studied, or search for a
          subject by name.
        </p>
      </PageHeader>
      <section className="section-sm pb-32">
        <div className="wrap">
          <Suspense fallback={<DomainCatalogueFallback />}>
            <DomainCatalogue />
          </Suspense>
        </div>
      </section>
      <ClosingCta
        title={<>Not sure which <Em>fits you?</Em></>}
        body="Tell us your stream, your year and what interests you. We will suggest two or three domains and explain the differences."
      />
    </>
  );
}
