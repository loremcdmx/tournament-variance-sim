type JobStatus = "idle" | "running" | "done" | "error";

// `run()` drops an in-flight PrimeDope-only re-run itself (it bumps the PD job
// id, resets the pool and clears the PD state) and recomputes both panes from
// the live controls, so such a re-run never has a reason to block Run.
export function canStartRun(state: {
  activeMode: string;
  mttModel: string;
  status: JobStatus;
}): boolean {
  return (
    state.activeMode === "mtt" &&
    state.mttModel === "mechanical" &&
    state.status !== "running"
  );
}

// A PrimeDope-only re-run writes into the run it started on. Leaving that run
// would drop the job with the toggle already applied to the controls and the
// pane still on the old data, so the switch waits for the job instead.
export function canSwitchRun(state: {
  pdStatus: JobStatus;
  sameRun: boolean;
}): boolean {
  return state.sameRun || state.pdStatus !== "running";
}
