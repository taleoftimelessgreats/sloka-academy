"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { VISIBLE_DOMAINS } from "@/data/domains";
import { STREAMS, isStreamId, streamLabel, type StreamId } from "@/data/streams";
import { filterDomains } from "@/lib/search";
import { Icon } from "./Icon";
import { DomainCard } from "./ui";

function readUrl(params: { get(name: string): string | null }) {
  const stream = params.get("stream");
  return { query: params.get("q") ?? "", stream: isStreamId(stream) ? stream : null };
}

function buildSearch(query: string, stream: StreamId | null) {
  const params = new URLSearchParams();
  if (stream) params.set("stream", stream);
  if (query.trim()) params.set("q", query);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function SearchField({
  id = "domain-search",
  value,
  onChange,
}: {
  id?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        Search domains
      </label>
      <Icon name="search" size={20} className="pointer-events-none absolute left-6 top-1/2 z-10 -translate-y-1/2 text-muted" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={!onChange}
        placeholder="Search domains"
        autoComplete="off"
        className="glass h-16 w-full !rounded-full pl-14 pr-6 text-lg outline-none transition-shadow placeholder:text-muted-2 focus:border-red/60 focus:shadow-[0_0_0_4px_rgb(227_20_27/0.15),0_0_40px_-10px_var(--glow)]"
      />
    </div>
  );
}

/**
 * Domain search + stream filter. Runs entirely in the browser.
 * State lives in the URL (?stream=&q=) so refreshes, shared links and the
 * browser Back button restore the same view.
 */
export function DomainCatalogue() {
  const searchParams = useSearchParams();
  const urlKey = searchParams.toString();
  const initial = readUrl(searchParams);

  const [query, setQuery] = useState(initial.query);
  const [stream, setStream] = useState<StreamId | null>(initial.stream);
  const [syncedKey, setSyncedKey] = useState(urlKey);

  // Adopt URL changes we didn't make ourselves (e.g. footer stream links, Back).
  if (urlKey !== syncedKey) {
    setSyncedKey(urlKey);
    setQuery(initial.query);
    setStream(initial.stream);
  }

  function commit(nextQuery: string, nextStream: StreamId | null) {
    setQuery(nextQuery);
    setStream(nextStream);
    const search = buildSearch(nextQuery, nextStream);
    setSyncedKey(search.replace(/^\?/, ""));
    window.history.replaceState(null, "", `${window.location.pathname}${search}`);
  }

  const results = filterDomains(VISIBLE_DOMAINS, query, stream);
  const filtered = Boolean(stream || query.trim());

  return (
    <div>
      <div className="max-w-2xl">
        <SearchField value={query} onChange={(v) => commit(v, stream)} />
      </div>

      <div role="group" aria-label="Filter by stream" className="mt-8">
        {/* On phones the row scrolls edge to edge: the scroller bleeds into the page padding. */}
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {STREAMS.map((s) => {
            const active = stream === s.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                onClick={() => commit(query, active ? null : s.id)}
                className="chip"
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-12 flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-5">
        <p role="status" aria-live="polite" className="text-[0.95rem] text-muted">
          <span className="display mr-2 text-3xl text-text">{results.length}</span>
          {results.length === 1 ? "domain" : "domains"}
          {stream && <> in {streamLabel(stream)}</>}
          {query.trim() && <> matching “{query.trim()}”</>}
        </p>
        {filtered && (
          <button type="button" onClick={() => commit("", null)} className="link-glow text-sm !text-red-hi">
            Clear Filters
          </button>
        )}
      </div>

      {results.length > 0 ? (
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((domain) => (
            <li key={domain.id}>
              <DomainCard domain={domain} headingLevel="h2" index={VISIBLE_DOMAINS.indexOf(domain)} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="glass mx-auto mt-10 max-w-xl px-8 py-16 text-center">
          <h2 className="display text-4xl">No matching domains</h2>
          <p className="mt-4 text-muted">
            Nothing fits that combination. Clear the filters, or tell us what you studied and we will suggest a domain.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <button type="button" onClick={() => commit("", null)} className="btn btn-red">
              Clear Filters
            </button>
            <Link href="/contact/" className="btn btn-glass">
              Ask admissions
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Server-rendered fallback: the full catalogue, shown before hydration and without JavaScript. */
export function DomainCatalogueFallback() {
  return (
    <div>
      <div className="max-w-2xl">
        <SearchField />
      </div>
      <div className="mt-8 flex flex-wrap gap-2" aria-hidden="true">
        {STREAMS.map((s) => (
          <span key={s.id} className="chip inline-flex items-center">
            {s.label}
          </span>
        ))}
      </div>
      <p className="mt-12 border-b border-line pb-5 text-[0.95rem] text-muted">
        <span className="display mr-2 text-3xl text-text">{VISIBLE_DOMAINS.length}</span>domains
      </p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {VISIBLE_DOMAINS.map((domain) => (
          <li key={domain.id}>
            <DomainCard domain={domain} headingLevel="h2" index={VISIBLE_DOMAINS.indexOf(domain)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
