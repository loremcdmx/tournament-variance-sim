"use client";

import { useState } from "react";
import type {
  FieldVariability,
  PayoutStructureId,
  TournamentRow,
} from "@/lib/sim/types";
import { parsePayoutString } from "@/lib/sim/payouts";
import { useT } from "@/lib/i18n/LocaleProvider";
import { Card } from "./ui/Section";
import { InfoTooltip } from "./ui/Tooltip";

const STRUCTURES: { id: PayoutStructureId; label: string }[] = [
  { id: "mtt-standard", label: "MTT · Standard (15% paid)" },
  { id: "mtt-flat", label: "MTT · Flat (20% paid)" },
  { id: "mtt-top-heavy", label: "MTT · Top-heavy (12% paid)" },
  { id: "mtt-pokerstars", label: "MTT · PokerStars-like" },
  { id: "mtt-gg", label: "MTT · GGPoker-like" },
  { id: "mtt-sunday-million", label: "MTT · Sunday Million (real)" },
  { id: "mtt-gg-bounty", label: "MTT · GG Bounty Builder (real)" },
  { id: "sng-50-30-20", label: "SNG · 50/30/20" },
  { id: "sng-65-35", label: "SNG · 65/35" },
  { id: "winner-takes-all", label: "Winner takes all" },
  { id: "custom", label: "Custom (paste %)" },
];

interface Props {
  schedule: TournamentRow[];
  onChange: (next: TournamentRow[]) => void;
}

export function ScheduleEditor({ schedule, onChange }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const update = (id: string, patch: Partial<TournamentRow>) => {
    onChange(schedule.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const remove = (id: string) => {
    onChange(schedule.filter((r) => r.id !== id));
  };
  const duplicate = (id: string) => {
    const row = schedule.find((r) => r.id === id);
    if (!row) return;
    const copy = { ...row, id: crypto.randomUUID() };
    const idx = schedule.findIndex((r) => r.id === id);
    const next = [...schedule];
    next.splice(idx + 1, 0, copy);
    onChange(next);
  };
  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };
  const add = () => {
    onChange([
      ...schedule,
      {
        id: crypto.randomUUID(),
        label: "",
        players: 500,
        buyIn: 10,
        rake: 0.1,
        roi: 0.2,
        payoutStructure: "mtt-standard",
        count: 1,
      },
    ]);
  };

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]/60 text-left text-[11px] font-medium uppercase tracking-wider text-[color:var(--color-fg-dim)]">
              <Th> </Th>
              <Th hint={t("help.row.label")}>{t("row.label")}</Th>
              <Th align="right" hint={t("help.row.players")}>{t("row.players")}</Th>
              <Th align="right" hint={t("help.row.buyIn")}>{t("row.buyIn")}</Th>
              <Th align="right" hint={t("help.row.rake")}>{t("row.rake")}</Th>
              <Th align="right" hint={t("help.row.roi")}>{t("row.roi")}</Th>
              <Th hint={t("help.row.payouts")}>{t("row.payouts")}</Th>
              <Th align="right" hint={t("help.row.count")}>{t("row.count")}</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((r, i) => {
              const isOpen = expanded.has(r.id);
              const hasAdv =
                !!r.guarantee ||
                (r.fieldVariability && r.fieldVariability.kind !== "fixed") ||
                r.payoutStructure === "custom";
              return (
                <RowGroup key={r.id}>
                  <tr
                    className={
                      "group border-b border-[color:var(--color-border)]/60 transition-colors hover:bg-[color:var(--color-fg)]/[0.03] " +
                      (i % 2 === 1 ? "bg-[color:var(--color-fg)]/[0.02]" : "")
                    }
                  >
                    <Td>
                      <button
                        type="button"
                        onClick={() => toggleExpand(r.id)}
                        title={t("row.advanced")}
                        aria-label={t("row.advanced")}
                        className={
                          "inline-flex h-6 w-6 items-center justify-center rounded text-[color:var(--color-fg-dim)] transition-colors hover:bg-[color:var(--color-fg)]/5 hover:text-[color:var(--color-fg)] " +
                          (isOpen ? "text-[color:var(--color-accent)]" : "")
                        }
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          style={{
                            transform: isOpen ? "rotate(90deg)" : "none",
                            transition: "transform 0.15s",
                          }}
                        >
                          <path
                            d="M9 6l6 6-6 6"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        {hasAdv && !isOpen && (
                          <span className="ml-0.5 h-1 w-1 rounded-full bg-[color:var(--color-accent)]" />
                        )}
                      </button>
                    </Td>
                    <Td className="min-w-[12rem]">
                      <TextInput
                        value={r.label ?? ""}
                        onChange={(v) => update(r.id, { label: v })}
                        placeholder={t("row.unnamed")}
                        className="w-full min-w-[10rem]"
                      />
                    </Td>
                    <Td align="right">
                      <NumInput
                        value={r.players}
                        onChange={(v) => update(r.id, { players: v })}
                        min={2}
                        step={1}
                      />
                    </Td>
                    <Td align="right">
                      <NumInput
                        value={r.buyIn}
                        onChange={(v) => update(r.id, { buyIn: v })}
                        step={1}
                      />
                    </Td>
                    <Td align="right">
                      <NumInput
                        value={+(r.rake * 100).toFixed(2)}
                        onChange={(v) => update(r.id, { rake: v / 100 })}
                        step={0.5}
                      />
                    </Td>
                    <Td align="right">
                      <NumInput
                        value={+(r.roi * 100).toFixed(2)}
                        onChange={(v) => update(r.id, { roi: v / 100 })}
                        step={1}
                      />
                    </Td>
                    <Td>
                      <select
                        value={r.payoutStructure}
                        onChange={(e) => {
                          const next = e.target.value as PayoutStructureId;
                          update(r.id, { payoutStructure: next });
                          if (next === "custom") {
                            const ex = new Set(expanded);
                            ex.add(r.id);
                            setExpanded(ex);
                          }
                        }}
                        className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-xs text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
                      >
                        {STRUCTURES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </Td>
                    <Td align="right">
                      <NumInput
                        value={r.count}
                        onChange={(v) =>
                          update(r.id, { count: Math.max(1, Math.floor(v)) })
                        }
                        min={1}
                        step={1}
                      />
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                        <IconBtn
                          onClick={() => duplicate(r.id)}
                          label={t("row.addRow")}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
                            <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </IconBtn>
                        <IconBtn
                          onClick={() => remove(r.id)}
                          disabled={schedule.length === 1}
                          label={t("row.delete")}
                          danger
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </IconBtn>
                      </div>
                    </Td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-[color:var(--color-border)]/60 bg-[color:var(--color-bg-elev-2)]/30">
                      <td colSpan={9} className="px-6 py-4">
                        <AdvancedRowPanel
                          row={r}
                          onChange={(patch) => update(r.id, patch)}
                        />
                      </td>
                    </tr>
                  )}
                </RowGroup>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]/40 px-4 py-2.5">
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[color:var(--color-fg-muted)] transition-colors hover:bg-[color:var(--color-fg)]/5 hover:text-[color:var(--color-fg)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {t("row.addRow")}
        </button>
      </div>
    </Card>
  );
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function SectionLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-[color:var(--color-fg-dim)]">
      {children}
      {hint && <InfoTooltip content={hint} />}
    </label>
  );
}

