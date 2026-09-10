import { describe, expect, it } from "vitest";
import { validateAndNormalizeProposal } from "./accepted-interpretations";
import { buildTeachingInterpretationRequest } from "./context-projection";
import { createInitialTeachingState, reduceAcceptedStep } from "./teaching-state";
import { ALPHA_CORE_P4, ACTIVE_ALPHA_SEMANTIC_PROFILE } from "./semantic-profile";
import type { CompactEvidenceCheckpoint, TeachingInterpretationProposal, TeachingInterpretationStepProposal } from "./contracts";

// Synthetic regression for the public transcript's already-resolved Cue failure.
const cp = (id: string, sequence: number): CompactEvidenceCheckpoint => ({ checkpointId: id, lessonSequence: sequence, speechRunId: 1, startMs: sequence * 1000, endMs: sequence * 1000 + 500, text: `Synthetic answer ${id}.`, sourceFinalIds: [id], warnings: [] });
const checkpoints = [cp("a", 1), cp("b", 2)];
const ref = (checkpointId: string) => ({ checkpointId, quote: "provider text is not trusted" });
const step = (id = "a"): TeachingInterpretationStepProposal => ({ consumesCheckpointIds: [id], boardDelta: { action: "KEEP", reason: "no_board_value" }, cueDelta: { action: "RESOLVE_CURRENT", reason: "answered", evidence: ref(id) }, evidenceRefs: [ref(id)] });
function setup(batch = checkpoints.slice(0, 1), profile = ACTIVE_ALPHA_SEMANTIC_PROFILE) {
  const state = createInitialTeachingState();
  const request = buildTeachingInterpretationRequest({ requestId: "request", sessionId: "synthetic", currentState: state, newEvidence: batch, events: [], profile }).request;
  const proposal: TeachingInterpretationProposal = { requestId: request.requestId, baseBoardRevision: 0, baseCueRevision: 0, steps: batch.map(c => step(c.checkpointId)) };
  const validate = () => validateAndNormalizeProposal({ proposal, request, state, allCheckpoints: checkpoints, model: "offline", profile });
  return { state, request, proposal, validate };
}
describe("audited empty-Cue resolution resilience", () => {
  it("normalizes only the redundant Cue action, preserves legal Board work and raw proposal", () => {
    const t = setup();
    t.proposal.steps[0]!.boardDelta = { action: "SET_ACTIVE", continuity: "same_thread", retainPrevious: false, contribution: { mode: "REPRESENT", content: { kind: "TEXT", text: "Synthetic answer." }, provenance: { basis: "SPEECH", speechRefs: [ref("a")] } } };
    const raw = structuredClone(t.proposal); const result = t.validate();
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(t.proposal).toEqual(raw);
    expect(result.steps[0]).toMatchObject({ consumesCheckpointIds: ["a"], boardDelta: { action: "SET_ACTIVE" }, cueDelta: { action: "KEEP" }, warnings: [{ code: "cue_resolution_noop", detail: "empty-cue-resolve-noop-v1" }] });
    const after = reduceAcceptedStep(t.state, result.steps[0]!, new Map([["a", 1]]));
    expect(after.board.active?.contribution.content).toEqual({ kind: "TEXT", text: "Synthetic answer." });
    expect(after.cue).toEqual(t.state.cue);
  });
  it("uses rolling state: resolve a newly established Cue, then normalize a duplicate resolution", () => {
    const t = setup([cp("a", 1), cp("b", 2), cp("c", 3)]);
    t.proposal.steps[0]!.cueDelta = { action: "SET", cueKind: "QUESTION", contribution: { mode: "REPRESENT", content: "Synthetic question?", provenance: { basis: "SPEECH", speechRefs: [ref("a")] } } };
    const result = validateAndNormalizeProposal({ request: t.request, proposal: t.proposal, state: t.state, allCheckpoints: t.request.newEvidence, model: "offline" });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.steps.map(s => s.cueDelta.action)).toEqual(["SET", "RESOLVE_CURRENT", "KEEP"]);
    expect(result.steps.map(s => s.warnings.some(w => w.code === "cue_resolution_noop"))).toEqual([false, false, true]);
  });
  it.each(["request", "revision", "conflict", "coverage", "future", "trigger", "board"])("does not hide invalid %s", (kind) => {
    const t = setup();
    if (kind === "request") t.proposal.requestId = "stale";
    if (kind === "revision") t.proposal.baseCueRevision = 1;
    if (kind === "conflict") t.request.currentState = { ...t.state, cue: { revision: 1 } }, t.proposal.baseCueRevision = 1;
    if (kind === "coverage") t.proposal.steps[0]!.consumesCheckpointIds = ["b"];
    if (kind === "future") t.proposal.steps[0]!.evidenceRefs = [ref("b")];
    if (kind === "trigger") t.proposal.steps[0]!.evidenceRefs = [];
    if (kind === "board") t.proposal.steps[0]!.boardDelta = { action: "RETIRE_ACTIVE", targetBoardItemId: "missing", disposition: "discard", reason: "completed" };
    expect(t.validate().ok).toBe(false);
  });
  it("rejects the entire multi-step proposal if a later step is invalid", () => {
    const t = setup(checkpoints); t.proposal.steps[1]!.cueDelta = { action: "ATTACH_HINT", targetCueId: "missing", contribution: { mode: "REPRESENT", content: "Synthetic hint", provenance: { basis: "SPEECH", speechRefs: [ref("b")] } } };
    expect(t.validate()).toEqual({ ok: false, error: "proposal-cue-target-not-active" });
    expect(t.state).toEqual(createInitialTeachingState());
  });
  it("does not change the frozen v7 profile's rejection", () => {
    expect(setup(checkpoints.slice(0, 1), ALPHA_CORE_P4).validate()).toEqual({ ok: false, error: "proposal-cue-resolution-without-active-cue" });
  });
});
