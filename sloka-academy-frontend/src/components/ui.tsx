import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { feeSaving, formatINR, preRegisterHref, preRegisterIsExternal, site } from "@/config/site";
import type { Domain } from "@/data/domains";
import type { Faq } from "@/data/program";
import { Icon } from "./Icon";
import { SmartLink } from "./SmartLink";

export function PreRegisterButton({ className = "btn btn-red", children = "Pre-register" }: { className?: string; children?: ReactNode }) {
  return (
    <SmartLink href={preRegisterHref} external={preRegisterIsExternal} className={className}>
      {children}
      <Icon name="arrow" size={18} />
    </SmartLink>
  );
}

/** Red accent words inside a display heading. */
export function Em({ children }: { children: ReactNode }) {
  return <span className="red-text">{children}</span>;
}

export function SectionIntro({
  kicker,
  title,
  children,
  align = "left",
  className = "",
}: {
  kicker?: string;
  title: ReactNode;
  children?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={`${align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl"} ${className}`}>
      {kicker && <p className="kicker">{kicker}</p>}
      <h2 className="display h-section mt-6">{title}</h2>
      {children && <div className={`lede mt-6 ${align === "center" ? "mx-auto max-w-2xl" : "max-w-2xl"}`}>{children}</div>}
    </div>
  );
}

/** Interior page header over a cinematic photo. */
export function PageHeader({
  kicker,
  title,
  children,
  image = "/images/studio.webp",
  breadcrumb,
}: {
  kicker: string;
  title: ReactNode;
  children?: ReactNode;
  image?: string;
  breadcrumb?: ReactNode;
}) {
  return (
    <section className="noise relative isolate overflow-hidden border-b border-line">
      <Image src={image} alt="" fill priority sizes="100vw" className="slow-zoom -z-30 object-cover opacity-45" />
      <div className="absolute inset-0 -z-20 bg-gradient-to-r from-bg via-bg/85 to-bg/30" aria-hidden="true" />
      <div className="absolute inset-0 -z-20 bg-gradient-to-t from-bg via-transparent to-bg/40" aria-hidden="true" />
      <div className="glow-orb breathe -z-10 -left-40 top-10 h-[520px] w-[520px] opacity-60" aria-hidden="true" />
      <div className="wrap pb-20 pt-24 sm:pb-24 sm:pt-28 lg:pb-28 lg:pt-36">
        {breadcrumb && <div className="rise mb-10">{breadcrumb}</div>}
        <p className="kicker rise">{kicker}</p>
        <h1 className="display h-page rise rise-2 mt-7 max-w-5xl">{title}</h1>
        {children && <div className="rise rise-3 mt-8">{children}</div>}
      </div>
    </section>
  );
}

/** Large price with the original fee struck through. */
export function Price({ size = "lg" }: { size?: "lg" | "md" }) {
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
      <span className={`display text-glow leading-none ${size === "lg" ? "text-[3.6rem] sm:text-[5.6rem]" : "text-[3.2rem]"}`}>
        <span className="sr-only">Now </span>
        {formatINR(site.fee.current)}
      </span>
      <span className={`strike pb-3 font-medium ${size === "lg" ? "text-2xl" : "text-xl"}`}>
        <span className="sr-only">Was </span>
        {formatINR(site.fee.original)}
      </span>
    </div>
  );
}

export const FEE_INCLUDES = [
  "Two months of session-wise teaching in your chosen domain",
  "Guided practice after every block of sessions",
  "A domain project, reviewed by your mentor",
  "A short-term internship opportunity",
  "Course material on the Sloka Academy LMS",
  "Certificate on completion and career guidance",
];

export function SaveBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-red/50 bg-red/15 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-red-hi shadow-[0_0_24px_-6px_var(--glow)]">
      <span className="h-1.5 w-1.5 rounded-full bg-red-hi" aria-hidden="true" />
      Save {formatINR(feeSaving)}
    </span>
  );
}

/** Inline fee for fact rows and headers. */
export function FeeSummary() {
  return (
    <span>
      <strong className="text-red-hi">{formatINR(site.fee.current)}</strong>
      <span className="strike ml-3 text-sm">{formatINR(site.fee.original)}</span>
    </span>
  );
}

