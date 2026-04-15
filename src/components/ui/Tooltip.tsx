"use client";

import { Fragment, useState } from "react";

interface Props {
  content: React.ReactNode;
  children: React.ReactNode;
}

export function InfoTooltip({ content }: { content: React.ReactNode }) {
  return (
    <Tooltip content={content}>
      <span
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[color:var(--color-border-strong)] text-[10px] font-bold text-[color:var(--color-fg-dim)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        aria-label="help"
      >
        ?
      </span>
    </Tooltip>
  );
}

// Highlighted paragraph prefixes — first capture the lead label ("Example:",
// "Пример:", "Effect:", "Эффект:", "Options:", "Опции:", "Note:", "Важно:")
// and style it in accent. Works for both EN and RU dict strings.
const LABEL_RE = /^([A-ZА-ЯЁ][\p{L}\s-]{1,20}:)\s*/u;

function renderTooltipBody(content: React.ReactNode): React.ReactNode {
  if (typeof content !== "string") return content;
  const paragraphs = content.split(/\n\n+/);
  return (
    <div className="flex flex-col gap-2">
      {paragraphs.map((p, i) => {
        const m = p.match(LABEL_RE);
        if (m) {
          const rest = p.slice(m[0].length);
          return (
            <p key={i} className="leading-relaxed">
              <span className="mr-1 font-semibold uppercase tracking-wider text-[10px] text-[color:var(--color-accent)]">
                {m[1]}
              </span>
              <span className="text-[color:var(--color-fg-muted)]">
                {renderInline(rest)}
              </span>
            </p>
          );
        }
        return (
          <p
            key={i}
            className={
              i === 0
                ? "leading-relaxed text-[color:var(--color-fg)]"
                : "leading-relaxed text-[color:var(--color-fg-muted)]"
            }
          >
            {renderInline(p)}
          </p>
        );
      })}
    </div>
  );
}

// Inline formatting: split on single newlines into soft breaks, and highlight
// inline code spans wrapped in backticks or quoted literals like "50+5".
function renderInline(text: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, li) => (
    <Fragment key={li}>
      {li > 0 && <br />}
      {highlightTokens(line)}
    </Fragment>
  ));
}

function highlightTokens(line: string): React.ReactNode {
  // Match `code`, "quoted", or numeric+% tokens so they pop as data.
  const parts: React.ReactNode[] = [];
  const re = /(`[^`]+`|"[^"]+"|«[^»]+»|\b[+-]?\d+(?:\.\d+)?%?)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    const tok = m[0];
    const clean = tok.replace(/^[`"«]|[`"»]$/g, "");
    parts.push(
      <code
        key={`t${i++}`}
        className="rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/60 px-1 py-px font-mono text-[10.5px] text-[color:var(--color-fg)]"
      >
        {clean}
      </code>,
    );
    last = m.index + tok.length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

export function Tooltip({ content, children }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-80 max-w-[85vw] -translate-x-1/2 border-t-2 border-x border-b border-t-[color:var(--color-accent)] border-x-[color:var(--color-border-strong)] border-b-[color:var(--color-border-strong)] bg-[color:var(--color-bg-elev-2)] px-3.5 py-3 text-left text-[11.5px] font-normal leading-relaxed text-[color:var(--color-fg-muted)] shadow-[0_20px_40px_-12px_rgba(0,0,0,0.85)]"
        >
          {renderTooltipBody(content)}
        </span>
      )}
    </span>
  );
}
