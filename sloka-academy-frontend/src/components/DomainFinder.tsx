"use client";

import Link from "next/link";
import { useState } from "react";
import { VISIBLE_DOMAINS } from "@/data/domains";
import { STREAMS, streamLabel, type StreamId } from "@/data/streams";
import { filterDomains } from "@/lib/search";
import { SearchField } from "./DomainCatalogue";
import { Icon } from "./Icon";

/**
 * Home page domain finder: stream buttons plus a searchable list of every
 * domain. Same search rules as the Domains page, but the state stays on the
 * page instead of the URL.
 */
export function DomainFinder() {
  const [query, setQuery] = useState("");
  const [stream, setStream] = useState<StreamId | null>(null);

  const results = filterDomains(VISIBLE_DOMAINS, query, stream);
  const filtered = Boolean(stream || query.trim());

  return (
    <div>
      <div className="max-w-2xl">
        <SearchField id="home-domain-search" value={query} onChange={setQuery} />
      </div>

      <div role="group" aria-label="Filter by stream" className="-mx-5 mt-8 px-5 sm:mx-0 sm:px-0">
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
          {STREAMS.map((s) => {
            const active = stream === s.id;
            return (
              <button key={s.id} type="button" aria-pressed={active} onClick={() => setStream(active ? null : s.id)} className="chip">
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-5">
        <p role="status" aria-live="polite" className="text-[0.95rem] text-muted">
          <span className="display mr-2 text-3xl text-text">{results.length}</span>
          {results.length === 1 ? "domain" : "domains"}
          {stream && <> in {streamLabel(stream)}</>}
          {query.trim() && <> matching “{query.trim()}”</>}
        </p>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setStream(null);
            }}
            className="link-glow text-sm !text-red-hi"
          >
            Clear Filters
          </button>
        )}
      </div>

      {results.length > 0 ? (
        <ul className="grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((d) => (
            <li key={d.id} className="border-b border-line">
              <Link href={`/domains/${d.id}/`} className="group flex items-center justify-between gap-4 py-4">
                <span>
                  <span className="block font-medium transition-colors group-hover:text-red-hi">{d.name}</span>
                  <span className="block text-xs text-muted-2">{d.category}</span>
                </span>
                <Icon name="arrowUpRight" size={16} className="shrink-0 text-muted-2 transition-colors group-hover:text-red-hi" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-8 text-muted">
          Nothing fits that combination. Clear the filters, or{" "}
          <Link href="/contact/" className="text-text underline underline-offset-4">
            ask admissions
          </Link>{" "}
          to suggest a domain for your background.
        </p>
      )}
    </div>
  );
}
