import type { Metadata } from "next";
import { Icon } from "@/components/Icon";
import { InquiryForm } from "@/components/InquiryForm";
import { Em, Note, PageHeader } from "@/components/ui";
import { enquiryMailto, formsEnabled, site } from "@/config/site";

export const metadata: Metadata = {
  title: "Pre-register",
  description: `Pre-register for the next batch of Sloka Academy's 2-Month ${site.programName}. Admissions calls you to confirm your domain, batch and payment schedule.`,
  alternates: { canonical: "/pre-register/" },
};

const STEPS = [
  "Send us your details. You pay nothing on this website.",
  "Admissions calls you to check the fit, confirm your domain and share the next batch date.",
  "They explain the pre-registration amount and payment schedule before you pay anything.",
];

export default function PreRegisterPage() {
  const { contact } = site;

  return (
    <>
      <PageHeader kicker="Pre-register" title={<>Hold your place <Em>in the next batch.</Em></>} image="/images/session.webp">
        <p className="lede max-w-xl">
          Tell us who you are and what you would like to study. Admissions will call you to confirm the details.
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
            <div className="mt-10">
              <Note>
                Registration and payments are handled directly by our admissions team. This website never asks for
                payment details.
              </Note>
            </div>
          </div>

          <div className="relative self-start">
            <div className="glow-orb breathe -inset-10 opacity-60" aria-hidden="true" />
            <div className="glass-strong edge relative p-7 sm:p-11">
              {formsEnabled ? (
                <InquiryForm
                  source="pre-register"
                  submitLabel="Pre-register"
                  sentMessage="Admissions will call you to confirm your domain and the next batch date, and to explain the pre-registration amount and payment schedule before you pay anything."
                />
              ) : (
                <>
                  <h2 className="display text-[2.2rem]">
                    Call or write to <Em>admissions.</Em>
                  </h2>
                  <p className="mt-6 leading-relaxed text-muted">
                    Give us your name, phone number, what you studied and the domain you have in mind, and we will hold
                    your place while we confirm the details.
                  </p>
                  <div className="mt-9 flex flex-col gap-3">
                    <a href={contact.phones[0].href} className="btn btn-red">
                      <Icon name="phone" size={17} />
                      Call {contact.phones[0].display}
                    </a>
                    <a href={enquiryMailto(`Pre-registration: ${site.programName}`)} className="btn btn-glass">
                      Write to admissions
                      <Icon name="arrow" size={18} />
                    </a>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
