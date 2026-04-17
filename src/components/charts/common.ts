import type { Options } from "uplot";

// Journal-figure axis chrome — warm graphite that sits legibly on both
// cream paper and oscilloscope dark. uPlot takes literal strings so we
// can't pipe CSS vars; these tones are tuned to the midpoint of both
// palettes' fg-muted values.
const AXIS_STROKE = "#7a7466";
const GRID_STROKE = "rgba(120, 112, 96, 0.22)";
const TICK_STROKE = "rgba(120, 112, 96, 0.35)";

export const darkAxes: Options["axes"] = [
  {
    stroke: AXIS_STROKE,
    grid: { stroke: GRID_STROKE, width: 0.5 },
    ticks: { stroke: TICK_STROKE, width: 0.5 },
  },
  {
    stroke: AXIS_STROKE,
    grid: { stroke: GRID_STROKE, width: 0.5 },
    ticks: { stroke: TICK_STROKE, width: 0.5 },
  },
];
