export type StorageNotice = "ok" | "failed" | "dismissed";

// An autosave the browser refuses is refused again on the next edit; once the
// user has dismissed the notice it stays down until a save lands.
export function nextStorageNotice(prev: StorageNotice, saved: boolean): StorageNotice {
  if (saved) return "ok";
  return prev === "dismissed" ? "dismissed" : "failed";
}
