"use client";

import dynamic from "next/dynamic";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { ItmTargetConfig } from "@/lib/sim/itmTarget";
import type { FinishModelConfig, TournamentRow } from "@/lib/sim/types";
import { LazyDisclosure } from "./ui/LazyDisclosure";

const ConvergenceChart = dynamic(() => import("./charts/ConvergenceChart").then(module => module.ConvergenceChart));
const ProveEdgeCard = dynamic(() => import("./charts/ProveEdgeCard").then(module => module.ProveEdgeCard));

export function VolumePlanningPanel({
  schedule,
  finishModel,
  noiseActive,
  itmTarget,
  defaultMode,
}: {
  schedule?: TournamentRow[];
  finishModel?: FinishModelConfig;
  noiseActive?: boolean;
  itmTarget: ItmTargetConfig;
  defaultMode?: "avg" | "exact";
}) {
  const t = useT();
  return (
    <LazyDisclosure title={t("app.analysisTools")} description={t("app.analysisToolsHint")}>
      <div className="grid min-w-0 gap-6 4xl:grid-cols-2 4xl:items-start">
        <section className="min-w-0">
          <h3 className="mb-2 text-base font-semibold">{t("chart.convergence")}</h3>
          <p className="mb-3 text-xs text-fg-muted">{t("chart.convergence.sub")}</p>
          <ConvergenceChart schedule={schedule} finishModel={finishModel} noiseActive={noiseActive} itmTarget={itmTarget} defaultMode={defaultMode} />
        </section>
        <section className="min-w-0 border-t border-border pt-5 4xl:border-t-0 4xl:border-l 4xl:pl-5 4xl:pt-0">
          <ProveEdgeCard schedule={schedule} finishModel={finishModel} noiseActive={noiseActive} itmTarget={itmTarget} defaultMode={defaultMode} />
        </section>
      </div>
    </LazyDisclosure>
  );
}
