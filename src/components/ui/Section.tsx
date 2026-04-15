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
  /** Optional DOM id on the section wrapper for scroll-into-view anchors. */
  anchorId?: string;
}

export function Section({
  title,
  subtitle,
  children,
  actions,
  number,
  suit = "club",
  anchorId,
}: Props) {
  const meta = SUIT_META[suit];
  return (
    <section id={anchorId} className="flex flex-col gap-6 scroll-mt-24">
      {/* Editorial masthead: numeral / eyebrow / title sit on one baseline,
          with a heavy double-rule divider beneath. */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-5">
            {number && (
              <span
                className="section-num text-[64px] sm:text-[92px]"
                style={{ color: meta.colorVar }}
                aria-hidden
              >
                {number}
              </span>
            )}
            <div className="flex flex-col gap-1 pb-1">
              <div
                className="eyebrow flex items-center gap-2"
                style={{ color: meta.colorVar }}
              >
                <span className="text-[12px] leading-none">{meta.glyph}</span>
                <span>/ {title}</span>
              </div>
              <h2 className="text-[22px] font-bold uppercase leading-[1.05] tracking-[-0.01em] text-[color:var(--color-fg)] sm:text-[28px]">
                {title}
              </h2>
              {subtitle && (
                <p className="mt-0.5 max-w-xl text-[12px] leading-relaxed text-[color:var(--color-fg-muted)]">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {actions && <div className="pb-1">{actions}</div>}
        </div>
        <div
          className="masthead-rule"
          style={{ color: meta.colorVar }}
        />
      </header>
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
        "relative border-t-[2px] border-x border-b border-t-[color:var(--color-fg)]/70 border-x-[color:var(--color-border)] border-b-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]/60 " +
        className
      }
    >
      {children}
    </div>
  );
}
