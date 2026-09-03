import type { Locale } from "./dict";

/** BCP-47 tag for `Number#toLocaleString` so digit grouping follows the UI locale, not the browser's. */
export function numberLocaleTag(locale: Locale): "ru-RU" | "en-US" {
  return locale === "ru" ? "ru-RU" : "en-US";
}
