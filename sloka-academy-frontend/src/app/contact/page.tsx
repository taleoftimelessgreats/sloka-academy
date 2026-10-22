import type { Metadata } from "next";
import { Icon } from "@/components/Icon";
import { SmartLink } from "@/components/SmartLink";
import { Em, PageHeader } from "@/components/ui";
import { preRegisterIsExternal, site } from "@/config/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Call, email or visit Sloka Academy admissions in Madhapur, Hyderabad.",
  alternates: { canonical: "/contact/" },
};

export default function ContactPage() {
  const { contact } = site;
  const enquiryMail = `mailto:${contact.email}?subject=${encodeURIComponent(`${site.programName} enquiry`)}&body=${encodeURIComponent(
    "Name:\nPhone:\nWhat I studied / am studying:\nDomain I'm interested in:\nMy question:\n",
  )}`;

  return (
    <>
      <PageHeader kicker="Contact" title={<>Talk to a person, <Em>not a form.</Em></>} image="/images/studio.webp">
        <p className="lede max-w-xl">
          Questions about a domain, the fee or the next batch? Call or email admissions, or visit us in Madhapur.
        </p>
      </PageHeader>

      <section className="section">
        <div className="wrap grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <div className="grid gap-4">
            <div className="glass p-8">
              <p className="kicker">Call</p>
              <div className="mt-5 space-y-1">
                {contact.phones.map((p) => (
                  <a key={p.href} href={p.href} className="display block text-[1.7rem] transition-colors hover:text-red-hi sm:text-[2.2rem]">
                    {p.display}
                  </a>
                ))}
              </div>
              {contact.supportHours && <p className="mt-3 text-sm text-muted">{contact.supportHours}</p>}
            </div>
            <div className="glass p-8">
              <p className="kicker">Email</p>
              <a href={`mailto:${contact.email}`} className="display mt-5 block break-all text-[1.1rem] transition-colors hover:text-red-hi sm:text-[1.9rem]">
                {contact.email}
              </a>
            </div>
            <div className="glass p-8">
              <p className="kicker">Visit</p>
              <address className="mt-5 text-lg not-italic leading-relaxed text-text/90">
                {contact.address.lines.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
              <SmartLink href={contact.address.mapUrl} className="link-glow mt-6">
                Get directions
                <Icon name="arrowUpRight" size={16} />
              </SmartLink>
            </div>
          </div>

          <div id="enquire" className="relative self-start">
            <div className="glow-orb breathe -inset-10 opacity-60" aria-hidden="true" />
            <div className="glass-strong edge relative p-8 sm:p-11">
              <p className="kicker">Enquire or pre-register</p>
              <h2 className="display mt-6 text-[2.2rem]">
                Send a few lines. <Em>We&rsquo;ll call you back.</Em>
              </h2>
              <p className="mt-6 leading-relaxed text-muted">
                Tell us your name, phone number, what you studied and the domain you have in mind. We will confirm the
                fit, the next batch date and how pre-registration works.
              </p>
              <div className="mt-9 flex flex-col gap-3">
                {preRegisterIsExternal && (
                  <SmartLink href={site.preRegisterUrl} className="btn btn-red">
                    Open the pre-registration form
                  </SmartLink>
                )}
                <a href={enquiryMail} className={`btn ${preRegisterIsExternal ? "btn-glass" : "btn-red"}`}>
                  Write to admissions
                  <Icon name="arrow" size={18} />
                </a>
                {contact.whatsapp && (
                  <SmartLink href={contact.whatsapp} className="btn btn-glass">
                    Message us on WhatsApp
                  </SmartLink>
                )}
              </div>
              <div className="hr-glow mt-9 opacity-50" aria-hidden="true" />
              <p className="mt-6 text-xs leading-relaxed text-muted-2">
                This website doesn&rsquo;t collect personal details or take payments. Registration and payments are
                handled directly by our admissions team.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
