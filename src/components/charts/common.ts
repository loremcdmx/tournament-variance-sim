import type { Options } from "uplot";

// Neutral grey works on both dark and light themes without needing
// JS-side theme detection. uPlot takes raw strings, so we can't use
// CSS variables directly — pick tones that sit legibly on both palettes.
export const darkAxes: Options["axes"] = [
  {
    stroke: "#8a8a95",
    grid: { stroke: "rgba(128,128,128,0.15)" },
    ticks: { stroke: "rgba(128,128,128,0.2)" },
  },
  {
    stroke: "#8a8a95",
    grid: { stroke: "rgba(128,128,128,0.15)" },
    ticks: { stroke: "rgba(128,128,128,0.2)" },
  },
];
