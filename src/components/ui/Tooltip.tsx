"use client";

import { useState } from "react";

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
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-80 max-w-[85vw] -translate-x-1/2 whitespace-pre-line rounded-lg border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5 text-left text-[11px] font-normal leading-relaxed text-[color:var(--color-fg-muted)] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]"
        >
          {content}
        </span>
      )}
    </span>
  );
}
