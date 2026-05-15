"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Field, NumInput, type ControlsState } from "@/components/ControlsPanel";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { DictKey } from "@/lib/i18n/dict";
import {
  joinObservedResultHubUsernames,
  parseObservedResultHubUsernames,
} from "@/lib/sim/battleRoyaleLeaderboardUi";
import { useResulthubLookup } from "@/lib/sim/useResulthubLookup";
import {
  analyzeBattleRoyaleLeaderboardLookup,
  parseBattleRoyaleLeaderboardSnapshot,
} from "@/lib/sim/battleRoyaleLeaderboardLookup";
import {
  BATTLE_ROYALE_LEADERBOARD_MANUAL_SOURCE,
  BATTLE_ROYALE_LEADERBOARD_MANUAL_STAKES,
} from "@/lib/sim/battleRoyaleLeaderboardManualData";
import {
  analyzeBattleRoyaleLeaderboardManual,
  nearestBattleRoyaleLeaderboardManualStake,
  type BattleRoyaleLeaderboardManualStakeSelection,
} from "@/lib/sim/battleRoyaleLeaderboardManual";

const BR_STAKE_KEYS = ["0.25", "1", "3", "10", "25"] as const;

export const BattleRoyaleLeaderboardControl = memo(function BattleRoyaleLeaderboardControl({
  value,
  onChange,
  disabled,
  advanced,
  previewTournaments,
  previewBuyIn,
}: {
  value: ControlsState;
  onChange: (next: ControlsState) => void;
  disabled?: boolean;
  advanced: boolean;
  previewTournaments: number;
  previewBuyIn: number;
}) {
  const t = useT();
  const controls = value.battleRoyaleLeaderboard;
  const totalPoints = BR_STAKE_KEYS.reduce(
    (acc, stake) => acc + Math.max(0, controls.observedPointsByStake[stake]),
    0,
  );
  const reconstructedBuyIn =
    (controls.observedPointsByStake["0.25"] / Math.max(1, totalPoints)) *
      controls.observedTotalTournaments *
      0.25 +
    (controls.observedPointsByStake["1"] / Math.max(1, totalPoints)) *
      controls.observedTotalTournaments *
      1 +
    (controls.observedPointsByStake["3"] / Math.max(1, totalPoints)) *
      controls.observedTotalTournaments *
      3 +
    (controls.observedPointsByStake["10"] / Math.max(1, totalPoints)) *
      controls.observedTotalTournaments *
      10 +
    (controls.observedPointsByStake["25"] / Math.max(1, totalPoints)) *
      controls.observedTotalTournaments *
      25;
  const observedAbi =
    controls.observedTotalTournaments > 0 && totalPoints > 0
      ? reconstructedBuyIn / controls.observedTotalTournaments
      : null;
  const lbPerTournament =
    controls.observedTotalTournaments > 0
      ? controls.observedTotalPrizes / controls.observedTotalTournaments
      : 0;
  const inferredManualStake = nearestBattleRoyaleLeaderboardManualStake(
    previewTournaments > 0 ? previewBuyIn / previewTournaments : null,
  );
  const resolvedManualStake =
    controls.manualStake === "auto" ? inferredManualStake : controls.manualStake;
  const manualAnalysis = useMemo(
    () =>
      analyzeBattleRoyaleLeaderboardManual({
        stake: resolvedManualStake,
        tournamentsPerDay: controls.manualTournamentsPerDay,
        pointsPerTournament: controls.manualPointsPerTournament,
      }),
    [
      controls.manualPointsPerTournament,
      controls.manualTournamentsPerDay,
      resolvedManualStake,
    ],
  );
  const manualExpectedPayout =
    previewTournaments * Math.max(0, manualAnalysis.payoutPerTournament);
  const manualPctOfBuyIns =
    previewBuyIn > 0 ? manualExpectedPayout / previewBuyIn : 0;
  const lookupAnalysis = useMemo(
    () =>
      analyzeBattleRoyaleLeaderboardLookup({
        tournamentsPerDay: controls.lookupTournamentsPerDay,
        pointsPerTournament: controls.lookupPointsPerTournament,
        snapshots: controls.lookupSnapshots,
      }),
    [
      controls.lookupPointsPerTournament,
      controls.lookupSnapshots,
      controls.lookupTournamentsPerDay,
    ],
  );
  const lookupExpectedPayout =
    previewTournaments * Math.max(0, lookupAnalysis.payoutPerTournament);
  const [lookupImportText, setLookupImportText] = useState("");
  const [lookupImportError, setLookupImportError] = useState<string | null>(null);
  const fmtMoney = (n: number) =>
    Math.abs(n) >= 100
      ? `$${Math.round(n).toLocaleString("ru-RU")}`
      : `$${n.toFixed(2)}`;

  const addLookupSnapshot = () => {
    const parsed = parseBattleRoyaleLeaderboardSnapshot(lookupImportText);
    if (parsed.entries.length === 0) {
      setLookupImportError(t("controls.brLeaderboard.lookupParseError"));
      return;
    }
    const nextIndex = controls.lookupSnapshots.length + 1;
    onChange({
      ...value,
      battleRoyaleLeaderboard: {
        ...controls,
        lookupSnapshots: [
          ...controls.lookupSnapshots,
          {
            id: `lb-${Date.now().toString(36)}-${nextIndex}`,
            label: `Day ${nextIndex}`,
            entries: parsed.entries,
          },
        ],
      },
    });
    setLookupImportText("");
    setLookupImportError(null);
  };

  const clearLookupSnapshots = () => {
    onChange({
      ...value,
      battleRoyaleLeaderboard: {
        ...controls,
        lookupSnapshots: [],
      },
    });
    setLookupImportError(null);
  };

  // Free-form input draft kept local: the persisted state is the parsed
  // string[], but while the user is typing "nick1, nick2," we don't want
  // to drop the trailing comma or eagerly dedupe. Reconcile to canonical
  // join() whenever the persisted array changes from somewhere else.
  const persistedUsernamesJoined = useMemo(
    () => joinObservedResultHubUsernames(controls.observedResultHubUsernames),
    [controls.observedResultHubUsernames],
  );
  const [usernamesDraft, setUsernamesDraft] = useState(persistedUsernamesJoined);
  useEffect(() => {
    setUsernamesDraft(persistedUsernamesJoined);
  }, [persistedUsernamesJoined]);

  const setObservedUsernamesDraft = (next: string) => {
    setUsernamesDraft(next);
    const parsed = parseObservedResultHubUsernames(next);
    onChange({
      ...value,
      battleRoyaleLeaderboard: {
        ...controls,
        observedResultHubUsernames: parsed,
      },
    });
  };

  // ResultHub lookup: pulls per-stake LB points + total prizes for every
  // saved nick (current + prior aliases) and sums them into observed
  // controls. Tournament count stays manual — the API doesn't expose it.
  // The hook owns the abort controller + status state machine; we just
  // tell it which nicks to fetch and how to merge the resulting summary.
  const { status: lookupStatus, run: runLookup } = useResulthubLookup();
  const usernamesForLookup = controls.observedResultHubUsernames;
  const runResulthubLookup = useCallback(
    () =>
      runLookup(usernamesForLookup, (summary) => {
        onChange({
          ...value,
          battleRoyaleLeaderboard: {
            ...controls,
            observedTotalPrizes: summary.totalPrizes,
            observedPointsByStake: { ...summary.pointsByStake },
          },
        });
      }),
    [runLookup, usernamesForLookup, value, controls, onChange],
  );

  const uiDisabled = disabled || !advanced;

  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--color-fg-dim)]">
            {t("controls.brLeaderboard.label")}
          </div>
          <div className="mt-1 text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
            {t("controls.brLeaderboard.note")}
          </div>
          {!advanced && (
            <div className="mt-1 text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
              {t("controls.brLeaderboard.lockedBasic")}
            </div>
          )}
        </div>
        <select
          value={controls.mode}
          disabled={uiDisabled}
          onChange={(e) =>
            onChange({
              ...value,
              battleRoyaleLeaderboard: {
                ...controls,
                mode:
                  e.target.value === "observed"
                    ? "observed"
                    : e.target.value === "lookup"
                      ? "lookup"
                    : e.target.value === "manual"
                      ? "manual"
                      : "off",
              },
            })
          }
          className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-sm text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] disabled:opacity-40"
        >
          <option value="off">{t("controls.brLeaderboard.mode.off")}</option>
          <option value="observed">
            {t("controls.brLeaderboard.mode.observed")}
          </option>
          <option value="manual">
            {t("controls.brLeaderboard.mode.manual")}
          </option>
          <option value="lookup">
            {t("controls.brLeaderboard.mode.lookup")}
          </option>
        </select>
      </div>
      {controls.mode === "manual" && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Field
              label={t("controls.brLeaderboard.manualStake")}
              hint={t("controls.brLeaderboard.manualStakeHint")}
            >
              <select
                value={controls.manualStake}
                disabled={uiDisabled}
                onChange={(e) =>
                  onChange({
                    ...value,
                    battleRoyaleLeaderboard: {
                      ...controls,
                      manualStake: e.target
                        .value as BattleRoyaleLeaderboardManualStakeSelection,
                    },
                  })
                }
                className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-sm text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] disabled:opacity-40"
              >
                <option value="auto">
                  {t("controls.brLeaderboard.manualStakeAuto").replace(
                    "{stake}",
                    `$${inferredManualStake}`,
                  )}
                </option>
                {BATTLE_ROYALE_LEADERBOARD_MANUAL_STAKES.map((stake) => (
                  <option key={stake} value={stake}>
                    ${stake}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("controls.brLeaderboard.lookupTournamentsPerDay")}
              hint={t("controls.brLeaderboard.lookupTournamentsPerDayHint")}
            >
              <NumInput
                value={controls.manualTournamentsPerDay}
                min={0}
                max={1_000_000}
                step={1}
                disabled={uiDisabled}
                onChange={(v) =>
                  onChange({
                    ...value,
                    battleRoyaleLeaderboard: {
                      ...controls,
                      manualTournamentsPerDay: Math.max(0, v),
                    },
                  })
                }
              />
            </Field>
            <Field
              label={t("controls.brLeaderboard.lookupPointsPerTournament")}
              hint={t("controls.brLeaderboard.lookupPointsPerTournamentHint")}
            >
              <NumInput
                value={controls.manualPointsPerTournament}
                min={0}
                max={1_000_000}
                step={1}
                disabled={uiDisabled}
                onChange={(v) =>
                  onChange({
                    ...value,
                    battleRoyaleLeaderboard: {
                      ...controls,
                      manualPointsPerTournament: Math.max(0, v),
                    },
                  })
                }
              />
            </Field>
            <Field
              label={t("controls.brLeaderboard.lookupTargetPoints")}
              hint={t("controls.brLeaderboard.lookupTargetPointsHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {Math.round(manualAnalysis.targetPoints).toLocaleString("ru-RU")}
              </div>
            </Field>
            <Field
              label={t("controls.brLeaderboard.manualPerTournament")}
              hint={t("controls.brLeaderboard.manualPerTournamentHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {fmtMoney(manualAnalysis.payoutPerTournament)}
              </div>
            </Field>
            <Field
              label={t("controls.brLeaderboard.lookupAvgPrize")}
              hint={t("controls.brLeaderboard.lookupAvgPrizeHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {fmtMoney(manualAnalysis.averageDailyPrize)}
              </div>
            </Field>
            <Field
              label={t("controls.brLeaderboard.lookupParsedDays")}
              hint={t("controls.brLeaderboard.lookupParsedDaysHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {manualAnalysis.snapshotCount.toLocaleString("ru-RU")}
              </div>
            </Field>
            <Field
              label={t("controls.brLeaderboard.manualProjected")}
              hint={t("controls.brLeaderboard.manualProjectedHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {fmtMoney(manualExpectedPayout)}
              </div>
            </Field>
            <Field
              label={t("controls.brLeaderboard.manualPct")}
              hint={t("controls.brLeaderboard.manualPctHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {(manualPctOfBuyIns * 100).toFixed(2)}%
              </div>
            </Field>
          </div>
          <div className="mt-2 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/35 p-2 text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
            {manualAnalysis.hasBuiltInSnapshots
              ? t("controls.brLeaderboard.manualSource")
                  .replace("{stake}", `$${resolvedManualStake}`)
                  .replace(
                    "{from}",
                    BATTLE_ROYALE_LEADERBOARD_MANUAL_SOURCE.finishedDateFrom,
                  )
                  .replace(
                    "{to}",
                    BATTLE_ROYALE_LEADERBOARD_MANUAL_SOURCE.finishedDateTo,
                  )
              : t("controls.brLeaderboard.manualNoBuiltInData").replace(
                  "{stake}",
                  `$${resolvedManualStake}`,
                )}
          </div>
        </>
      )}
      {controls.mode === "lookup" && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Field
              label={t("controls.brLeaderboard.lookupTournamentsPerDay")}
              hint={t("controls.brLeaderboard.lookupTournamentsPerDayHint")}
            >
              <NumInput
                value={controls.lookupTournamentsPerDay}
                min={0}
                max={1_000_000}
                step={1}
                disabled={uiDisabled}
                onChange={(v) =>
                  onChange({
                    ...value,
                    battleRoyaleLeaderboard: {
                      ...controls,
                      lookupTournamentsPerDay: Math.max(0, v),
                    },
                  })
                }
              />
            </Field>
            <Field
              label={t("controls.brLeaderboard.lookupPointsPerTournament")}
              hint={t("controls.brLeaderboard.lookupPointsPerTournamentHint")}
            >
              <NumInput
                value={controls.lookupPointsPerTournament}
                min={0}
                max={1_000_000}
                step={1}
                disabled={uiDisabled}
                onChange={(v) =>
                  onChange({
                    ...value,
                    battleRoyaleLeaderboard: {
                      ...controls,
                      lookupPointsPerTournament: Math.max(0, v),
                    },
                  })
                }
              />
            </Field>
            <Field
              label={t("controls.brLeaderboard.lookupTargetPoints")}
              hint={t("controls.brLeaderboard.lookupTargetPointsHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {Math.round(lookupAnalysis.targetPoints).toLocaleString("ru-RU")}
              </div>
            </Field>
            <Field
              label={t("controls.brLeaderboard.lookupPerTournament")}
              hint={t("controls.brLeaderboard.lookupPerTournamentHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {fmtMoney(lookupAnalysis.payoutPerTournament)}
              </div>
            </Field>
            <Field
              label={t("controls.brLeaderboard.lookupAvgPrize")}
              hint={t("controls.brLeaderboard.lookupAvgPrizeHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {fmtMoney(lookupAnalysis.averageDailyPrize)}
              </div>
            </Field>
            <Field
              label={t("controls.brLeaderboard.lookupParsedDays")}
              hint={t("controls.brLeaderboard.lookupParsedDaysHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {lookupAnalysis.snapshotCount.toLocaleString("ru-RU")}
              </div>
            </Field>
            <Field
              label={t("controls.brLeaderboard.manualProjected")}
              hint={t("controls.brLeaderboard.manualProjectedHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {fmtMoney(lookupExpectedPayout)}
              </div>
            </Field>
            <Field
              label={t("controls.brLeaderboard.manualVolume")}
              hint={t("controls.brLeaderboard.manualVolumeHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {Math.round(previewTournaments).toLocaleString("ru-RU")}
              </div>
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)]">
                {t("controls.brLeaderboard.lookupImportLabel")}
              </div>
              <textarea
                value={lookupImportText}
                disabled={uiDisabled}
                onChange={(e) => {
                  setLookupImportText(e.target.value);
                  setLookupImportError(null);
                }}
                placeholder={t("controls.brLeaderboard.lookupImportPlaceholder")}
                className="min-h-28 w-full resize-y rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[color:var(--color-fg)] outline-none focus:border-[color:var(--color-accent)] disabled:opacity-40"
              />
              <div className="mt-1 text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
                {lookupImportError ?? t("controls.brLeaderboard.lookupImportHint")}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={uiDisabled || lookupImportText.trim().length === 0}
                onClick={addLookupSnapshot}
                className="rounded-md border border-[color:var(--color-accent)]/50 bg-[color:var(--color-accent)] px-3 py-2 text-sm font-semibold text-black transition-opacity disabled:opacity-40"
              >
                {t("controls.brLeaderboard.lookupAddSnapshot")}
              </button>
              <button
                type="button"
                disabled={uiDisabled || controls.lookupSnapshots.length === 0}
                onClick={clearLookupSnapshots}
                className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-sm font-semibold text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-border-strong)] disabled:opacity-40"
              >
                {t("controls.brLeaderboard.lookupClearSnapshots")}
              </button>
              <div className="whitespace-pre-line rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/35 p-2 text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
                {lookupAnalysis.snapshotCount === 0
                  ? t("controls.brLeaderboard.lookupEmpty")
                  : lookupAnalysis.days
                      .slice(0, 4)
                      .map((day) =>
                        t("controls.brLeaderboard.lookupSnapshotLine")
                          .replace("{label}", day.label ?? day.snapshotId)
                          .replace("{entries}", day.entries.toLocaleString("ru-RU"))
                          .replace("{rank}", day.rank == null ? "—" : `#${day.rank}`)
                          .replace(
                            "{points}",
                            day.points == null
                              ? "—"
                              : Math.round(day.points).toLocaleString("ru-RU"),
                          )
                          .replace("{prize}", fmtMoney(day.prize)),
                      )
                      .join("\n")}
              </div>
            </div>
          </div>
        </>
      )}
      {controls.mode === "observed" && (
        <>
          <div className="mb-3">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)]">
              {t("controls.brLeaderboard.observedUsernameLabel")}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <input
                type="text"
                value={usernamesDraft}
                disabled={uiDisabled}
                onChange={(e) => setObservedUsernamesDraft(e.target.value)}
                placeholder={t(
                  "controls.brLeaderboard.observedUsernamePlaceholder",
                )}
                autoComplete="off"
                spellCheck={false}
                className="flex-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 font-mono text-[12px] leading-relaxed text-[color:var(--color-fg)] outline-none focus:border-[color:var(--color-accent)] disabled:opacity-40"
              />
              <button
                type="button"
                disabled={
                  uiDisabled ||
                  usernamesForLookup.length === 0 ||
                  lookupStatus.kind === "pending"
                }
                onClick={runResulthubLookup}
                className="rounded-md border border-[color:var(--color-accent)]/50 bg-[color:var(--color-accent)] px-3 py-2 text-sm font-semibold text-black transition-opacity disabled:opacity-40 sm:min-w-[180px]"
              >
                {lookupStatus.kind === "pending"
                  ? t("controls.brLeaderboard.lookupPending")
                  : t("controls.brLeaderboard.lookupAction")}
              </button>
            </div>
            <div className="mt-1 text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
              {lookupStatus.kind === "ok"
                ? t("controls.brLeaderboard.lookupOk")
                    .replace("{from}", lookupStatus.window.from)
                    .replace("{to}", lookupStatus.window.to)
                : lookupStatus.kind === "error"
                  ? t(
                      `controls.brLeaderboard.lookupError.${lookupStatus.reason}` as DictKey,
                    )
                  : t("controls.brLeaderboard.observedUsernameHint")}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Field
              label={t("controls.brLeaderboard.prizes")}
              hint={t("controls.brLeaderboard.prizesHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {Math.round(controls.observedTotalPrizes).toLocaleString("ru-RU")}
              </div>
            </Field>
            <Field
              label={t("controls.brLeaderboard.tournaments")}
              hint={t("controls.brLeaderboard.tournamentsHint")}
            >
              <NumInput
                value={controls.observedTotalTournaments}
                min={0}
                max={10_000_000}
                step={100}
                disabled={uiDisabled}
                onChange={(v) =>
                  onChange({
                    ...value,
                    battleRoyaleLeaderboard: {
                      ...controls,
                      observedTotalTournaments: Math.floor(v),
                    },
                  })
                }
              />
            </Field>
            <Field
              label={t("controls.brLeaderboard.lbPerTournament")}
              hint={t("controls.brLeaderboard.lbPerTournamentHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                ${lbPerTournament.toFixed(2)}
              </div>
            </Field>
            <Field
              label={t("controls.brLeaderboard.observedAbi")}
              hint={t("controls.brLeaderboard.observedAbiHint")}
            >
              <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                {observedAbi == null ? "—" : `${observedAbi.toFixed(2)}`}
              </div>
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {BR_STAKE_KEYS.map((stake) => (
              <Field
                key={stake}
                label={`pts $${stake}`}
                hint={t("controls.brLeaderboard.pointsHint")}
              >
                <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-center text-sm font-mono tabular-nums text-[color:var(--color-fg)]">
                  {Math.round(controls.observedPointsByStake[stake]).toLocaleString("ru-RU")}
                </div>
              </Field>
            ))}
          </div>
        </>
      )}
    </div>
  );
});
