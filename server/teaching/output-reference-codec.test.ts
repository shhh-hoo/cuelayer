import { describe, expect, it } from "vitest";
import { createOutputReferenceCodec, OUTPUT_PROTOCOL_VERSION, usesCompactOutput } from "./output-reference-codec";
import { createTeachingInterpretationSchema, normalizeTeachingProposal, type ProviderProposal } from "./provider-contract";
import { validateAndNormalizeProposal } from "../../src/lesson-stream/accepted-interpretations";
import { createInitialTeachingState, reduceAcceptedStep } from "../../src/lesson-stream/teaching-state";
import { ALPHA_CONTINUOUS_BOUNDED, ALPHA_CONTINUOUS_P4, ALPHA_CORE_P4 } from "../../src/lesson-stream/semantic-profile";
import type { CompactEvidenceCheckpoint, TeachingInterpretationRequest, TeachingStateSnapshot } from "../../src/lesson-stream/contracts";

// Synthetic codec fixtures, not lesson material or semantic gold. No provider is called.
const profile = ALPHA_CONTINUOUS_BOUNDED;
const literal = "Synthetic literal e0 nb0 checkpoint-new-1 board-existing; do not rewrite.";
const ref = (checkpointId = "checkpoint-new-1") => ({ checkpointId });
const provenance = (checkpointId = "checkpoint-new-1") => ({ basis: "SPEECH" as const, speechRefs: [ref(checkpointId)], stateRefs: null });
const textContribution = (checkpointId = "checkpoint-new-1") => ({ mode: "REPRESENT" as const, content: literal, provenance: provenance(checkpointId) });
const boardContribution = (checkpointId = "checkpoint-new-1") => ({ ...textContribution(checkpointId), content: { kind: "TEXT" as const, text: literal } });
type Step = ProviderProposal["steps"][number];
const step = (change: Partial<Step> = {}): Step => ({
  consumesCheckpointIds: ["checkpoint-new-1"], boardDelta: { action: "KEEP", reason: "no_board_value" },
  cueDelta: { action: "KEEP" }, evidenceRefs: [ref()], warnings: null, ...change,
});
const setBoard = (checkpointId = "checkpoint-new-1"): Step["boardDelta"] => ({
  action: "SET_ACTIVE", contribution: boardContribution(checkpointId), continuity: "same_thread", retainPrevious: false,
  support: null, invalidatesBoardItemIds: null,
});

function fixture(count = 1, populated = false) {
  const checkpoints: CompactEvidenceCheckpoint[] = Array.from({ length: count + 1 }, (_, index) => ({
    checkpointId: index === 0 ? "checkpoint-old" : `checkpoint-new-${index}`, lessonSequence: index + 1,
    speechRunId: 1, startMs: index * 100, endMs: index * 100 + 90, text: literal,
    sourceFinalIds: [`synthetic-final-${index}`], warnings: [],
  }));
  const currentState = createInitialTeachingState();
  if (populated) {
    const contribution = { mode: "REPRESENT" as const, content: { kind: "TEXT" as const, text: literal }, provenance: {
      basis: "SPEECH" as const, speechRefs: [{ checkpointId: "checkpoint-old", quote: literal }],
    } };
    currentState.board = { revision: 4, active: { id: "board-existing", contribution, sourceCheckpointIds: ["checkpoint-old"], establishedAtRevision: 1 },
      retained: [{ id: "board-retained", contribution, sourceCheckpointIds: ["checkpoint-old"], establishedAtRevision: 2 }],
      support: [{ id: "support-existing", targetBoardItemId: "board-existing", contribution: { ...contribution, content: literal } }] };
    currentState.cue = { revision: 3, active: { id: "cue-existing", kind: "QUESTION", activatedAt: 100,
      contribution: { ...contribution, content: literal }, sourceSegmentIds: ["checkpoint-old"], targetBoardItemId: "board-existing",
      hint: { contribution: { ...contribution, content: literal }, sourceCheckpointIds: ["checkpoint-old"] } } };
  }
  const request: TeachingInterpretationRequest = {
    requestId: "synthetic-request", sessionId: "synthetic-session", semanticProfileId: profile.id, policyVersion: profile.policyVersion,
    processedTimeline: [{ type: "evidence", checkpointId: "checkpoint-old", sequence: 1, text: literal, warnings: [] }],
    currentState, newEvidence: checkpoints.slice(1), expected: { firstUnconsumedSequence: 2, lastUnconsumedSequence: count + 1 },
  };
  return { request, checkpoints };
}
function proposal(request: TeachingInterpretationRequest, steps: Step[]): ProviderProposal {
  return { requestId: request.requestId, baseBoardRevision: request.currentState.board.revision,
    baseCueRevision: request.currentState.cue.revision, steps, warnings: null };
}
function validate(request: TeachingInterpretationRequest, checkpoints: CompactEvidenceCheckpoint[], steps: Step[], state = request.currentState) {
  const codec = createOutputReferenceCodec(request);
  const restored = codec.expand(codec.encode(createTeachingInterpretationSchema(profile).parse(proposal(request, steps))));
  return validateAndNormalizeProposal({ proposal: normalizeTeachingProposal(restored, request), request, allCheckpoints: checkpoints,
    state, model: "synthetic-no-provider", profile, acceptedAt: "2026-01-01T00:00:00.000Z" });
}

