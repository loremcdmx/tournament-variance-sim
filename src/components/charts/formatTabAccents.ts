import type { ConvergenceFormat } from "@/lib/sim/convergenceMath";

export const FORMAT_TAB_ACCENTS: Record<
  ConvergenceFormat,
  { text: string; border: string; bg: string; rail: string }
> = {
  freeze: {
    text: "var(--c-tab-freeze-fg)",
    border: "rgba(167,139,250,0.42)",
    bg: "rgba(139,92,246,0.18)",
    rail: "rgba(196,181,253,0.85)",
  },
  pko: {
    text: "var(--c-tab-pko-fg)",
    border: "rgba(251,113,133,0.42)",
    bg: "rgba(251,113,133,0.16)",
    rail: "rgba(253,164,175,0.88)",
  },
  "ocean-ko": {
    text: "var(--c-tab-ocean-ko-fg)",
    border: "rgba(45,212,191,0.42)",
    bg: "rgba(20,184,166,0.16)",
    rail: "rgba(94,234,212,0.9)",
  },
  mystery: {
    text: "var(--c-tab-mystery-fg)",
    border: "rgba(56,189,248,0.42)",
    bg: "rgba(14,165,233,0.16)",
    rail: "rgba(125,211,252,0.9)",
  },
  "mystery-royale": {
    text: "var(--c-tab-mystery-royale-fg)",
    border: "rgba(245,158,11,0.45)",
    bg: "rgba(245,158,11,0.16)",
    rail: "rgba(252,211,77,0.9)",
  },
  mix: {
    text: "var(--c-tab-mix-fg)",
    border: "rgba(52,211,153,0.42)",
    bg: "rgba(16,185,129,0.16)",
    rail: "rgba(110,231,183,0.9)",
  },
  exact: {
    text: "var(--c-tab-exact-fg)",
    border: "rgba(74,222,128,0.42)",
    bg: "rgba(34,197,94,0.16)",
    rail: "rgba(134,239,172,0.9)",
  },
};
