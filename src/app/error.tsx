"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

export default function ErrorPage({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return <ErrorScreen error={error} />;
}
