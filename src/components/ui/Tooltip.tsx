"use client";

import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/LocaleProvider";

interface Props {
  content: React.ReactNode;
  children: React.ReactNode;
  label: string;
}

export function InfoTooltip({ content }: { content: React.ReactNode }) {
  const t = useT();
  return (
    <Tooltip content={content} label={t("help.trigger")}>
      <span
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[color:var(--color-border-strong)] text-[10px] font-bold text-[color:var(--color-fg-dim)] transition-colors group-hover:border-[color:var(--color-accent)] group-hover:text-[color:var(--color-accent)] group-focus-visible:border-[color:var(--color-accent)] group-focus-visible:text-[color:var(--color-accent)]"
        aria-hidden="true"
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
  // The tooltip's outer element is a <span>; any <div>/<p> here would be
  // block-level and cause the browser to auto-close the span, dropping the
  // width/max-width constraints and letting text escape the container.
  // Keep everything as <span> with explicit block display.
  return (
    <span className="flex flex-col gap-2 whitespace-normal break-words normal-case tracking-normal [overflow-wrap:anywhere]">
      {paragraphs.map((p, i) => {
        const m = p.match(LABEL_RE);
        if (m) {
          const rest = p.slice(m[0].length);
          return (
            <span
              key={i}
              className="block whitespace-normal break-words leading-relaxed [overflow-wrap:anywhere]"
            >
              <span className="mr-1 font-semibold uppercase tracking-wider text-[10px] text-[color:var(--color-accent)]">
                {m[1]}
              </span>
              <span className="whitespace-normal break-words text-[color:var(--color-fg-muted)] [overflow-wrap:anywhere]">
                {renderInline(rest)}
              </span>
            </span>
          );
        }
        return (
          <span
            key={i}
            className={
              i === 0
                ? "block whitespace-normal break-words leading-relaxed text-[color:var(--color-fg)] [overflow-wrap:anywhere]"
                : "block whitespace-normal break-words leading-relaxed text-[color:var(--color-fg-muted)] [overflow-wrap:anywhere]"
            }
          >
            {renderInline(p)}
          </span>
        );
      })}
    </span>
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
        className="inline-block max-w-full whitespace-normal break-words rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/60 px-1 py-px font-mono text-[10.5px] text-[color:var(--color-fg)] [overflow-wrap:anywhere]"
      >
        {clean}
      </code>,
    );
    last = m.index + tok.length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

export function Tooltip({ content, children, label }: Props) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const pointerFocusRef = useRef(false);
  const tooltipId = useId();
  const open = hovered || pinned;

  useLayoutEffect(() => {
    if (!open) return;

    const measure = () => {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;

      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const margin = 8;
      const maxLeft = Math.max(
        margin,
        window.innerWidth - margin - tooltipRect.width,
      );
      const centeredLeft =
        triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
      const left = Math.min(Math.max(margin, centeredLeft), maxLeft);
      const topAbove = triggerRect.top - tooltipRect.height - 8;
      const topBelow = triggerRect.bottom + 8;
      const maxTop = Math.max(
        margin,
        window.innerHeight - margin - tooltipRect.height,
      );
      const top =
        topAbove >= margin
          ? topAbove
          : Math.min(Math.max(margin, topBelow), maxTop);

      setCoords((current) =>
        current &&
        Math.abs(current.left - left) < 0.5 &&
        Math.abs(current.top - top) < 0.5
          ? current
          : { left, top },
      );
    };

    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      // Stale coordinates would flash the tooltip at its previous anchor for
      // one frame the next time it opens.
      setCoords(null);
    };
  }, [open]);

  const close = () => {
    setHovered(false);
    setPinned(false);
  };

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // Touch users have no blur to rely on, so a tap anywhere else dismisses.
    const onPointerDownAway = (e: PointerEvent) => {
      if (!triggerRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDownAway, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDownAway, true);
    };
  }, [open]);

  return (
    <button
      ref={triggerRef}
      type="button"
      data-tooltip-trigger="true"
      className="group relative inline-flex focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
      aria-label={label}
      aria-describedby={open ? tooltipId : undefined}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setHovered(false);
      }}
      // Pointer activation focuses the trigger before the click lands; without
      // this flag the focus-open and the click-toggle would cancel each other.
      onPointerDown={() => {
        pointerFocusRef.current = true;
      }}
      onClick={() => {
        pointerFocusRef.current = false;
        setPinned((v) => !v);
      }}
      onFocus={() => {
        if (!pointerFocusRef.current) setPinned(true);
      }}
      onBlur={() => {
        pointerFocusRef.current = false;
        close();
      }}
    >
      {children}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none fixed z-50 max-h-[min(60vh,28rem)] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto whitespace-normal break-words border-t-2 border-x border-b border-t-[color:var(--color-accent)] border-x-[color:var(--color-border-strong)] border-b-[color:var(--color-border-strong)] bg-[color:var(--color-bg-elev-2)] px-3.5 py-3 text-left text-[11.5px] font-normal normal-case leading-relaxed tracking-normal text-[color:var(--color-fg-muted)] shadow-[0_20px_40px_-12px_rgba(0,0,0,0.85)] [overflow-wrap:anywhere]"
            style={{
              left: coords?.left ?? 0,
              top: coords?.top ?? 0,
              visibility: coords ? "visible" : "hidden",
              overflowWrap: "anywhere",
              whiteSpace: "normal",
            }}
          >
            {renderTooltipBody(content)}
          </span>,
          document.body,
        )}
    </button>
  );
}
