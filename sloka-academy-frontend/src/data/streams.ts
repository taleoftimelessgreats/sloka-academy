/**
 * Stream filter buttons, in the order they appear above the domain grid.
 * `id` is used in the page URL (?stream=<id>).
 */
export const STREAMS = [
  { id: "computer-science", label: "Computer Science", aliases: ["cs", "cse", "it", "computers"] },
  { id: "management", label: "Management", aliases: ["mba", "bba"] },
  { id: "pharmacy", label: "Pharmacy", aliases: ["b pharm", "m pharm", "pharm d", "pharma"] },
  { id: "life-sciences", label: "Life Sciences", aliases: ["biotech", "biotechnology", "biology", "microbiology"] },
  { id: "civil", label: "Civil Engineering", aliases: ["civil"] },
  { id: "mechanical", label: "Mechanical Engineering", aliases: ["mech", "mechanical"] },
  { id: "electronics", label: "Electronics", aliases: ["ece", "electronics and communication"] },
  { id: "eee", label: "Electrical and Electronics Engineering (EEE)", short: "EEE", aliases: ["eee", "electrical"] },
  { id: "commerce", label: "Commerce", aliases: ["bcom", "b com", "mcom"] },
  { id: "more", label: "More", aliases: ["interdisciplinary"] },
] as const;

export type StreamId = (typeof STREAMS)[number]["id"];

export const STREAM_IDS: readonly StreamId[] = STREAMS.map((s) => s.id);

export function isStreamId(value: string | null): value is StreamId {
  return value !== null && (STREAM_IDS as readonly string[]).includes(value);
}

export function streamLabel(id: StreamId): string {
  return STREAMS.find((s) => s.id === id)!.label;
}
