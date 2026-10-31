import type { Metadata } from "next";
import { Suspense } from "react";
import { CertificateVerify } from "@/components/CertificateVerify";
import { Em, PageHeader } from "@/components/ui";
import { formsEnabled, site } from "@/config/site";

export const metadata: Metadata = {
  title: "Verify a certificate",
  description: "Check that a Sloka Academy certificate is genuine using the certificate ID printed on it.",
  alternates: { canonical: "/verify/" },
};

export default function VerifyPage() {
  return (
    <>
      <PageHeader kicker="Certificate verification" title={<>Check a certificate <Em>is genuine.</Em></>} image="/images/studio.webp">
        <p className="lede max-w-xl">
          Enter the certificate ID printed at the bottom of a Sloka Academy certificate. We show who it was issued to,
          for which session, whether it is still valid, and the certificate itself.
        </p>
      </PageHeader>

      <section className="section-sm pb-32">
        <div className="wrap">
          <div className="max-w-3xl">
            {formsEnabled ? (
              <Suspense fallback={<p className="text-muted">Loading…</p>}>
                <CertificateVerify />
              </Suspense>
            ) : (
              <p className="leading-relaxed text-muted">
                Online verification isn&rsquo;t available yet. Email {site.contact.email} with the certificate ID and we
                will confirm it for you.
              </p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
