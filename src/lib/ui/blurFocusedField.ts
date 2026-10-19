const FORM_FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// A field still holding focus has not committed its draft, and a disabled
// fieldset drops focus without firing blur, so anything that snapshots the
// editors (Run, Save preset) blurs the focused field first. The field it blurred
// is returned so the caller can give focus back.
export function blurFocusedField(doc: Pick<Document, "activeElement">): HTMLElement | null {
  const active = doc.activeElement;
  if (!active || !FORM_FIELD_TAGS.has(active.tagName)) return null;
  (active as HTMLElement).blur();
  return active as HTMLElement;
}

// While a run goes the editors sit in a disabled fieldset, so a keyboard user who
// started it from a field (Cmd/Ctrl+Enter) would land on <body> with the page's tab
// order restarting from the top. Once the fieldset is live again focus goes back to
// that field, unless the user has already put it somewhere else or the field is gone.
export function restoreFocusedField(
  doc: Pick<Document, "activeElement" | "body">,
  field: HTMLElement | null,
): boolean {
  if (!field || !field.isConnected || (field as HTMLInputElement).disabled) return false;
  const active = doc.activeElement;
  if (active && active !== doc.body) return false;
  field.focus({ preventScroll: true });
  return true;
}
