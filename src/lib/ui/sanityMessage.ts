import { fmt } from "@/lib/results/formatters";

// The row label is free text: a "$&" or "$$" in it must reach the screen as typed.
export function sanityMessage(template: string, rowLabel?: string): string {
  return rowLabel ? fmt(template, { row: rowLabel }) : template;
}
