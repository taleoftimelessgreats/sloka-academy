import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Em, PageHeader } from "@/components/ui";
import { site } from "@/config/site";

export const metadata: Metadata = {
  title: "LMS",
  description: "Access the Sloka Academy learning platform on Teachmint.",
  robots: { index: false },
};

/**
 * Fallback shown only while `site.lmsUrl` is empty. Once the academy's
 * Teachmint login URL is configured, the LMS navbar link opens it directly.
 */
export default function LmsPage() {
  return (
    <>
      <PageHeader kicker="Learning platform" title={<>Sloka Academy <Em>LMS</Em></>} image="/images/code.webp">
        <p className="lede max-w-xl">
          Your classes, course material and assignments live on our learning platform, hosted by Teachmint.
        </p>
      </PageHeader>
      <section className="section">
        <div className="wrap max-w-3xl">
          <div className="glass edge relative p-8 sm:p-12">
            <h2 className="display text-[2.1rem]">Can&rsquo;t find your login?</h2>
            <p className="lede mt-5">
              Your Teachmint login details are sent to you when you enrol. If you have lost them, email learner support
              and we will help you back in. We will never ask for your password, and neither will this website.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a href={`mailto:${site.contact.email}?subject=LMS%20access`} className="btn btn-red">
                Email learner support
                <Icon name="arrow" size={18} />
              </a>
              <Link href="/contact/" className="btn btn-glass">
                Other ways to reach us
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
