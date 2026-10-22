import Link from "next/link";
import { lmsHref, lmsIsExternal, navLinks, policyLinks, site } from "@/config/site";
import { STREAMS } from "@/data/streams";
import { Logo } from "./Logo";
import { SmartLink } from "./SmartLink";

function FooterHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-muted-2">{children}</h2>;
}

export function SiteFooter() {
  const { contact } = site;
  const socials = site.social.filter((s) => s.href);

  return (
    <footer className="relative overflow-hidden border-t border-line bg-bg">
      <div className="hr-glow absolute inset-x-0 top-0" aria-hidden="true" />
      <div className="wrap pt-20">
        <div className="grid gap-14 pb-16 md:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1.4fr] lg:gap-10">
          <div className="max-w-xs">
            <Logo className="h-[72px] w-auto" />
            <p className="mt-6 text-sm leading-relaxed text-muted">
              Two-month Internship Course Programs in technology, engineering, life sciences, healthcare and business.
              Based in Madhapur, Hyderabad.
            </p>
            {socials.length > 0 && (
              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {socials.map((s) => (
                  <li key={s.label}>
                    <SmartLink href={s.href} className="text-muted hover:text-text">
                      {s.label}
                    </SmartLink>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <FooterHeading>Academy</FooterHeading>
            <ul className="mt-5 space-y-3 text-sm">
              {navLinks.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-muted transition-colors hover:text-text">
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <SmartLink href={lmsHref} external={lmsIsExternal} className="text-muted transition-colors hover:text-text">
                  LMS
                </SmartLink>
              </li>
            </ul>
          </div>

          <div>
            <FooterHeading>By stream</FooterHeading>
            <ul className="mt-5 space-y-3 text-sm">
              {STREAMS.map((s) => (
                <li key={s.id}>
                  <Link href={`/domains/?stream=${s.id}`} className="text-muted transition-colors hover:text-text">
                    {"short" in s ? s.short : s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <FooterHeading>Visit or call</FooterHeading>
            <address className="mt-5 text-sm not-italic leading-relaxed text-muted">
              {contact.address.lines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
            <ul className="mt-6 space-y-2 text-sm">
              {contact.phones.map((p) => (
                <li key={p.href}>
                  <a href={p.href} className="transition-colors hover:text-red-hi">
                    {p.display}
                  </a>
                </li>
              ))}
              <li>
                <a href={`mailto:${contact.email}`} className="transition-colors hover:text-red-hi">
                  {contact.email}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <p
          className="display pointer-events-none select-none bg-gradient-to-b from-white/[0.07] to-transparent bg-clip-text text-center text-[clamp(2.6rem,9.5vw,9.5rem)] leading-[0.9] text-transparent"
          aria-hidden="true"
        >
          Sloka Academy
        </p>

        <div className="flex flex-col gap-4 border-t border-line py-7 text-xs text-muted-2 md:flex-row md:items-center md:justify-between">
          <p>© 2026 Sloka Academy. All rights reserved.</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {policyLinks.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="transition-colors hover:text-text">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
