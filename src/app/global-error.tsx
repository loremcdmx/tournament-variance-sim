"use client";

import "./globals.css";
import { ErrorScreen } from "@/components/ErrorScreen";

// Replaces the root layout when it throws, so it owns <html>/<body>. Fonts
// from the layout are unavailable here; globals.css falls back to system-ui.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="ru" data-theme="dark" className="h-full">
      <body className="min-h-full">
        <ErrorScreen error={error} />
      </body>
    </html>
  );
}
