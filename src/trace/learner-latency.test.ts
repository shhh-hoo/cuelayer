import { describe, expect, it } from "vitest";
import { LearnerLatencyTracker, latencyDerived } from "./learner-latency";
import { traceDraft, prepareTraceEvent, sanitizeTraceEvent, type SessionTraceDraft } from "./contracts";
import { PcmLatencyClock } from "../session/pcm-latency-clock";

function setup(capacity = 256) {
  const tracker = new LearnerLatencyTracker(capacity);
  tracker.observe(traceDraft("speech.final_received", { runId: "r", transcript: "Synthetic", wordCount: 1, latency: { speechEndMs: 100, asrFinalAt: 1200, speechObservedAt: 1000, speechClockBasis: "pcm-delivery-observation", speechMappingUncertaintyMs: 20 } }, { correlation: { speechEventId: "f" } }));
  tracker.observe(traceDraft("canonical.final_committed", { runId: "r", finalId: "final", speechEventId: "f", transcript: "Synthetic", wordCount: 1 }));
  const stage = (stage: import("./learner-latency").LatencyStage["stage"], at: number, extra = {}) => tracker.observe(traceDraft("latency.stage", { stage, at, runId: "r", checkpointIds: ["cp"], ...extra }));
  stage("committed", 1300, { speechEndMs: 100, sourceFinalIds: ["final"], checkpointClosedAt: 1250 }); stage("eligible", 1310); stage("started", 1400, { requestId: "request", batchSize: 1, pendingCount: 1, oldestPendingAgeMs: 100 });
  return { tracker, stage };
}
const record = (out: SessionTraceDraft[]) => out.find(x => x.type === "latency.checkpoint")! as SessionTraceDraft<"latency.checkpoint">;
describe("learner latency observation, no interpreter calls", () => {
  it("correlates all clock domains without subtracting audio-relative or server epochs", () => {
    const { tracker, stage } = setup(); stage("provider", 1600, { providerDurationMs: 150, providerTimingScope: "server-sdk" }); stage("validation", 1620, { validationStatus: "accepted" }); stage("reduced", 1650, { boardRevision: 1, cueRevision: 0, stateChanged: true });
    const output = record(tracker.observe(traceDraft("teaching_surface.visibility", { renderId: "v", boardRevision: 1, cueRevision: 0, rendererCommittedAt: 1660, domVisibleAt: 1700, observation: "visible" })));
    expect(output.payload).toMatchObject({ speechEndMs: 100, asrFinalAt: 1200, checkpointCommittedAt: 1300, plannerEligibleAt: 1310, plannerStartedAt: 1400, providerFinishedAt: 1600, proposalAcceptedAt: 1650, stateReducedAt: 1650, rendererCommittedAt: 1660, domVisibleAt: 1700, retryAttempt: 1, derived: { speechToAsrMs: 200, asrToCommitMs: 100, commitToPlannerStartMs: 100, providerMs: 150, providerToStateMs: 50, stateToDomMs: 50, speechToDomMs: 700 } });
    const exported = JSON.parse(JSON.stringify(sanitizeTraceEvent(prepareTraceEvent("session", "browser", 1, output))));
    expect(exported.payload.domVisibleAt).toBe(1700);
  });
  it("exports timeout and retry separately, without manufacturing accepted/DOM timestamps", () => {
    const { stage } = setup(); const timeout = record(stage("timeout", 7400));
    expect(timeout.payload).toMatchObject({ retryAttempt: 1, timeoutAt: 7400, proposalAcceptedAt: null, domVisibleAt: null });
    expect(timeout.payload.derived.providerMs).toBe(6000);
    expect(record(stage("started", 8000, { requestId: "retry" })).payload).toMatchObject({ retryAttempt: 2, timeoutAt: null, providerFinishedAt: null });
  });
  it.each(["hidden", "empty", "not_in_viewport", "unavailable"] as const)("does not claim DOM visibility for %s", observation => {
    const { tracker, stage } = setup(); stage("reduced", 1500, { boardRevision: 1, cueRevision: 1, stateChanged: true });
    expect(record(tracker.observe(traceDraft("teaching_surface.visibility", { renderId: "v", boardRevision: 1, cueRevision: 1, rendererCommittedAt: 1510, domVisibleAt: null, observation }))).payload.derived.stateToDomMs).toBeNull();
  });
  it("does not count KEEP or a superseded intermediate revision as new learner-visible work", () => {
    for (const stateChanged of [true, false]) {
      const { tracker, stage } = setup(); stage("reduced", 1500, { boardRevision: 1, cueRevision: 0, stateChanged });
      const p = record(tracker.observe(traceDraft("teaching_surface.visibility", { renderId: "v", boardRevision: 2, cueRevision: 0, rendererCommittedAt: 1510, domVisibleAt: 1600, observation: "visible" }))).payload;
      expect(p.domVisibleAt).toBeNull(); expect(p.domObservation).toBe(stateChanged ? "superseded_before_observation" : "no_surface_change");
    }
  });
  it("keeps original speech run identity through a later-run retry", () => {
    const { stage } = setup();
    expect(record(stage("started", 1500, { runId: "next-run" })).payload).toMatchObject({ runId: "r", asrFinalAt: 1200 });
  });
  it("requires the affected item to be visible, not unrelated hidden Support", () => {
    for (const target of ["active", "support"]) {
      const { tracker, stage } = setup(); stage("reduced", 1500, { boardRevision: 1, cueRevision: 0, stateChanged: true });
      // Exercise the accepted-step observer with a minimal typed state transition.
      const before = { lessonRevision: 0, processedThroughSequence: 0, board: { revision: 0, retained: [], support: [] }, cue: { revision: 0 } };
      const contribution = { mode: "REPRESENT" as const, content: { kind: "TEXT" as const, text: "Synthetic" }, provenance: { basis: "SPEECH" as const } };
      const after = { ...before, board: { ...before.board, revision: 1, ...(target === "active" ? { active: { id: "active", contribution, establishedAtRevision: 1, sourceCheckpointIds: [] } } : { support: [{ id: "support", targetBoardItemId: "active", contribution: { ...contribution, content: "Example" } }] }) } };
      tracker.observe(traceDraft("interpretation.step_accepted", { requestId: "request", interpretationId: "synthetic", stepIndex: 0, boardAction: "SET_ACTIVE", cueAction: "KEEP", acceptedContribution: { board: { action: "SET_ACTIVE", support: [], invalidatesBoardItemIds: [] }, cue: { action: "KEEP" }, warnings: [] }, stateBeforeDigest: "synthetic", stateAfterDigest: "synthetic", checkpointIds: ["cp"], stateBefore: before, stateAfter: after }));
      const result = record(tracker.observe(traceDraft("teaching_surface.visibility", { renderId: "v", boardRevision: 1, cueRevision: 0, rendererCommittedAt: 1510, observedAt: 1600, domVisibleAt: 1600, observation: "visible", documentVisible: true, items: [{ id: "active", observation: "visible" }, { id: "support", observation: "hidden" }] })));
      expect(result.payload.domVisibleAt).toBe(target === "active" ? 1600 : null);
      expect(result.payload.domObservation).toBe(target === "active" ? "visible" : "hidden");
    }
  });
  it("does not infer affected items from a whole-surface observation when acceptance correlation is missing", () => {
    const { tracker, stage } = setup(); stage("reduced", 1500, { boardRevision: 1, cueRevision: 0, stateChanged: true });
    const p = record(tracker.observe(traceDraft("teaching_surface.visibility", { renderId: "v", boardRevision: 1, cueRevision: 0, rendererCommittedAt: 1510, observedAt: 1600, domVisibleAt: 1600, observation: "visible", documentVisible: true, items: [{ id: "active", observation: "visible" }] }))).payload;
    expect(p.domVisibleAt).toBeNull(); expect(p.domObservation).toBe("unavailable");
  });
  it("does not turn successful validation into durable acceptance if persistence fails", () => {
    const { stage } = setup(); stage("provider", 1600); stage("validation", 1620, { validationStatus: "accepted" });
    expect(record(stage("failed", 1700)).payload).toMatchObject({ proposalAcceptedAt: null, stateReducedAt: null, domVisibleAt: null });
  });
  it("bounds correlation memory and makes evicted/missing/clock-invalid measurements unavailable", () => {
    const { tracker } = setup(2);
    for (let i = 0; i < 5; i++) tracker.observe(traceDraft("latency.stage", { stage: "committed", at: 2000, checkpointIds: [`later-${i}`] }));
    expect(tracker.size).toBe(2);
    const p = record(tracker.observe(traceDraft("latency.stage", { stage: "started", at: 1000, checkpointIds: ["later-4"] }))).payload;
    expect(p.asrFinalAt).toBeNull(); expect(latencyDerived(p).commitToPlannerStartMs).toBeNull();
  });
  it("maps speech offsets to bounded PCM delivery metadata, never the microphone startup wall time", () => {
    const clock = new PcmLatencyClock(); clock.observe(480, 48000, 1000); clock.observe(480, 48000, 1020);
    expect(clock.resolve(15)).toEqual({ speechObservedAt: 1015, speechMappingUncertaintyMs: 10, speechClockBasis: "pcm-delivery-observation" });
    expect(clock.resolve(50).speechObservedAt).toBeNull();
    for (let i = 0; i < 600; i++) clock.observe(480, 48000, 1030 + i * 10);
    expect(clock.resolve(5).speechObservedAt).toBeNull();
  });
});
