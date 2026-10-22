import type { Domain } from "@/data/domains";
import { STREAMS, type StreamId } from "@/data/streams";

/** Lowercase and collapse punctuation so "AI/ML", "ai-ml" and "AIML" compare equal. */
export function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9+#]+/g, "");
}

function searchText(domain: Domain): string[] {
  const streamTerms = domain.streams.flatMap((id) => {
    const stream = STREAMS.find((s) => s.id === id)!;
    return [stream.label, ...stream.aliases];
  });
  return [domain.name, domain.category, ...domain.aliases, ...streamTerms].map(compact);
}

/** Search (case-insensitive, alias-aware) AND stream filter. */
export function filterDomains(
  domains: Domain[],
  query: string,
  stream: StreamId | null,
): Domain[] {
  const q = compact(query);
  return domains.filter((domain) => {
    if (stream && !domain.streams.includes(stream)) return false;
    if (!q) return true;
    return searchText(domain).some((term) => term.includes(q));
  });
}
