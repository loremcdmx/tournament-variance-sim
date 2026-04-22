import type { CashInput, CashStakeRow } from "./cashTypes";

export type CashStakeRowDraft = Partial<
  Omit<CashStakeRow, "rake">
> & {
  rake?: Partial<CashStakeRow["rake"]>;
};

export type CashInputDraft = Partial<
  Omit<CashInput, "rake" | "hoursBlock" | "riskBlock" | "stakes">
> & {
  rake?: Partial<CashInput["rake"]>;
  hoursBlock?: Partial<NonNullable<CashInput["hoursBlock"]>> | null;
  riskBlock?: Partial<NonNullable<CashInput["riskBlock"]>> | null;
  stakes?: CashStakeRowDraft[];
};

const MIN_HANDS = 1;
const MIN_SAMPLES = 1;
const MAX_SAMPLES = 20_000;
export const MAX_ABS_WR_BB100 = 1_000;
export const MAX_SD_BB100 = 10_000;
export const MAX_BB_SIZE = 1_000_000;
export const MAX_RAKE_CONTRIB_BB100 = 1_000;
export const MAX_HANDS_PER_HOUR = 10_000;
const MIN_BB_SIZE = 0.01;
const MIN_SD_BB100 = 0;
const MIN_RAKE_CONTRIB_BB100 = 0;
const MIN_PVI = 0.05;
const MAX_PVI = 1;
const MIN_HANDS_PER_HOUR = 1;
const MIN_RISK_THRESHOLD_BB = 1;
const UI_MIN_HANDS = 1_000;
const UI_MIN_SAMPLES = 100;
export const MAX_TOTAL_SIM_HANDS = 200_000_000;
export const MAX_HANDS = Math.floor(MAX_TOTAL_SIM_HANDS / UI_MIN_SAMPLES);
const UI_MIN_SD_BB100 = 1;
const UI_MIN_HANDS_PER_HOUR = 50;
const UI_MIN_RISK_THRESHOLD_BB = 10;

