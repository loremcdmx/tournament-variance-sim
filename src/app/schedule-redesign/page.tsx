"use client";

/* Visual prototype page. Three schedule-row redesign concepts shown
   next to the current design for comparison. Concept 01 is fully
   interactive so the flow is testable; 02 and 03 are static mockups. */

import { useState } from "react";

type GameType = "freezeout" | "pko" | "mystery" | "mystery-royale";
type PayoutId =
  | "mtt-standard"
  | "mtt-primedope"
  | "mtt-flat"
  | "mtt-top-heavy"
  | "battle-royale"
  | "mtt-gg-mystery"
  | "mtt-gg-bounty"
  | "mtt-pokerstars"
  | "mtt-sunday-million"
  | "satellite-ticket"
  | "sng-50-30-20"
  | "sng-65-35"
  | "winner-takes-all";

interface Row {
  id: string;
  label: string;
  gameType: GameType;
  brPreset: string;
  leaderboard: boolean;
  buyIn: number;
  rake: number;
  roi: number;
  rakebackRoi: number;
  itm: number;
  afs: number;
  payout: PayoutId;
  count: number;
}

const GAME_TYPES: { id: GameType; short: string; full: string; tint: string }[] = [
  { id: "freezeout", short: "Freeze", full: "Freezeout", tint: "var(--c-spade)" },
  { id: "pko", short: "PKO", full: "PKO", tint: "var(--c-heart)" },
  { id: "mystery", short: "MB", full: "Mystery Bounty", tint: "var(--c-diamond)" },
  { id: "mystery-royale", short: "GG BR", full: "Battle Royale", tint: "var(--c-club)" },
];

const PAYOUTS: { id: PayoutId; short: string }[] = [
  { id: "battle-royale", short: "GG Battle Royal" },
  { id: "mtt-standard", short: "MTT Standard 15%" },
  { id: "mtt-primedope", short: "PrimeDope" },
  { id: "mtt-flat", short: "MTT Flat 20%" },
  { id: "mtt-top-heavy", short: "MTT Top-heavy 12%" },
  { id: "mtt-pokerstars", short: "PokerStars SCOOP" },
  { id: "mtt-sunday-million", short: "Sunday Million" },
  { id: "mtt-gg-mystery", short: "GG Mystery" },
  { id: "mtt-gg-bounty", short: "Mini CoinHunter PKO" },
  { id: "satellite-ticket", short: "Satellite" },
  { id: "sng-50-30-20", short: "SNG 50/30/20" },
  { id: "sng-65-35", short: "SNG 65/35" },
  { id: "winner-takes-all", short: "Winner takes all" },
];

const BR_PRESETS = [
  "$1 · $10k top",
  "$5 · $50k top",
  "$10 · $100k top",
  "$25 · $250k top",
  "$50 · $500k top",
];

const SEED: Row[] = [
  {
    id: "r1",
    label: "",
    gameType: "mystery-royale",
    brPreset: "$10 · $100k top",
    leaderboard: false,
    buyIn: 9.2,
    rake: 0.8 / 9.2,
    roi: 0.07,
    rakebackRoi: 0,
    itm: 0.15,
    afs: 18,
    payout: "battle-royale",
    count: 10000,
  },
  {
    id: "r2",
    label: "Bread & butter",
    gameType: "freezeout",
    brPreset: "$10 · $100k top",
    leaderboard: false,
    buyIn: 50,
    rake: 0.1,
    roi: 0.12,
    rakebackRoi: 0,
    itm: 0.15,
    afs: 500,
    payout: "mtt-standard",
    count: 1500,
  },
];

function uid(): string {
  return "r" + Math.random().toString(36).slice(2, 9);
}

