/**
 * True under `npm run dev`. Sections waiting on content from Sloka Academy show a
 * placeholder there, and are left out of the built site entirely.
 */
export const devPreview = process.env.NODE_ENV === "development";

/** Development-only note listing the content a section still needs. Renders nothing in the built site. */
export function Pending({ needs, file }: { needs: string[]; file: string }) {
  if (!devPreview) return null;
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-red/50 bg-red/[0.04] p-6 sm:p-8">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-red-hi">
        To be confirmed · shown in development only
      </p>
      <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[0.95rem] text-muted">
        {needs.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p className="mt-5 font-mono text-xs text-muted-2">Add it in {file}</p>
    </div>
  );
}
