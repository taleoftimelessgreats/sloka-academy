import type { CSSProperties } from "react";

/** A card in the reviews marquee: a genuine published review, or a labelled sample. */
export type ReviewCard =
  | { kind: "review"; key: string; name: string; quote: string; source: string; rating?: number; published: string }
  | { kind: "sample"; key: string; name: string; quote: string; domain: string; detail: string };

/** Each copy of a row must be wider than the marquee window (max 1600px), so the loop never shows a gap. */
const MIN_CARDS_PER_COPY = 5;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

/** `repeat`: a copy that only fills the loop, hidden from screen readers (cards hold nothing focusable). */
function Card({ card, repeat = false }: { card: ReviewCard; repeat?: boolean }) {
  const genuine = card.kind === "review";
  return (
    <li className={`review-card ${genuine ? "" : "review-card-sample"}`} aria-hidden={repeat || undefined}>
      <figure className="flex h-full flex-col">
        <div className="flex min-h-6 items-center justify-between gap-3">
          {genuine ? (
            <>
              {card.rating ? (
                <span className="flex gap-0.5 text-red-hi" role="img" aria-label={`Rated ${card.rating} out of 5`}>
                  {Array.from({ length: card.rating }, (_, i) => (
                    <svg key={i} width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path fill="currentColor" d="m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3L12 17.1l-5.6 3 1.1-6.3L2.9 9.4l6.3-.9L12 2.8Z" />
                    </svg>
                  ))}
                </span>
              ) : (
                <span />
              )}
              <span className="review-tag review-tag-genuine">{card.source} review</span>
            </>
          ) : (
            <span className="review-tag review-tag-sample">
              Student testimonial<span className="sr-only">, written by Sloka Academy, not a review from a real student</span>
            </span>
          )}
        </div>
        <blockquote className="mt-4 flex-1 text-[0.95rem] leading-relaxed text-text/90">
          <p>&ldquo;{card.quote}&rdquo;</p>
        </blockquote>
        <figcaption className="mt-5 flex items-center gap-3">
          <span className={`review-avatar ${genuine ? "" : "review-avatar-sample"}`} aria-hidden="true">
            {initials(card.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{card.name}</span>
            <span className="block text-sm leading-snug text-muted">
              {genuine ? `Posted on ${card.source} · ${card.published}` : `${card.domain} · ${card.detail}`}
            </span>
          </span>
        </figcaption>
      </figure>
    </li>
  );
}

/**
 * Rows of review cards that scroll continuously, adjacent rows in opposite directions. Each row holds
 * two identical copies and moves by exactly one copy, so the loop is seamless. Hovering or focusing a
 * row pauses it. With reduced motion requested the rows become plain horizontally scrollable lists.
 */
export function ReviewMarquee({ rows }: { rows: ReviewCard[][] }) {
  return (
    <div className="reviews">
      <div className="mx-auto grid max-w-[1600px] gap-4">
        {rows.map((row, i) => {
          let copy = row;
          while (copy.length < MIN_CARDS_PER_COPY) copy = [...copy, ...row];
          return (
            <div
              key={i}
              className={`reviews-row ${i % 2 ? "reviews-row-reverse" : ""}`}
              style={{ "--reviews-duration": `${copy.length * 9 + i * 6}s` } as CSSProperties}
            >
              <div className="reviews-track">
                <ul className="reviews-list">
                  {copy.map((card, j) => (
                    <Card key={`${card.key}-${j}`} card={card} repeat={j >= row.length} />
                  ))}
                </ul>
                <ul className="reviews-list reviews-dup" aria-hidden="true">
                  {copy.map((card, j) => (
                    <Card key={`${card.key}-dup-${j}`} card={card} repeat />
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