export default function ScheduleRedesignPage() {
  return (
    <main className="mx-auto max-w-[1800px] px-6 py-10 text-[color:var(--color-fg)]">
      <header className="mb-10">
        <div className="eyebrow mb-2">Spike · Schedule row redesign</div>
        <h1 className="text-2xl mb-2 font-medium tracking-tight">
          Три варианта редизайна строки расписания
        </h1>
        <p className="text-sm text-[color:var(--color-fg-muted)] max-w-3xl">
          Слева — текущая строка «как сейчас», справа — предложенный редизайн.
          Меняется только визуальный язык строки; набор полей (ярлык, тип игры,
          AFS, бай-ин, ROI, ITM, payouts, количество) сохранён.
          Первый концепт — полностью кликабельный: добавление, дублирование,
          удаление, редактирование всех полей.
        </p>
      </header>

      <Concept
        num="01"
        title="Карточка-плашка"
        pitch="Каждый турнир — автономная карточка с цветной кромкой по типу игры. Название крупное, бай-ин — визуальный центр; вспомогательные поля (AFS, ITM) уходят в правую мета-колонку. Заголовок таблицы больше не нужен: каждая карточка самоподписана. Этот вариант кликабельный — попробуй."
        pros={["Читается без шапки таблицы", "Карточка масштабируется на мобильный", "Цвет кромки подсказывает тип игры"]}
        cons={["Расписание из 20 строк становится длиннее по вертикали", "Нужны новые правила выравнивания при табуляции через Tab"]}
      >
        <Before />
        <After1Interactive />
      </Concept>

      <Concept
        num="02"
        title="Газетный разворот"
        pitch="Оставляем плотную горизонтальную строку, но каждый контрол получает собственный мини-заголовок — моно, 10px, uppercase, tracking 0.2em — прямо над полем. Верхний thead удаляется, строка сама себя подписывает. Бай-ин — самая крупная ячейка, ROI с rakeback сжат в один блок."
        pros={["Шапка таблицы исчезает — меньше визуального шума", "Каждое поле читается без контекста соседей", "Стыкуется с уже существующим .bracketed декором"]}
        cons={["Чуть больше высоты на строку", "Переучивание на eyebrow-лейблы вместо внешних заголовков"]}
      >
        <Before />
        <After2 />
      </Concept>

      <Concept
        num="03"
        title="Dashboard tile"
        pitch="Максимальное разрежение до сути. Тип игры — сегментированная пилюля с монохромной иконкой; ROI — цветной chip со знаком; payout — тикер-код в моно ('GG-BR'); количество — справа как умножающий коэффициент (×10 000). Всё второстепенное открывается по hover/focus, если нужно."
        pros={["Самый плотный из трёх — выигрывает для больших расписаний", "Моно-цифры выровнены в столбец, легко сканировать", "ROI-чип видно издалека — сразу понятен знак"]}
        cons={["Hover-дискаверинг требует обучения", "Без пояснений подпись 'GG-BR' может быть непрозрачной новым пользователям"]}
      >
        <Before />
        <After3 />
      </Concept>
    </main>
  );
}

/* ------------------------------------------------------------------ shell */