describe("request-local output reference codec", () => {
  it("is limited to the bounded profile and creates deterministic auditable copies", () => {
    const { request } = fixture(1, true);
    const before = structuredClone(request);
    const codec = createOutputReferenceCodec(request);
    expect(usesCompactOutput(profile)).toBe(true);
    expect(usesCompactOutput(ALPHA_CONTINUOUS_P4)).toBe(false);
    expect(usesCompactOutput(ALPHA_CORE_P4)).toBe(false);
    expect(codec.audit).toEqual(createOutputReferenceCodec(request).audit);
    expect(codec.input).toEqual(createOutputReferenceCodec(request).input);
    expect(codec.audit).toMatchObject({ version: OUTPUT_PROTOCOL_VERSION, requestId: request.requestId, baseBoardRevision: 4, baseCueRevision: 3 });
    expect(request).toEqual(before);
    expect(codec.input).not.toBe(request);
    expect(codec.input.currentState.board.active?.id).toBe("b0");
    expect(codec.input.currentState.board.support[0]).toMatchObject({ id: "s0", targetBoardItemId: "b0" });
    expect(codec.input.currentState.cue.active).toMatchObject({ id: "c0", sourceSegmentIds: ["e0"], hint: { sourceCheckpointIds: ["e0"] } });
    expect(codec.input.processedTimeline[0]).toMatchObject({ checkpointId: "e0", text: literal });
    expect(codec.input.newEvidence[0]).toMatchObject({ checkpointId: "e1", text: literal, sourceFinalIds: ["synthetic-final-1"] });
    expect(codec.input.currentState.board.active?.contribution.content).toEqual({ kind: "TEXT", text: literal });
    expect(codec.input.currentState.cue.active?.contribution.provenance.speechRefs?.[0]?.quote).toBe(literal);
  });

  it("round-trips every Board/Cue action and structural reference without changing literal content", () => {
    const { request } = fixture(1, true);
    const codec = createOutputReferenceCodec(request);
    const stateProvenance = { basis: "SPEECH_AND_STATE" as const, speechRefs: [ref("checkpoint-old"), ref()],
      stateRefs: [{ kind: "BOARD_ITEM" as const, id: "board-existing" }, { kind: "ACTIVE_CUE" as const, id: "cue-existing" }] };
    const boardDeltas: Step["boardDelta"][] = [
      { action: "KEEP", reason: "unfinished" },
      { action: "SET_ACTIVE", contribution: { ...boardContribution(), provenance: stateProvenance }, continuity: "correction", retainPrevious: false,
        support: [{ ...textContribution(), mode: "AUGMENT", provenance: { basis: "STATE_AND_DOMAIN_KNOWLEDGE", speechRefs: null, stateRefs: [{ kind: "BOARD_ITEM", id: "board-retained" }] } }], invalidatesBoardItemIds: ["board-existing", "board-retained"] },
      { action: "ADD_SUPPORT", targetBoardItemId: "board-retained", support: { ...textContribution(), provenance: stateProvenance } },
      { action: "RETIRE_ACTIVE", targetBoardItemId: "board-existing", disposition: "retain", reason: "completed" },
    ];
    const cueDeltas: Step["cueDelta"][] = [
      { action: "KEEP" }, { action: "RESOLVE_CURRENT", reason: "answered", evidence: ref() },
      { action: "ATTACH_HINT", targetCueId: "cue-existing", contribution: { ...textContribution(), provenance: stateProvenance } },
      ...(["NOTE", "QUESTION", "TASK", "HINT"] as const).flatMap((cueKind): Step["cueDelta"][] => [
        { action: "SET", cueKind, contribution: textContribution(), targetBoardItemId: "board-existing" },
        { action: "REPLACE_CURRENT", cueKind, targetCueId: "cue-existing", reason: "replaced", evidence: ref(), contribution: textContribution(), targetBoardItemId: null },
      ]),
    ];
    for (const boardDelta of boardDeltas) for (const cueDelta of cueDeltas) {
      const raw = createTeachingInterpretationSchema(profile).parse(proposal(request, [step({ boardDelta, cueDelta, warnings: [{ code: "e0", detail: literal }] })]));
      raw.warnings = [{ code: "b0", detail: literal }];
      const compact = codec.encode(raw);
      expect(compact).not.toHaveProperty("requestId");
      expect(compact).not.toHaveProperty("baseBoardRevision");
      expect(compact).not.toHaveProperty("baseCueRevision");
      expect(codec.expand(compact)).toEqual(raw);
    }
  });

  it("maps journal contribution IDs and typed provenance consistently with current state", () => {
    const { request } = fixture(1, true);
    request.processedTimeline.push({ type: "accepted_interpretation", interpretationId: "synthetic-historical-accepted",
      contributionIds: { board: "board-existing", cue: "cue-existing" }, consumesCheckpointIds: ["checkpoint-old"],
      boardDelta: { action: "KEEP", reason: "repetition" }, cueDelta: { action: "KEEP" }, resultingBoardRevision: 4, resultingCueRevision: 3 });
    const codec = createOutputReferenceCodec(request);
    const entry = codec.input.processedTimeline[1];
    expect(entry).toMatchObject({ interpretationId: "synthetic-historical-accepted", contributionIds: { board: "b0", cue: "c0" }, consumesCheckpointIds: ["e0"] });
    expect(codec.input.currentState.board.active?.id).toBe("b0");
    expect(codec.input.currentState.cue.active?.id).toBe("c0");
  });

  it.each(["e999", "b0", "checkpoint-new-1"])("rejects unknown, wrong-kind and canonical fallback evidence %s", (bad) => {
    const { request } = fixture(1, true);
    const codec = createOutputReferenceCodec(request);
    const compact = codec.encode(proposal(request, [step()]));
    compact.steps[0]!.consumesCheckpointIds = [bad];
    expect(() => codec.expand(compact)).toThrow("teaching-output-reference-unknown:e:");
  });

  it("rejects namespace substitutions in state provenance and Board/Cue targets", () => {
    const { request } = fixture(1, true);
    const codec = createOutputReferenceCodec(request);
    const candidates: Step[] = [
      step({ boardDelta: { action: "RETIRE_ACTIVE", targetBoardItemId: "s0", disposition: "discard", reason: "completed" } }),
      step({ cueDelta: { action: "ATTACH_HINT", targetCueId: "b0", contribution: { ...textContribution(), provenance: { ...provenance(), speechRefs: [ref("e1")] } } } }),
      step({ boardDelta: { action: "ADD_SUPPORT", targetBoardItemId: "b0", support: { ...textContribution(), provenance: {
        basis: "SPEECH_AND_STATE", speechRefs: [ref("e1")], stateRefs: [{ kind: "ACTIVE_CUE", id: "b0" }],
      } } } }),
    ];
    for (const item of candidates) {
      item.consumesCheckpointIds = ["e1"]; item.evidenceRefs = [ref("e1")];
      expect(() => codec.expand({ steps: [item], warnings: null })).toThrow("teaching-output-reference-unknown:");
    }
  });

  it("preserves same-step and earlier-step Board/Cue identities through real validation and reduction", () => {
    const { request, checkpoints } = fixture(3);
    const boardId = `board-${request.requestId}-accepted-0`;
    const cueId = `cue-${request.requestId}-accepted-0`;
    const steps = [
      step({ boardDelta: setBoard(), cueDelta: { action: "SET", cueKind: "QUESTION", contribution: textContribution(), targetBoardItemId: boardId } }),
      step({ consumesCheckpointIds: ["checkpoint-new-2"], evidenceRefs: [ref("checkpoint-new-2")],
        boardDelta: { action: "ADD_SUPPORT", targetBoardItemId: boardId, support: { ...textContribution("checkpoint-new-2"), provenance: {
          basis: "SPEECH_AND_STATE", speechRefs: [ref("checkpoint-new-2")], stateRefs: [{ kind: "BOARD_ITEM", id: boardId }],
        } } }, cueDelta: { action: "ATTACH_HINT", targetCueId: cueId, contribution: textContribution("checkpoint-new-2") } }),
      step({ consumesCheckpointIds: ["checkpoint-new-3"], evidenceRefs: [ref("checkpoint-new-3")],
        cueDelta: { action: "REPLACE_CURRENT", targetCueId: cueId, reason: "replaced", evidence: ref("checkpoint-new-3"), cueKind: "TASK", contribution: textContribution("checkpoint-new-3"), targetBoardItemId: boardId } }),
    ];
    const codec = createOutputReferenceCodec(request);
    expect(codec.encode(proposal(request, steps)).steps[0]?.cueDelta).toMatchObject({ targetBoardItemId: "nb0" });
    expect(codec.encode(proposal(request, steps)).steps[1]?.cueDelta).toMatchObject({ targetCueId: "nc0" });
    const result = validate(request, checkpoints, steps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sequences = new Map(checkpoints.map(c => [c.checkpointId, c.lessonSequence]));
    const final = result.steps.reduce((state, accepted) => reduceAcceptedStep(state, accepted, sequences), request.currentState);
    expect(final.board.active?.id).toBe(boardId);
    expect(final.board.support[0]?.targetBoardItemId).toBe(boardId);
    expect(final.cue.active).toMatchObject({ id: `cue-${request.requestId}-accepted-2`, kind: "TASK", targetBoardItemId: boardId });
    expect(final.processedThroughSequence).toBe(4);
    expect(result.steps.flatMap(s => s.consumesCheckpointIds)).toEqual(request.newEvidence.map(c => c.checkpointId));
  });

  it("keeps future evidence and duplicate/out-of-order consumption invalid", () => {
    const { request, checkpoints } = fixture(2);
    const second = step({ consumesCheckpointIds: ["checkpoint-new-2"], evidenceRefs: [ref("checkpoint-new-2")] });
    expect(validate(request, checkpoints, [step({ boardDelta: setBoard("checkpoint-new-2") }), second])).toEqual({ ok: false, error: "proposal-provenance-checkpoint-invalid" });
    expect(validate(request, checkpoints, [step(), step()])).toEqual({ ok: false, error: "proposal-batch-coverage-invalid" });
    expect(validate(request, checkpoints, [second, step()])).toEqual({ ok: false, error: "proposal-batch-coverage-invalid" });
  });

  it("leaves future/retired mutation targets and optional Cue linkage to the existing validator", () => {
    const { request, checkpoints } = fixture(2, true);
    const future = `board-${request.requestId}-accepted-1`;
    const second = step({ consumesCheckpointIds: ["checkpoint-new-2"], evidenceRefs: [ref("checkpoint-new-2")] });
    expect(validate(request, checkpoints, [step({ boardDelta: { action: "ADD_SUPPORT", targetBoardItemId: future, support: textContribution() } }), second]))
      .toEqual({ ok: false, error: "proposal-support-target-missing" });
    expect(validate(request, checkpoints, [step({ boardDelta: { ...setBoard(), continuity: "topic_shift" } as Step["boardDelta"] }),
      { ...second, boardDelta: { action: "ADD_SUPPORT", targetBoardItemId: "board-existing", support: textContribution("checkpoint-new-2") } }]))
      .toEqual({ ok: false, error: "proposal-support-target-missing" });
    const optional = fixture();
    const result = validate(optional.request, optional.checkpoints, [step({ cueDelta: { action: "SET", cueKind: "NOTE", contribution: textContribution(), targetBoardItemId: future } })]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.steps[0]?.warnings).toContainEqual({ code: "cue_target_dropped" });
  });

  it("binds identity before later mutations and keeps live-state conflicts rejecting the full proposal", () => {
    const { request, checkpoints } = fixture(1, true);
    const snapshot = structuredClone(request);
    const codec = createOutputReferenceCodec(request);
    const compact = codec.encode(proposal(request, [step()]));
    request.requestId = "changed-after-binding"; request.currentState.board.revision = 99; request.currentState.cue.revision = 99;
    const restored = codec.expand(compact);
    expect(restored).toMatchObject({ requestId: snapshot.requestId, baseBoardRevision: 4, baseCueRevision: 3 });
    expect(codec.input.currentState.board.revision).toBe(4);
    const state: TeachingStateSnapshot = structuredClone(snapshot.currentState); state.cue.revision += 1;
    expect(validateAndNormalizeProposal({ proposal: normalizeTeachingProposal(restored, snapshot), request: snapshot, allCheckpoints: checkpoints,
      state, model: "synthetic-no-provider", profile })).toEqual({ ok: false, error: "interpretation-state-conflict" });
  });

  it("preserves audited empty-Cue resolution no-op together with legal Board support", () => {
    const { request, checkpoints } = fixture(1, true); request.currentState.cue = { revision: 3 };
    const result = validate(request, checkpoints, [step({ boardDelta: { action: "ADD_SUPPORT", targetBoardItemId: "board-existing", support: textContribution() },
      cueDelta: { action: "RESOLVE_CURRENT", evidence: ref(), reason: "answered" } })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0]).toMatchObject({ boardDelta: { action: "ADD_SUPPORT", targetBoardItemId: "board-existing" }, cueDelta: { action: "KEEP" } });
    expect(result.steps[0]?.warnings).toContainEqual({ code: "cue_resolution_noop", detail: "empty-cue-resolve-noop-v1" });
  });
});
