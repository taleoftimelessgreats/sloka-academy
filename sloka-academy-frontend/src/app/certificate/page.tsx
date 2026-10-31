import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CertificateForm } from "@/components/CertificateForm";
import { Em, PageHeader } from "@/components/ui";
import { formsEnabled, site } from "@/config/site";

export const metadata: Metadata = {
  title: "Career Guidance Certificate",
  description:
    "Attended a Sloka Academy career guidance session? Fill in the Career Guidance Certificate form with your session code to get your participation certificate by email.",
  alternates: { canonical: "/certificate/" },
};

const STEPS = [
  "Choose the career guidance session you attended and enter the code announced at the end of it.",
  "Type your name in English letters, exactly as it should be printed on the certificate, and refer at least one friend from another college.",
  "Preview your certificate and check your name. Confirm, and download your participation certificate straight away.",
  "We also email the PDF to you. Keep the certificate ID printed on it: anyone can verify the certificate with it.",
];

export default function CertificatePage() {
  return (
    <>
      <PageHeader
        kicker="Career Guidance Program"
        title={<>Career Guidance <Em>Certificate.</Em></>}
        image="/images/session.webp"
      >
        <p className="lede max-w-xl">
          Attended a Sloka Academy career guidance session? Fill in this form with the session code to get your
          certificate of participation. This form is only for career guidance sessions. To join the Internship Course
          Program, use Pre-register.
        </p>
      </PageHeader>

      <section className="section overflow-x-clip">
        <div className="wrap grid gap-14 lg:grid-cols-[1fr_1.4fr] lg:gap-20">
          <div>
            <p className="kicker">How it works</p>
            <ol className="mt-8 space-y-6">
              {STEPS.map((step, i) => (
                <li key={step} className="flex items-baseline gap-5">
                  <span className="font-mono text-sm text-red-hi">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-[1.05rem] leading-relaxed text-text/90">{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-10 text-sm leading-relaxed text-muted">
              Need to check a certificate someone has shown you?{" "}
              <Link href="/verify/" className="text-text underline underline-offset-4">
                Verify it here
              </Link>
              .
            </p>
          </div>

          <div className="relative self-start">
            <div className="glow-orb breathe -inset-10 opacity-60" aria-hidden="true" />
            <div className="glass-strong edge relative p-7 sm:p-11">
              {formsEnabled ? (
                <Suspense fallback={<p className="text-muted">Loading sessions…</p>}>
                  <CertificateForm />
                </Suspense>
              ) : (
                <>
                  <h2 className="h-sub">Online certificate registration isn&rsquo;t available yet.</h2>
                  <p className="mt-3 leading-relaxed text-muted">
                    Email {site.contact.email} with your name, college and the session you attended, or call{" "}
                    <a href={site.contact.phones[0].href} className="text-text underline underline-offset-4">
                      {site.contact.phones[0].display}
                    </a>
                    .
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
