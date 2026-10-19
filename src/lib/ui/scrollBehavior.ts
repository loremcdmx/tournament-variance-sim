/** `smooth` unless the user asked their system for less motion, in which case the jump is instant. */
export function preferredScrollBehavior(
  win: Pick<Window, "matchMedia"> | null | undefined,
): ScrollBehavior {
  try {
    return win?.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  } catch {
    return "smooth";
  }
}