function Concept({
  num,
  title,
  pitch,
  pros,
  cons,
  children,
}: {
  num: string;
  title: string;
  pitch: string;
  pros: string[];
  cons: string[];
  children: React.ReactNode;
}) {
  return (
    <section className="mb-16">
      <div className="mb-4 flex items-baseline gap-4">
        <span className="section-num text-5xl">{num}</span>
        <h2 className="text-xl font-medium tracking-tight">{title}</h2>
      </div>
      <p className="mb-4 max-w-4xl text-sm text-[color:var(--color-fg-muted)]">{pitch}</p>
      <div className="mb-5 grid max-w-4xl grid-cols-2 gap-6 text-[11px]">
        <ul className="space-y-1">
          <li className="eyebrow mb-1" style={{ color: "var(--c-success)" }}>За</li>
          {pros.map((p, i) => (
            <li key={i} className="text-[color:var(--color-fg-muted)]">— {p}</li>
          ))}
        </ul>
        <ul className="space-y-1">
          <li className="eyebrow mb-1" style={{ color: "var(--c-heart)" }}>Против</li>
          {cons.map((c, i) => (
            <li key={i} className="text-[color:var(--color-fg-muted)]">— {c}</li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel label="БЫЛО — текущая строка">{Array.isArray(children) ? children[0] : null}</Panel>
        <Panel label="СТАЛО — редизайн" accent>
          {Array.isArray(children) ? children[1] : null}
        </Panel>
      </div>
    </section>
  );
}

function Panel({
  label,
  accent,
  children,
}: {
  label: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="eyebrow"
        style={{ color: accent ? "var(--c-accent)" : "var(--c-fg-dim)" }}
      >
        {label}
      </div>
      <div
        className="rounded-lg border bg-[color:var(--color-bg-elev)] p-4"
        style={{
          borderColor: accent
            ? "color-mix(in oklab, var(--c-accent), transparent 72%)"
            : "var(--c-border)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* --------------------------------------------------- BEFORE (current row) */

function Before() {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full min-w-[860px] table-fixed text-sm"
        style={{ fontFamily: "var(--font-sans), system-ui" }}
      >
        <colgroup>
          <col className="w-8" />
          <col />
          <col className="w-[11rem]" />
          <col className="w-[4rem]" />
          <col className="w-[5.5rem]" />
          <col className="w-[5.5rem]" />
          <col className="w-[5.5rem]" />
          <col className="w-[11rem]" />
          <col className="w-[5rem]" />
          <col className="w-[3.5rem]" />
        </colgroup>
        <thead>
          <tr
            className="border-b text-left text-[10px] uppercase tracking-[0.14em]"
            style={{
              borderColor: "var(--c-border)",
              background: "color-mix(in oklab, var(--c-bg-elev-2), transparent 40%)",
              color: "var(--c-fg-dim)",
            }}
          >
            <th />
            <BTh>Турнир</BTh>
            <BTh>Тип игры</BTh>
            <BTh>AFS</BTh>
            <BTh>Бай-ин</BTh>
            <BTh>ROI %</BTh>
            <BTh>Фикс. ITM %</BTh>
            <BTh>Выплаты</BTh>
            <BTh>Турниры</BTh>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            className="border-b"
            style={{ borderColor: "color-mix(in oklab, var(--c-border), transparent 40%)" }}
          >
            <BTd>
              <button className="inline-flex h-6 w-6 items-center justify-center rounded text-[color:var(--color-fg-dim)]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </BTd>
            <BTd><MockInput placeholder="$50 обычный MTT" /></BTd>
            <BTd>
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1">
                  <MockSelect value="GG BR" w="3.5rem" />
                  <MockSelect value="$10 · $100k top" w="7rem" />
                </div>
                <label className="flex items-center gap-1 text-[10px] text-[color:var(--color-fg-dim)]">
                  <input type="checkbox" className="h-3 w-3" /> ЛБ
                </label>
              </div>
            </BTd>
            <BTd align="right"><MockInput value="18" align="right" /></BTd>
            <BTd align="right"><MockInput value="9.20+0.80" align="right" /></BTd>
            <BTd align="right">
              <div className="flex flex-col items-center gap-1">
                <MockInput value="7" align="right" suffix="%" w="3.5rem" />
                <div className="flex items-center gap-1 text-[9px] text-[color:var(--color-fg-dim)]">
                  <span>с RB</span>
                  <span style={{ color: "var(--c-success)" }}>+7.0%</span>
                </div>
                <div className="flex gap-0.5 text-[10px]">
                  {["3", "5", "7", "10"].map((v) => (
                    <span
                      key={v}
                      className="rounded border px-1"
                      style={{
                        borderColor: v === "7" ? "var(--c-accent)" : "var(--c-border)",
                        color: v === "7" ? "var(--c-accent)" : "var(--c-fg-dim)",
                      }}
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            </BTd>
            <BTd align="right"><MockInput value="15 глоб." align="right" /></BTd>
            <BTd><MockSelect value="GG Battle Royal" w="100%" /></BTd>
            <BTd align="right"><MockInput value="10000" align="right" /></BTd>
            <BTd>
              <div className="flex gap-0.5 opacity-60">
                <IconSquare />
                <IconCross />
              </div>
            </BTd>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BTh({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-2 py-2 text-center">
      <span className="inline-flex items-center gap-1">
        {children}
        <span className="text-[9px] opacity-60">?</span>
      </span>
    </th>
  );
}

function BTd({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td className="px-1.5 py-2" style={{ textAlign: align }}>
      {children}
    </td>
  );
}

/* ------------------------------------------- AFTER 1 — INTERACTIVE cards */

function After1Interactive() {
  const [rows, setRows] = useState<Row[]>(SEED);

  const update = (id: string, patch: Partial<Row>) =>
    setRows((xs) => xs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) =>
    setRows((xs) => (xs.length > 1 ? xs.filter((r) => r.id !== id) : xs));
  const duplicate = (id: string) =>
    setRows((xs) => {
      const src = xs.find((r) => r.id === id);
      if (!src) return xs;
      const idx = xs.findIndex((r) => r.id === id);
      const copy: Row = { ...src, id: uid() };
      return [...xs.slice(0, idx + 1), copy, ...xs.slice(idx + 1)];
    });
  const add = () =>
    setRows((xs) => [
      ...xs,
      {
        id: uid(),
        label: "",
        gameType: "freezeout",
        brPreset: "$10 · $100k top",
        leaderboard: false,
        buyIn: 10,
        rake: 0.1,
        roi: 0.2,
        rakebackRoi: 0,
        itm: 0.15,
        afs: 500,
        payout: "mtt-standard",
        count: 1,
      },
    ]);

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <After1Card
          key={r.id}
          row={r}
          onChange={(patch) => update(r.id, patch)}
          onRemove={() => remove(r.id)}
          onDuplicate={() => duplicate(r.id)}
          canRemove={rows.length > 1}
        />
      ))}
      <div className="flex gap-2 pt-1">
        <button
          onClick={add}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[color:var(--color-fg-muted)] transition-colors hover:bg-[color:var(--color-fg)]/5 hover:text-[color:var(--color-fg)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Добавить
        </button>
      </div>
    </div>
  );
}

function After1Card({
  row: r,
  onChange,
  onRemove,
  onDuplicate,
  canRemove,
}: {
  row: Row;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  canRemove: boolean;
}) {
  const gt = GAME_TYPES.find((g) => g.id === r.gameType)!;
  const isBr = r.gameType === "mystery-royale";
  const reportedRoi = r.roi + r.rakebackRoi;
  const roiPositive = r.roi >= 0;
  const roiColor = roiPositive ? "var(--c-success)" : "var(--c-heart)";

  return (
    <div
      className="relative overflow-hidden rounded-lg border transition-colors focus-within:border-[color:var(--color-accent)]/40"
      style={{
        borderColor: "var(--c-border)",
        background:
          "linear-gradient(to bottom, color-mix(in oklab, var(--c-bg-elev), white 2%), color-mix(in oklab, var(--c-bg-elev), black 4%))",
      }}
    >
      {/* game-type keyed stripe */}
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: gt.tint }}
      />

      <div className="grid gap-4 pl-5 pr-4 py-4" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1.2fr) minmax(0,1fr) auto" }}>
        {/* identity */}
        <div className="flex flex-col gap-1.5 min-w-0">
          <Eyebrow>Турнир</Eyebrow>
          <input
            className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-[color:var(--color-fg-dim)]"
            placeholder="$50 обычный MTT"
            value={r.label}
            onChange={(e) => onChange({ label: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <ChipSelect
              value={r.gameType}
              accent
              title={gt.full}
              onChange={(v) => onChange({ gameType: v as GameType })}
              options={GAME_TYPES.map((g) => ({ value: g.id, label: g.full }))}
              display={gt.short}
            />
            {isBr && (
              <ChipSelect
                value={r.brPreset}
                onChange={(v) => onChange({ brPreset: v })}
                options={BR_PRESETS.map((p) => ({ value: p, label: p }))}
                display={r.brPreset}
              />
            )}
            {isBr && (
              <button
                type="button"
                onClick={() => onChange({ leaderboard: !r.leaderboard })}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                style={{
                  borderColor: r.leaderboard
                    ? "color-mix(in oklab, var(--c-accent), transparent 40%)"
                    : "var(--c-border)",
                  background: r.leaderboard
                    ? "color-mix(in oklab, var(--c-accent), transparent 82%)"
                    : "transparent",
                  color: r.leaderboard ? "var(--c-accent)" : "var(--c-fg-dim)",
                }}
                title="Leaderboard — отдельные призовые за серию"
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    background: r.leaderboard ? "var(--c-accent)" : "var(--c-fg-dim)",
                  }}
                />
                ЛБ
              </button>
            )}
          </div>
        </div>

        {/* money */}
        <div className="flex flex-col gap-1.5 min-w-0">
          <Eyebrow>Бай-ин</Eyebrow>
          <div className="flex items-baseline gap-1.5 tabular">
            <span className="text-lg text-[color:var(--color-fg-dim)]">$</span>
            <NumberField
              value={r.buyIn}
              onChange={(v) => onChange({ buyIn: v })}
              step={0.01}
              className="text-2xl tracking-tight"
              width="5rem"
            />
            <span className="text-base text-[color:var(--color-fg-dim)]">+ $</span>
            <NumberField
              value={r.buyIn * r.rake}
              onChange={(fee) => onChange({ rake: r.buyIn > 0 ? fee / r.buyIn : 0 })}
              step={0.01}
              className="text-base"
              width="3.5rem"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
              style={{
                background: `color-mix(in oklab, ${roiColor}, transparent 84%)`,
                border: `1px solid color-mix(in oklab, ${roiColor}, transparent 58%)`,
                color: roiColor,
              }}
              title="ROI — вручную; ниже — итог с rakeback"
            >
              ROI
              <NumberField
                value={r.roi * 100}
                onChange={(v) => onChange({ roi: v / 100 })}
                step={1}
                inline
                width="2.4rem"
                className="font-medium"
                suffix="%"
              />
            </span>
            {r.rakebackRoi !== 0 && (
              <span className="text-[color:var(--color-fg-dim)]">
                с RB <span style={{ color: "var(--c-success)" }}>+{(reportedRoi * 100).toFixed(1)}%</span>
              </span>
            )}
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[color:var(--color-fg-muted)]"
              style={{ borderColor: "var(--c-border)" }}
              title="Фикс. ITM %"
            >
              ITM
              <NumberField
                value={r.itm * 100}
                onChange={(v) => onChange({ itm: v / 100 })}
                step={0.5}
                inline
                width="2.2rem"
                suffix="%"
              />
            </span>
          </div>
        </div>

        {/* meta */}
        <div className="flex flex-col text-xs">
          <div
            className="flex items-center justify-between border-b py-1"
            style={{ borderColor: "var(--c-border)" }}
          >
            <span className="text-[color:var(--color-fg-dim)]">AFS</span>
            <NumberField
              value={r.afs}
              onChange={(v) => onChange({ afs: Math.max(2, Math.round(v)) })}
              step={1}
              inline
              width="3.2rem"
              align="right"
            />
          </div>
          <div
            className="flex items-center justify-between border-b py-1 gap-2"
            style={{ borderColor: "var(--c-border)" }}
          >
            <span className="text-[color:var(--color-fg-dim)] shrink-0">Payout</span>
            <select
              value={r.payout}
              onChange={(e) => onChange({ payout: e.target.value as PayoutId })}
              className="bg-transparent text-right text-xs outline-none min-w-0 truncate"
              style={{ border: "none", padding: 0, height: "auto" }}
            >
              {PAYOUTS.map((p) => (
                <option key={p.id} value={p.id} style={{ background: "var(--c-bg-elev-2)" }}>
                  {p.short}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-[color:var(--color-fg-dim)]">×</span>
            <NumberField
              value={r.count}
              onChange={(v) => onChange({ count: Math.max(1, Math.round(v)) })}
              step={100}
              inline
              width="4.5rem"
              align="right"
              className="text-sm"
              style={{ color: "var(--c-accent)" }}
            />
          </div>
        </div>

        {/* actions */}
        <div className="flex items-start gap-0.5 self-start">
          <IconBtn onClick={onDuplicate} label="Дублировать">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
              <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </IconBtn>
          <IconBtn onClick={onRemove} label="Удалить" disabled={!canRemove} danger>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </IconBtn>
        </div>
      </div>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="uppercase"
      style={{
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: "9px",
        letterSpacing: "0.2em",
        color: "var(--c-fg-dim)",
      }}
    >
      {children}
    </span>
  );
}

function NumberField({
  value,
  onChange,
  step = 1,
  className = "",
  style,
  width,
  inline,
  align,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  className?: string;
  style?: React.CSSProperties;
  width?: string;
  inline?: boolean;
  align?: "left" | "right";
  suffix?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const show =
    draft !== null
      ? draft
      : Number.isFinite(value)
        ? String(+value.toFixed(2)).replace(/\.00$/, "")
        : "";
  return (
    <span className="inline-flex items-baseline">
      <input
        value={show}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseFloat(e.target.value.replace(",", "."));
          if (Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => setDraft(null)}
        inputMode="decimal"
        step={step}
        className={`tabular bg-transparent outline-none ${className}`}
        style={{
          width: width ?? "auto",
          textAlign: align ?? "left",
          padding: inline ? 0 : "0.1rem 0.25rem",
          border: inline ? "none" : "1px solid transparent",
          borderRadius: 4,
          height: "auto",
          minHeight: 0,
          boxShadow: "none",
          ...style,
        }}
        onFocus={(e) => {
          if (!inline) e.currentTarget.style.borderColor = "var(--c-border)";
          e.currentTarget.select();
        }}
        onBlurCapture={(e) => {
          if (!inline) e.currentTarget.style.borderColor = "transparent";
        }}
      />
      {suffix && <span className="text-[color:var(--color-fg-dim)]">{suffix}</span>}
    </span>
  );
}

function ChipSelect({
  value,
  onChange,
  options,
  display,
  accent,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  display: string;
  accent?: boolean;
  title?: string;
}) {
  return (
    <span className="relative inline-flex">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={title}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: "var(--c-bg-elev-2)" }}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className="pointer-events-none inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
        style={{
          borderColor: accent
            ? "color-mix(in oklab, var(--c-accent), transparent 55%)"
            : "var(--c-border)",
          background: accent
            ? "color-mix(in oklab, var(--c-accent), transparent 85%)"
            : "color-mix(in oklab, var(--c-bg-elev-2), transparent 40%)",
          color: accent ? "var(--c-accent)" : "var(--c-fg)",
        }}
      >
        {display}
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" className="opacity-60">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </span>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-[color:var(--color-fg-dim)] transition-colors hover:bg-[color:var(--color-fg)]/5 hover:text-[color:var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-40"
      style={danger ? { ["--hover-color" as string]: "var(--c-danger)" } : undefined}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------- AFTER 2 — static mockup */

function After2() {
  return (
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: "var(--c-border)",
        background: "color-mix(in oklab, var(--c-bg-elev), black 2%)",
      }}
    >
      <div className="bracketed px-3 py-3">
        <div
          className="grid items-end gap-3"
          style={{
            gridTemplateColumns:
              "1.4fr 1.2fr 3rem 6rem 5rem 4rem 8rem 5rem auto",
          }}
        >
          <Field label="Турнир">
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-[color:var(--color-fg-dim)]"
              placeholder="$50 обычный MTT"
            />
          </Field>
          <Field label="Тип игры">
            <div className="flex items-center gap-1">
              <TightSelect>GG BR</TightSelect>
              <TightSelect>$10 · $100k top</TightSelect>
            </div>
          </Field>
          <Field label="AFS" align="right">
            <span className="tabular text-sm">18</span>
          </Field>
          <Field label="Бай-ин" align="right">
            <span className="tabular text-lg">
              9.20<span className="text-[color:var(--color-fg-dim)]">+0.80</span>
            </span>
          </Field>
          <Field label="ROI" align="right">
            <div className="flex flex-col items-end leading-tight">
              <span className="tabular text-base" style={{ color: "var(--c-accent)" }}>
                7<span className="text-xs opacity-60">%</span>
              </span>
              <span className="text-[9px] text-[color:var(--color-fg-dim)]">
                с RB <span style={{ color: "var(--c-success)" }}>+7.0%</span>
              </span>
            </div>
          </Field>
          <Field label="ITM" align="right">
            <span className="tabular text-sm">
              15<span className="text-[10px] text-[color:var(--color-fg-dim)]"> глоб</span>
            </span>
          </Field>
          <Field label="Выплаты">
            <TightSelect>GG Battle Royal</TightSelect>
          </Field>
          <Field label="Турниров" align="right">
            <span className="tabular text-lg">10 000</span>
          </Field>
          <div className="flex gap-0.5 opacity-60">
            <IconSquare />
            <IconCross />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  align = "left",
  children,
}: {
  label: string;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-1"
      style={{ alignItems: align === "right" ? "flex-end" : "flex-start" }}
    >
      <span
        className="uppercase"
        style={{
          letterSpacing: "0.2em",
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: "9px",
          color: "var(--c-fg-dim)",
        }}
      >
        {label}
      </span>
      <div
        className="w-full rounded border px-2 py-1.5"
        style={{
          borderColor: "color-mix(in oklab, var(--c-border), transparent 30%)",
          background: "color-mix(in oklab, var(--c-bg-elev-2), transparent 50%)",
          textAlign: align,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function TightSelect({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-[color:var(--color-fg)]">
      {children}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="opacity-60">
        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/* ---------------------------------------------- AFTER 3 — static mockup */

function After3() {
  return (
    <div
      className="rounded-lg border"
      style={{
        borderColor: "var(--c-border)",
        background: "color-mix(in oklab, var(--c-bg-elev), black 2%)",
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className="flex items-center overflow-hidden rounded-full border"
          style={{ borderColor: "var(--c-border)" }}
        >
          {[
            { k: "♠", c: "var(--c-spade)", active: false },
            { k: "♥", c: "var(--c-heart)", active: false },
            { k: "♦", c: "var(--c-diamond)", active: true },
            { k: "♣", c: "var(--c-club)", active: false },
          ].map((seg, i) => (
            <span
              key={i}
              className="px-2 py-0.5 text-sm"
              style={{
                background: seg.active
                  ? "color-mix(in oklab, var(--c-diamond), transparent 78%)"
                  : "transparent",
                color: seg.active ? seg.c : "var(--c-fg-dim)",
                borderLeft: i === 0 ? "none" : "1px solid var(--c-border)",
              }}
              title={["Freezeout", "PKO", "Mystery / Royale", "SNG"][i]}
            >
              {seg.k}
            </span>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-[color:var(--color-fg-dim)]"
            placeholder="$50 обычный MTT"
          />
          <span className="text-[10px] text-[color:var(--color-fg-dim)]">
            <span style={{ fontFamily: "var(--font-mono)" }}>GG-BR</span> · $10·$100k top · AFS 18 · ITM 15%
          </span>
        </div>

        <div className="flex flex-col items-end leading-tight">
          <span className="eyebrow">бай-ин</span>
          <span className="tabular text-base">
            $9.20<span className="text-[color:var(--color-fg-dim)]">+0.80</span>
          </span>
        </div>

        <div
          className="flex flex-col items-center rounded px-3 py-1.5"
          style={{
            background: "color-mix(in oklab, var(--c-success), transparent 84%)",
            border: "1px solid color-mix(in oklab, var(--c-success), transparent 55%)",
          }}
          title="ROI 7% (с RB +7.0%)"
        >
          <span
            className="eyebrow"
            style={{ color: "color-mix(in oklab, var(--c-success), white 20%)" }}
          >
            ROI
          </span>
          <span className="tabular text-base" style={{ color: "var(--c-success)" }}>
            +7%
          </span>
        </div>

        <div className="flex items-baseline gap-1">
          <span className="text-base text-[color:var(--color-fg-dim)]">×</span>
          <span
            className="tabular text-xl tracking-tight"
            style={{ color: "var(--c-accent)" }}
          >
            10 000
          </span>
        </div>

        <div className="flex gap-0.5" style={{ opacity: 0.5 }}>
          <IconSquare />
          <IconCross />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- shared atoms */

function MockInput({
  value,
  placeholder,
  align = "left",
  suffix,
  w,
}: {
  value?: string;
  placeholder?: string;
  align?: "left" | "right";
  suffix?: string;
  w?: string;
}) {
  return (
    <span
      className="inline-flex h-8 items-center rounded-md border px-2 text-xs"
      style={{
        borderColor: "var(--c-border)",
        background: "color-mix(in oklab, var(--c-bg-elev-2), black 7%)",
        width: w ?? "100%",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
      }}
    >
      <span style={{ color: value ? "var(--c-fg)" : "var(--c-fg-dim)" }}>
        {value ?? placeholder}
      </span>
      {suffix && <span className="ml-1 text-[color:var(--color-fg-dim)]">{suffix}</span>}
    </span>
  );
}

function MockSelect({ value, w }: { value: string; w?: string }) {
  return (
    <span
      className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px]"
      style={{
        borderColor: "var(--c-border)",
        background: "color-mix(in oklab, var(--c-bg-elev-2), transparent 30%)",
        width: w ?? "auto",
      }}
    >
      <span className="truncate">{value}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="ml-auto opacity-60">
        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function IconSquare() {
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded text-[color:var(--color-fg-dim)]"
      title="Duplicate"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function IconCross() {
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded text-[color:var(--color-fg-dim)]"
      title="Remove"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}
