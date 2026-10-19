/**
 * The PrimeDope overlay series on the histogram cards. `color` is the series
 * colour for the swatch and the canvas line; `textColor` is the legend and
 * tooltip text, a theme token because a hex has one value in both themes and
 * read 2.0-2.5:1 on the light card.
 */
export const OVERLAY_SERIES = {
  blue: { color: "#60a5fa", textColor: "var(--c-pd-theirs-fg)" },
  pink: { color: "#f472b6", textColor: "var(--c-overlay-pink-fg)" },
  sky: { color: "#38bdf8", textColor: "var(--c-overlay-sky-fg)" },
  fuchsia: { color: "#e879f9", textColor: "var(--c-overlay-fuchsia-fg)" },
} as const;
