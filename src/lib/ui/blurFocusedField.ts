const FORM_FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// A field still holding focus has not committed its draft, and a disabled
// fieldset drops focus without firing blur, so anything that snapshots the
// editors (Run, Save preset) blurs the focused field first.
export function blurFocusedField(doc: Pick<Document, "activeElement">): void {
  const active = doc.activeElement;
  if (active && FORM_FIELD_TAGS.has(active.tagName)) (active as HTMLElement).blur();
}