/** Glass pricing panel: ₹14,999 struck through, ₹9,999 highlighted. */
export function PricingCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className="relative">
      <div className="glow-orb breathe -inset-10 opacity-70" aria-hidden="true" />
      <div className="glass-strong edge relative overflow-hidden">
        <div className={compact ? "p-7" : "p-8 sm:p-11"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="kicker">Program fee</p>
            <SaveBadge />
          </div>
          <div className={compact ? "mt-7" : "mt-10"}>
            <Price size={compact ? "md" : "lg"} />
            <p className="mt-4 text-sm text-muted">
              The complete {site.programName}. One fee, same for every domain.
            </p>
          </div>
          {!compact && (
            <>
              <div className="hr-glow mt-10" aria-hidden="true" />
              <ul className="mt-8 grid gap-4 text-[0.95rem] text-text/85 sm:grid-cols-2 sm:gap-x-8">
                {FEE_INCLUDES.map((item) => (
                  <li key={item} className="flex gap-3">
                    <Icon name="check" size={17} strokeWidth={2.4} className="mt-1 shrink-0 text-red-hi" />
                    {item}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className={`flex flex-col gap-3 ${compact ? "mt-7" : "mt-10 sm:flex-row"}`}>
            <PreRegisterButton className={`btn btn-red ${compact ? "w-full" : "flex-1"}`}>Reserve your seat</PreRegisterButton>
            <Link href="/contact/" className={`btn btn-glass ${compact ? "w-full" : "flex-1"}`}>
              Talk to admissions
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The program fee section (anchor #fee). */
export function FeeSection({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <section id="fee" className={`section relative overflow-hidden ${className}`}>
      <div className="grid-lines absolute inset-0" aria-hidden="true" />
      <div className="wrap relative">{children}</div>
    </section>
  );
}

export function AvailabilityLabel({ availability }: { availability: Domain["availability"] }) {
  const open = availability === "open";
  return (
    <span className="inline-flex items-center gap-2.5 text-sm text-text/85">
      <span
        className={`h-2 w-2 rounded-full ${open ? "bg-emerald-400 shadow-[0_0_10px_rgb(52_211_153)]" : "bg-red-hi shadow-[0_0_10px_var(--glow)]"}`}
        aria-hidden="true"
      />
      {open ? "Open for registration" : "Taking enquiries for the next batch"}
    </span>
  );
}

export function DomainCard({ domain, headingLevel = "h3", index }: { domain: Domain; headingLevel?: "h2" | "h3"; index?: number }) {
  const H = headingLevel;
  return (
    <Link href={`/domains/${domain.id}/`} className="d-card group">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-muted-2">{domain.category}</p>
        {index !== undefined && <span className="font-mono text-xs text-muted-2">{String(index + 1).padStart(2, "0")}</span>}
      </div>
      <H className="display relative mt-6 text-[1.55rem]">{domain.name}</H>
      <p className="relative mt-4 line-clamp-2 text-[0.92rem] leading-relaxed text-muted">{domain.summary}</p>
      <div className="relative mt-auto flex items-center justify-between pt-8">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-text/70 transition-colors group-hover:text-text">
          Explore
        </span>
        <span className="go inline-grid h-10 w-10 place-items-center rounded-full border border-line-2">
          <Icon name="arrowUpRight" size={16} />
        </span>
      </div>
    </Link>
  );
}

export function FaqList({ items }: { items: Faq[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <details key={item.q} className="disclosure glass !rounded-2xl px-6 transition-colors">
          <summary className="flex items-center justify-between gap-8 py-6 text-left text-[1.05rem] font-medium">
            {item.q}
            <span className="plus text-red-hi" aria-hidden="true" />
          </summary>
          <div className="-mt-1 max-w-2xl pb-7 leading-relaxed text-muted">
            {item.a}
            {item.link && (
              <Link href={item.link.href} className="link-glow mt-4 flex w-fit">
                {item.link.label}
                <Icon name="arrow" size={16} />
              </Link>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

/** Closing call to action: cinematic photo, red glow. */
export function ClosingCta({
  title = <>Your next two months <Em>start here.</Em></>,
  body = "Tell us your stream and the domain you have in mind. We will check the fit, share the next batch date and hold your seat.",
  image = "/images/session.webp",
}: {
  title?: ReactNode;
  body?: ReactNode;
  image?: string;
}) {
  return (
    <section className="relative isolate overflow-hidden border-t border-line">
      <Image src={image} alt="" fill sizes="100vw" className="-z-30 object-cover opacity-40" />
      <div className="absolute inset-0 -z-20 bg-gradient-to-t from-bg via-bg/80 to-bg/60" aria-hidden="true" />
      <div className="glow-orb breathe -z-10 bottom-[-30%] left-1/2 h-[600px] w-[900px] -translate-x-1/2" aria-hidden="true" />
      <div className="wrap section text-center">
        <h2 className="display h-section mx-auto max-w-4xl">{title}</h2>
        <p className="lede mx-auto mt-7 max-w-xl">{body}</p>
        <div className="mt-11 flex flex-col justify-center gap-3 sm:flex-row">
          <PreRegisterButton />
          <a href={site.contact.phones[0].href} className="btn btn-glass">
            <Icon name="phone" size={17} />
            Call admissions
            <span className="sr-only"> on {site.contact.phones[0].display}</span>
          </a>
        </div>
      </div>
    </section>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-3 rounded-xl border border-line bg-white/[0.02] px-4 py-3.5 text-sm leading-relaxed text-muted">
      <Icon name="info" size={17} className="mt-0.5 shrink-0 text-red-hi" />
      <span>{children}</span>
    </p>
  );
}
