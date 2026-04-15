"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";
import { useLocalStorageState } from "@/lib/ui/useLocalStorageState";
import {
  STANDARD_PRESETS,
  applyModelPatch,
  extractModelPatch,
  loadUserPresets,
  saveUserPresets,
  addUserPreset,
  deleteUserPreset,
  exportPresetToFile,
  parsePresetFile,
  type UserPreset,
} from "@/lib/sim/modelPresets";
import type { DictKey } from "@/lib/i18n/dict";
import type { ControlsState } from "./ControlsPanel";

interface Props {
  value: ControlsState;
  onChange: (next: ControlsState) => void;
}

export function ModelPresetSelector({ value, onChange }: Props) {
  const t = useT();
  const { advanced } = useAdvancedMode();
  const [userPresets, setUserPresets] = useLocalStorageState<UserPreset[]>(
    "tvs.userPresets.v1",
    loadUserPresets,
    saveUserPresets,
    [],
  );
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeStd = STANDARD_PRESETS.find((p) => p.id === value.modelPresetId);
  const activeUser = userPresets.find((p) => p.id === value.modelPresetId);
  const activeLabel = activeStd
    ? t(activeStd.labelKey)
    : activeUser
      ? activeUser.name
      : t("preset.custom.label");

  const pickStandard = (id: string) => {
    const p = STANDARD_PRESETS.find((x) => x.id === id);
    if (!p) return;
    onChange(applyModelPatch(value, p.patch, p.id));
    setOpen(false);
  };

  const pickUser = (u: UserPreset) => {
    onChange(applyModelPatch(value, u.patch, u.id));
    setOpen(false);
  };

  const handleSaveCurrent = () => {
    const name = window.prompt(t("preset.savePrompt"));
    if (!name) return;
    const created = addUserPreset(name, extractModelPatch(value));
    setUserPresets(loadUserPresets());
    onChange({ ...value, modelPresetId: created.id });
  };

  const handleExport = () => {
    const name = activeStd
      ? t(activeStd.labelKey)
      : activeUser
        ? activeUser.name
        : t("preset.custom.label");
    exportPresetToFile(name, extractModelPatch(value));
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    const parsed = parsePresetFile(text);
    if (!parsed) {
      window.alert(t("preset.importInvalid"));
      return;
    }
    const created = addUserPreset(parsed.name, parsed.patch);
    setUserPresets(loadUserPresets());
    onChange(applyModelPatch(value, parsed.patch, created.id));
  };

  const handleDelete = (id: string, name: string) => {
    if (!window.confirm(t("preset.deleteConfirm").replace("{name}", name))) return;
    deleteUserPreset(id);
    const next = loadUserPresets();
    setUserPresets(next);
    if (value.modelPresetId === id) {
      onChange({ ...value, modelPresetId: "custom" });
    }
  };

  // Close the dropdown on outside click so it doesn't steal layout space.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative flex h-full flex-col gap-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] p-3"
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--color-fg-dim)]">
          {t("preset.label")}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 truncate rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-left hover:border-[color:var(--color-accent)]"
        >
          <span className="truncate text-sm font-semibold text-[color:var(--color-fg)]">
            {activeLabel}
          </span>
          <span className="shrink-0 text-[color:var(--color-fg-dim)]">▾</span>
        </button>
        {advanced && (
        <button
          type="button"
          onClick={handleSaveCurrent}
          title={t("preset.saveCurrent")}
          aria-label={t("preset.saveCurrent")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
        </button>
        )}
        {advanced && (
        <button
          type="button"
          onClick={handleExport}
          title={t("preset.export")}
          aria-label={t("preset.export")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        )}
        {advanced && (<>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title={t("preset.import")}
          aria-label={t("preset.import")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImportFile(f);
            e.target.value = "";
          }}
        />
        </>)}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[28rem] overflow-auto rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] p-3 shadow-lg">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            {t("preset.standard")}
          </div>
          <div className="flex flex-col gap-1">
            {STANDARD_PRESETS.filter((p) => advanced || p.id !== "loremcdmx").map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pickStandard(p.id)}
                className={`flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors ${
                  value.modelPresetId === p.id
                    ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/5"
                    : "border-[color:var(--color-border)] bg-[color:var(--color-bg)] hover:border-[color:var(--color-accent)]/60"
                }`}
              >
                <span className="text-sm font-semibold text-[color:var(--color-fg)]">
                  {t(p.labelKey)}
                </span>
                <span className="text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
                  {t(p.taglineKey)}
                </span>
              </button>
            ))}
          </div>
          <div className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            {t("preset.userList")}
          </div>
          <div className="flex flex-col gap-1">
            {userPresets.length === 0 && (
              <div className="text-[11px] italic text-[color:var(--color-fg-dim)]">
                {t("preset.userEmpty")}
              </div>
            )}
            {userPresets.map((u) => (
              <div
                key={u.id}
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                  value.modelPresetId === u.id
                    ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/5"
                    : "border-[color:var(--color-border)] bg-[color:var(--color-bg)]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => pickUser(u)}
                  className="flex-1 text-left text-sm text-[color:var(--color-fg)] hover:text-[color:var(--color-accent)]"
                >
                  {u.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(u.id, u.name)}
                  className="text-[10px] uppercase text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-danger)]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// re-export for convenience
export type { DictKey };
