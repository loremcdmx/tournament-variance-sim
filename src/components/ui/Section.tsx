type Suit = "spade" | "heart" | "diamond" | "club";

const SUIT_META: Record<
  Suit,
  { glyph: string; colorVar: string }
> = {
  spade: { glyph: "♠", colorVar: "var(--color-spade)" },
  heart: { glyph: "♥", colorVar: "var(--color-heart)" },
  diamond: { glyph: "♦", colorVar: "var(--color-diamond)" },
  club: { glyph: "♣", colorVar: "var(--color-club)" },
};

interface Props {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** Editorial section number — rendered as big mono numeral in the gutter. */
  number?: string;
  /** Suit accent — drives the color of the number, eyebrow, and underline. */
  suit?: Suit;
}

export function Section({
  title,
  subtitle,
  children,
  actions,
  number,
  suit = "club",
}: Props) {
  const meta = SUIT_META[suit];
  return (
    <section className="flex flex-col gap-5">
      <div
        className="flex flex-wrap items-end justify-between gap-3 border-b pb-3"
        style={{ borderColor: meta.colorVar + "66" }}
      >
        <div className="flex items-baseline gap-4">
          {number && (
            <span
              className="section-num text-3xl leading-none sm:text-5xl"
              style={{ color: meta.colorVar }}
            >
              {number}
            </span>
          )}
          <div>
            <div
              className="eyebrow mb-1 flex items-center gap-1.5"
              style={{ color: meta.colorVar }}
            >
              <span className="text-[11px]">{meta.glyph}</span>
              <span>/ {title.toLowerCase()}</span>
            </div>
            <h2 className="text-xl font-bold uppercase tracking-tight text-[color:var(--color-fg)] sm:text-2xl">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-[color:var(--color-fg-muted)]">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]/90 shadow-[0_0_0_1px_rgba(96,165,250,0.03)_inset,0_20px_40px_-24px_rgba(0,0,0,0.55)] " +
        className
      }
    >
      {children}
    </div>
  );
}