function AdvancedRowPanel({
  row,
  onChange,
}: {
  row: TournamentRow;
  onChange: (patch: Partial<TournamentRow>) => void;
}) {
  const t = useT();
  const fv: FieldVariability = row.fieldVariability ?? { kind: "fixed" };
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
      {/* Guarantee / overlay */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel hint={t("row.guaranteeHint")}>
          {t("row.guarantee")}
        </SectionLabel>
        <input
          type="number"
          min={0}
          step={100}
          value={row.guarantee ?? ""}
          placeholder={t("row.noGuarantee")}
          onChange={(e) => {
            const v = e.target.value;
            onChange({
              guarantee: v === "" ? undefined : Math.max(0, parseFloat(v)),
            });
          }}
          className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-sm tabular-nums text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] placeholder:text-[color:var(--color-fg-dim)]"
        />
      </div>

      {/* Field variability */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel hint={t("row.fieldHint")}>
          {t("row.fieldSize")}
        </SectionLabel>
        <div className="flex gap-2">
          <select
            value={fv.kind}
            onChange={(e) => {
              const kind = e.target.value as FieldVariability["kind"];
              if (kind === "fixed") onChange({ fieldVariability: { kind } });
              else
                onChange({
                  fieldVariability: {
                    kind: "uniform",
                    min: Math.max(2, Math.floor(row.players * 0.6)),
                    max: Math.max(2, Math.floor(row.players * 1.4)),
                    buckets: 5,
                  },
                });
            }}
            className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-2 text-xs text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
          >
            <option value="fixed">{t("row.fixed")}</option>
            <option value="uniform">{t("row.uniformRange")}</option>
          </select>
        </div>
        {fv.kind === "uniform" && (
          <div className="mt-1 grid grid-cols-3 gap-2">
            <FieldSmall label={t("row.min")}>
              <NumInputBox
                value={fv.min}
                min={2}
                step={1}
                onChange={(v) =>
                  onChange({
                    fieldVariability: { ...fv, min: Math.max(2, Math.floor(v)) },
                  })
                }
              />
            </FieldSmall>
            <FieldSmall label={t("row.max")}>
              <NumInputBox
                value={fv.max}
                min={2}
                step={1}
                onChange={(v) =>
                  onChange({
                    fieldVariability: { ...fv, max: Math.max(2, Math.floor(v)) },
                  })
                }
              />
            </FieldSmall>
            <FieldSmall label={t("row.buckets")}>
              <NumInputBox
                value={fv.buckets ?? 5}
                min={1}
                step={1}
                onChange={(v) =>
                  onChange({
                    fieldVariability: {
                      ...fv,
                      buckets: Math.max(1, Math.min(20, Math.floor(v))),
                    },
                  })
                }
              />
            </FieldSmall>
          </div>
        )}
      </div>

      {/* Custom payouts */}
      {row.payoutStructure === "custom" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-medium uppercase tracking-[0.15em] text-[color:var(--color-fg-dim)]">
            {t("row.customPct")}
          </label>
          <textarea
            rows={4}
            value={
              row.customPayouts
                ? row.customPayouts.map((v) => +(v * 100).toFixed(3)).join(", ")
                : ""
            }
            placeholder="25, 18, 12, 9, 7, 5.5, 4.5, 4, 3.5, 3, 2.8, 2.5, 2, 1.2"
            onChange={(e) => {
              const parsed = parsePayoutString(e.target.value);
              onChange({ customPayouts: parsed ?? undefined });
            }}
            className="resize-none rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 font-mono text-xs text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] placeholder:text-[color:var(--color-fg-dim)]"
          />
          <p className="text-[10px] leading-relaxed text-[color:var(--color-fg-dim)]">
            {t("row.customHint")}
          </p>
        </div>
      )}

      {/* Re-entry */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel hint={t("row.reentryHint")}>
          {t("row.reentry")}
        </SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <FieldSmall label={t("row.reentry")}>
            <NumInputBox
              value={row.maxEntries ?? 1}
              min={1}
              step={1}
              onChange={(v) =>
                onChange({ maxEntries: Math.max(1, Math.floor(v)) })
              }
            />
          </FieldSmall>
          <FieldSmall label={t("row.reentryRate")}>
            <NumInputBox
              value={+((row.reentryRate ?? ((row.maxEntries ?? 1) > 1 ? 1 : 0)) * 100).toFixed(0)}
              min={0}
              step={10}
              onChange={(v) =>
                onChange({
                  reentryRate: Math.max(0, Math.min(1, v / 100)),
                })
              }
            />
          </FieldSmall>
        </div>
      </div>

      {/* Bounty / PKO */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel hint={t("row.bountyHint")}>
          {t("row.bounty")}
        </SectionLabel>
        <input
          type="number"
          min={0}
          max={90}
          step={5}
          value={+((row.bountyFraction ?? 0) * 100).toFixed(1)}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange({
              bountyFraction: Number.isFinite(v)
                ? Math.max(0, Math.min(0.9, v / 100))
                : undefined,
            });
          }}
          className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-sm tabular-nums text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
        />
      </div>

      {/* ICM FT */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel hint={t("row.icmHint")}>
          {t("row.icmFT")}
        </SectionLabel>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-[color:var(--color-fg-muted)]">
            <input
              type="checkbox"
              checked={row.icmFinalTable ?? false}
              onChange={(e) => onChange({ icmFinalTable: e.target.checked })}
              className="h-3.5 w-3.5 accent-[color:var(--color-accent)]"
            />
            on
          </label>
          {row.icmFinalTable && (
            <FieldSmall label={t("row.ftSize")}>
              <NumInputBox
                value={row.icmFinalTableSize ?? 9}
                min={2}
                step={1}
                onChange={(v) =>
                  onChange({
                    icmFinalTableSize: Math.max(2, Math.floor(v)),
                  })
                }
              />
            </FieldSmall>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldSmall({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function NumInputBox({
  value,
  onChange,
  step,
  min,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v)) onChange(v);
      }}
      className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-xs tabular-nums text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
    />
  );
}

function Th({
  children,
  align = "left",
  hint,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  hint?: React.ReactNode;
}) {
  return (
    <th
      className={
        "px-4 py-2.5 font-medium " + (align === "right" ? "text-right" : "")
      }
    >
      <span
        className={
          "inline-flex items-center gap-1.5 " +
          (align === "right" ? "flex-row-reverse" : "")
        }
      >
        {children}
        {hint && <InfoTooltip content={hint} />}
      </span>
    </th>
  );
}
function Td({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={
        "px-4 py-2 align-middle " +
        (align === "right" ? "text-right " : "") +
        className
      }
    >
      {children}
    </td>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={
        "rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-dim)] outline-none transition-colors hover:border-[color:var(--color-border)] focus:border-[color:var(--color-accent)] focus:bg-[color:var(--color-bg)] " +
        className
      }
    />
  );
}

function NumInput({
  value,
  onChange,
  step,
  min,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v)) onChange(v);
      }}
      className="w-20 rounded-md border border-transparent bg-transparent px-2 py-1 text-right text-sm tabular-nums text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border)] focus:border-[color:var(--color-accent)] focus:bg-[color:var(--color-bg)]"
    />
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={
        "inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-border)] hover:bg-[color:var(--color-fg)]/5 disabled:cursor-not-allowed disabled:opacity-20 " +
        (danger ? "hover:text-[color:var(--color-danger)]" : "hover:text-[color:var(--color-fg)]")
      }
    >
      {children}
    </button>
  );
}