export const DEFAULT_CASH_INPUT: CashInput = {
  type: "cash",
  wrBb100: 5,
  sdBb100: 100,
  hands: 100_000,
  nSimulations: 2000,
  bbSize: 1,
  rake: {
    enabled: false,
    contributedRakeBb100: 8,
    advertisedRbPct: 30,
    pvi: 1,
  },
  hoursBlock: { handsPerHour: 500 },
  riskBlock: { thresholdBb: 100 },
  baseSeed: 42,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function looksLikeHydratedCashInput(v: Record<string, unknown>): boolean {
  return (
    v.type === "cash" &&
    "wrBb100" in v &&
    "sdBb100" in v &&
    "hands" in v &&
    "nSimulations" in v &&
    "bbSize" in v &&
    "rake" in v &&
    "baseSeed" in v
  );
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampMin(value: number, min: number): number {
  return Math.max(min, value);
}

function toInt(value: number, fallback: number, min: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

function normalizeRake(
  raw: unknown,
  fallback: CashInput["rake"],
): CashInput["rake"] {
  const src = isRecord(raw) ? raw : {};
  return {
    enabled:
      typeof src.enabled === "boolean" ? src.enabled : fallback.enabled,
    contributedRakeBb100: clamp(
      finiteOr(src.contributedRakeBb100, fallback.contributedRakeBb100),
      MIN_RAKE_CONTRIB_BB100,
      MAX_RAKE_CONTRIB_BB100,
    ),
    advertisedRbPct: clamp(
      finiteOr(src.advertisedRbPct, fallback.advertisedRbPct),
      0,
      100,
    ),
    pvi: clamp(finiteOr(src.pvi, fallback.pvi), MIN_PVI, MAX_PVI),
  };
}

function normalizeStakeRow(
  raw: unknown,
  fallback: CashStakeRow,
): CashStakeRow | null {
  if (!isRecord(raw)) return null;
  const label =
    typeof raw.label === "string" && raw.label.length > 0
      ? raw.label
      : fallback.label;
  return {
    ...(label ? { label } : {}),
    wrBb100: clamp(
      finiteOr(raw.wrBb100, fallback.wrBb100),
      -MAX_ABS_WR_BB100,
      MAX_ABS_WR_BB100,
    ),
    sdBb100: clamp(
      finiteOr(raw.sdBb100, fallback.sdBb100),
      MIN_SD_BB100,
      MAX_SD_BB100,
    ),
    bbSize: clamp(
      finiteOr(raw.bbSize, fallback.bbSize),
      MIN_BB_SIZE,
      MAX_BB_SIZE,
    ),
    handShare: clampMin(finiteOr(raw.handShare, fallback.handShare), 0),
    rake: normalizeRake(raw.rake, fallback.rake),
  };
}

export function normalizeCashInput(
  raw: CashInputDraft | null | undefined,
  fallback: CashInput = DEFAULT_CASH_INPUT,
): CashInput {
  const src = isRecord(raw) ? raw : {};
  // Hydrated UI state intentionally omits optional blocks when a toggle is off.
  // Treat that as "keep disabled", not as "restore DEFAULT_CASH_INPUT".
  const preserveOptionalOff = looksLikeHydratedCashInput(src);
  const rake = normalizeRake(src.rake, fallback.rake);
  const bbSize = clamp(
    finiteOr(src.bbSize, fallback.bbSize),
    MIN_BB_SIZE,
    MAX_BB_SIZE,
  );
  const wrBb100 = clamp(
    finiteOr(src.wrBb100, fallback.wrBb100),
    -MAX_ABS_WR_BB100,
    MAX_ABS_WR_BB100,
  );
  const sdBb100 = clamp(
    finiteOr(src.sdBb100, fallback.sdBb100),
    MIN_SD_BB100,
    MAX_SD_BB100,
  );
  const hands = Math.min(
    MAX_HANDS,
    toInt(finiteOr(src.hands, fallback.hands), fallback.hands, MIN_HANDS),
  );
  const nSimulations = toInt(
    finiteOr(src.nSimulations, fallback.nSimulations),
    fallback.nSimulations,
    MIN_SAMPLES,
  );
  const maxSimulationsForHands = Math.max(
    MIN_SAMPLES,
    Math.floor(MAX_TOTAL_SIM_HANDS / hands),
  );
  const clampedSimulations = Math.min(
    MAX_SAMPLES,
    nSimulations,
    maxSimulationsForHands,
  );
  const baseSeed = Math.floor(finiteOr(src.baseSeed, fallback.baseSeed));

  const hasHoursBlock = Object.prototype.hasOwnProperty.call(src, "hoursBlock");
  let hoursBlock: CashInput["hoursBlock"];
  if (!hasHoursBlock) {
    hoursBlock = preserveOptionalOff ? undefined : fallback.hoursBlock;
  } else if (isRecord(src.hoursBlock)) {
    hoursBlock = {
      handsPerHour: Math.min(
        MAX_HANDS_PER_HOUR,
        toInt(
          finiteOr(
            src.hoursBlock.handsPerHour,
            fallback.hoursBlock?.handsPerHour ?? 500,
          ),
          fallback.hoursBlock?.handsPerHour ?? 500,
          MIN_HANDS_PER_HOUR,
        ),
      ),
    };
  } else {
    hoursBlock = undefined;
  }

  const hasRiskBlock = Object.prototype.hasOwnProperty.call(src, "riskBlock");
  let riskBlock: CashInput["riskBlock"];
  if (!hasRiskBlock) {
    riskBlock = preserveOptionalOff ? undefined : fallback.riskBlock;
  } else if (isRecord(src.riskBlock)) {
    riskBlock = {
      thresholdBb: clampMin(
        finiteOr(
          src.riskBlock.thresholdBb,
          fallback.riskBlock?.thresholdBb ?? 100,
        ),
        MIN_RISK_THRESHOLD_BB,
      ),
    };
  } else {
    riskBlock = fallback.riskBlock;
  }

  let stakes: CashInput["stakes"];
  if (Array.isArray(src.stakes) && src.stakes.length > 0) {
    const defaultShare = 1 / src.stakes.length;
    const defaultStake: CashStakeRow = {
      wrBb100,
      sdBb100,
      bbSize,
      handShare: defaultShare,
      rake,
    };
    const next = src.stakes
      .map((row) => normalizeStakeRow(row, defaultStake))
      .filter((row): row is CashStakeRow => row !== null);
    const shareSum = next.reduce((acc, row) => acc + Math.max(0, row.handShare), 0);
    if (next.length > 0 && shareSum <= 0) {
      const equalShare = 1 / next.length;
      for (const row of next) row.handShare = equalShare;
    }
    stakes = next.length > 0 ? next : undefined;
  } else {
    stakes = undefined;
  }

  return {
    type: "cash",
    wrBb100,
    sdBb100,
    hands,
    nSimulations: clampedSimulations,
    bbSize,
    rake,
    ...(hoursBlock ? { hoursBlock } : {}),
    ...(riskBlock ? { riskBlock } : {}),
    baseSeed,
    ...(stakes ? { stakes } : {}),
  };
}

export function normalizeCashInputForUi(
  raw: CashInputDraft | null | undefined,
  fallback: CashInput = DEFAULT_CASH_INPUT,
): CashInput {
  const normalized = normalizeCashInput(raw, fallback);

  return {
    ...normalized,
    hands: clamp(normalized.hands, UI_MIN_HANDS, MAX_HANDS),
    nSimulations: clamp(normalized.nSimulations, UI_MIN_SAMPLES, MAX_SAMPLES),
    sdBb100: Math.max(UI_MIN_SD_BB100, normalized.sdBb100),
    ...(normalized.hoursBlock
        ? {
          hoursBlock: {
            handsPerHour: clamp(
              normalized.hoursBlock.handsPerHour,
              UI_MIN_HANDS_PER_HOUR,
              MAX_HANDS_PER_HOUR,
            ),
          },
        }
      : {}),
    ...(normalized.riskBlock
      ? {
          riskBlock: {
            thresholdBb: Math.max(
              UI_MIN_RISK_THRESHOLD_BB,
              normalized.riskBlock.thresholdBb,
            ),
          },
        }
      : {}),
    ...(normalized.stakes
      ? {
          stakes: normalized.stakes.map((row) => ({
            ...row,
            sdBb100: Math.max(UI_MIN_SD_BB100, row.sdBb100),
            handShare: clamp(row.handShare, 0, 1),
          })),
        }
      : {}),
  };
}

export function serializeCashInput(input: CashInput): CashInputDraft {
  const normalized = normalizeCashInput(input);
  return {
    type: normalized.type,
    wrBb100: normalized.wrBb100,
    sdBb100: normalized.sdBb100,
    hands: normalized.hands,
    nSimulations: normalized.nSimulations,
    bbSize: normalized.bbSize,
    rake: { ...normalized.rake },
    baseSeed: normalized.baseSeed,
    hoursBlock: normalized.hoursBlock
      ? { ...normalized.hoursBlock }
      : null,
    riskBlock: normalized.riskBlock
      ? { ...normalized.riskBlock }
      : null,
    stakes: normalized.stakes?.map((row) => ({
      ...(row.label ? { label: row.label } : {}),
      wrBb100: row.wrBb100,
      sdBb100: row.sdBb100,
      bbSize: row.bbSize,
      handShare: row.handShare,
      rake: { ...row.rake },
    })),
  };
}
