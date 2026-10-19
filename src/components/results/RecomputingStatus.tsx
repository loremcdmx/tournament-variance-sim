// The live region is always in the page and only its content comes and goes: a
// region that is added together with its text is not reliably announced, and one
// whose text is only faded out (opacity 0) is read aloud while nothing is happening.
export function RecomputingStatus({ active, label }: { active: boolean; label: string }) {
  return (
    <div
      className="flex min-h-4 items-center gap-1.5 text-[11px] text-[color:var(--color-fg-muted)]"
      role="status"
    >
      {active && (
        <>
          <span
            className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-400 motion-reduce:animate-none"
            aria-hidden
          />
          <span className="uppercase tracking-wider text-[color:var(--c-indigo-label)]">{label}</span>
        </>
      )}
    </div>
  );
}
