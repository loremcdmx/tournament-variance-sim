/** Shuts a disclosure menu. `restoreFocus` is for closes the keyboard made: the
 *  focused item goes away with the menu, and focus would otherwise fall to <body>. */
export function closeMenu(
  setOpen: (open: boolean) => void,
  trigger: Pick<HTMLElement, "focus"> | null,
  restoreFocus: boolean,
): void {
  setOpen(false);
  if (restoreFocus) trigger?.focus();
}
