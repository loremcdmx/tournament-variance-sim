"use client";

import { useState, type ReactNode } from "react";

export function LazyDisclosure({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const [visited, setVisited] = useState(false);

  return (
    <details
      className="min-w-0 rounded-xl border border-border bg-bg-elev"
      onToggle={(event) => {
        if (event.currentTarget.open) setVisited(true);
      }}
    >
      <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:px-5">
        {title}
        {description && <span className="mt-1 block pl-4 text-xs font-normal text-fg-muted">{description}</span>}
      </summary>
      {visited && <div className="min-w-0 border-t border-border p-3 sm:p-4">{children}</div>}
    </details>
  );
}
