"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import {
  STANDARD_PRESETS,
  applyModelPatch,
  extractModelPatch,
  loadUserPresets,
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
  const [userPresets, setUserPresets] = useState<UserPreset[]>([]);
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setUserPresets(loadUserPresets());
  }, []);

  const activeStd = STANDARD_PRESETS.find((p) => p.id === value.modelPresetId);
  const activeUser = userPresets.find((p) => p.id === value.modelPresetId);
  const activeLabel = activeStd
    ? t(activeStd.labelKey)
    : activeUser
      ? activeUser.name
      : t("preset.custom.label");
  const activeTagline = activeStd
    ? t(activeStd.taglineKey)
    : activeUser
      ? t("preset.user.tagline")
      : t("preset.custom.tagline");

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

  return (
    <div className="mb-4 border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--color-fg-dim)]">
          {t("preset.label")}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-[14rem] flex-1 items-center justify-between gap-3 border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-left hover:border-[color:var(--color-accent)]"
        >
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-[color:var(--color-fg)]">
              {activeLabel}
            </span>
            <span className="text-[11px] text-[color:var(--color-fg-dim)]">
              {activeTagline}
            </span>
          </span>
          <span className="text-[color:var(--color-fg-dim)]">▾</span>
        </button>
        <button
          type="button"
          onClick={handleSaveCurrent}
          className="border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        >
          {t("preset.saveCurrent")}
        </button>
        <button
          type="button"
          onClick={handleExport}
          className="border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        >
          {t("preset.export")}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
        >
          {t("preset.import")}
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
      </div>

      {open && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
              {t("preset.standard")}
            </div>
            <div className="flex flex-col gap-1">
              {STANDARD_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickStandard(p.id)}
                  className={`flex flex-col items-start border px-3 py-2 text-left transition-colors ${
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
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
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
                  className={`flex items-center gap-2 border px-2 py-1.5 ${
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
        </div>
      )}
    </div>
  );
}

// re-export for convenience
export type { DictKey };
