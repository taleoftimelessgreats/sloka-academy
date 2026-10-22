import Link from "next/link";
import type { ReactNode } from "react";
import { policyLinks } from "@/config/site";

export function PolicyPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <section className="section relative overflow-hidden">
      <div className="glow-orb -left-60 -top-40 h-[520px] w-[520px] opacity-40" aria-hidden="true" />
      <div className="wrap relative grid gap-12 lg:grid-cols-[260px_1fr] lg:gap-20">
        <nav aria-label="Policies" className="lg:sticky lg:top-[calc(var(--header-h)+48px)] lg:self-start">
          <p className="kicker">Policies</p>
          <ul className="mt-6 space-y-1 text-sm">
            {policyLinks.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="block rounded-lg px-3 py-2 text-muted transition-colors hover:bg-white/[0.04] hover:text-text">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <article className="max-w-2xl">
          <h1 className="display text-[clamp(2.8rem,2rem+3vw,4.8rem)]">{title}</h1>
          <p className="mt-5 text-sm text-muted-2">Last updated {updated}</p>
          <div className="hr-glow mt-10 opacity-60" aria-hidden="true" />
          <div className="prose-sloka mt-4 text-[1.04rem] leading-relaxed">{children}</div>
        </article>
      </div>
    </section>
  );
}
