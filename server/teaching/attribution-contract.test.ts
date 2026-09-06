import { describe, expect, it } from "vitest";
import { ATTRIBUTION_INSTRUCTION } from "./attribution-contract";
import { teachingProviderContract, normalizeTeachingProposal, type ProviderProposal } from "./provider-contract";
import { createOutputReferenceCodec } from "./output-reference-codec";
import { validateAndNormalizeProposal } from "../../src/lesson-stream/accepted-interpretations";
import { createInitialTeachingState } from "../../src/lesson-stream/teaching-state";
import { ALPHA_CONTINUOUS_BOUNDED as profile, ALPHA_CONTINUOUS_P4, ALPHA_CORE_P4 } from "../../src/lesson-stream/semantic-profile";
import type { TeachingInterpretationRequest } from "../../src/lesson-stream/contracts";

// Synthetic analogue of frozen MIT B#63. Authored attribution expectations, not inferred keywords or model accuracy.
const texts = ["The catalyst is a solid metal.", "It catalyzes reactions of gases.", "Solid and gas are different phases.", "The room has blue chairs.", "A future answer."];
const checkpoints = texts.map((text, i) => ({ checkpointId: `s${i}`, lessonSequence: [2, 3, 4, 0, 5][i]!, speechRunId: 1, startMs: [2, 3, 4, 0, 5][i]! * 1000, endMs: [2, 3, 4, 0, 5][i]! * 1000 + 900, text, sourceFinalIds: [], warnings: [] }));
const category = { ...checkpoints[0]!, checkpointId: "category", lessonSequence: 1, text: "Catalyst and reactants are in different phases." };
checkpoints.push(category);
function fixture(stateCarriesMaterial = false) {
  const state = createInitialTeachingState();
  state.board.active = { id: "board-existing", establishedAtRevision: 1, sourceCheckpointIds: [stateCarriesMaterial ? "s0" : "category"], contribution: { mode: "REPRESENT", content: { kind: "TEXT", text: stateCarriesMaterial ? texts[0]! : "Catalyst and reactants are in different phases." }, provenance: { basis: "SPEECH", speechRefs: [{ checkpointId: stateCarriesMaterial ? "s0" : "category", quote: stateCarriesMaterial ? texts[0]! : category.text }] } } };
  const request: TeachingInterpretationRequest = { requestId: "synthetic-attribution", sessionId: "synthetic", semanticProfileId: profile.id, policyVersion: profile.policyVersion, currentState: state, processedTimeline: [checkpoints[3]!, category, checkpoints[0]!].map(c => ({ type: "evidence", checkpointId: c.checkpointId, sequence: c.lessonSequence, text: c.text, warnings: [] })), newEvidence: checkpoints.slice(1, 3), expected: { firstUnconsumedSequence: 3, lastUnconsumedSequence: 4 } };
  return request;
}
function candidate(request: TeachingInterpretationRequest, ids: string[], stateRef = false): ProviderProposal {
  return { requestId: request.requestId, baseBoardRevision: 0, baseCueRevision: 0, warnings: null, steps: [{ consumesCheckpointIds: ["s1", "s2"], boardDelta: { action: "ADD_SUPPORT", targetBoardItemId: "board-existing", support: { mode: "REPRESENT", content: "A solid metal catalyst catalyzes gas reactions across different phases.", provenance: { basis: stateRef ? "SPEECH_AND_STATE" : "SPEECH", speechRefs: ids.map(checkpointId => ({ checkpointId })), stateRefs: stateRef ? [{ kind: "BOARD_ITEM", id: "board-existing" }] : null } } }, cueDelta: { action: "KEEP" }, evidenceRefs: [{ checkpointId: "s2" }], warnings: null }] };
}
function validate(request: TeachingInterpretationRequest, raw: ProviderProposal) {
  const proposal = normalizeTeachingProposal(raw, request);
  return validateAndNormalizeProposal({ proposal, request, allCheckpoints: checkpoints, state: request.currentState, model: "synthetic-no-provider" });
}
describe("necessary factual attribution contract (offline, not model conformance)", () => {
  it("documents why the B63 pattern remains mechanically accepted despite semantic incompleteness", () => {
    const request = fixture();
    const incomplete = candidate(request, ["s1", "s2"], true);
    expect(validate(request, incomplete).ok).toBe(true);
    // Human-authored case annotation: s0 supplies a fact absent from the cited state; no string matcher in production.
    expect(incomplete.steps[0]!.boardDelta).toMatchObject({ support: { provenance: { speechRefs: [{ checkpointId: "s1" }, { checkpointId: "s2" }] } } });
  });
  it("accepts necessary multi-fragment attribution without reconsuming history or citing unrelated history", () => {
    const request = fixture(); const raw = candidate(request, ["s0", "s1", "s2"]);
    const codec = createOutputReferenceCodec(request);
    expect(codec.expand(codec.encode(raw))).toEqual(raw);
    expect(validate(request, raw).ok).toBe(true);
    expect(raw.steps[0]!.consumesCheckpointIds).toEqual(["s1", "s2"]);
    expect(JSON.stringify(raw)).not.toContain('"s3"');
  });
  it("permits explicit state provenance carrying the equivalent historical factual basis", () => {
    const request = fixture(true);
    expect(request.currentState.board.active!.contribution.provenance.speechRefs![0]!.checkpointId).toBe("s0");
    expect(validate(request, candidate(request, ["s1", "s2"], true)).ok).toBe(true);
  });
  it.each(["s4", "not-supplied"])("continues rejecting future/unsupplied %s", id => {
    const request = fixture(); const raw = candidate(request, ["s0", "s1", id]);
    expect(validate(request, raw).ok).toBe(false);
    expect(() => createOutputReferenceCodec(request).encode(raw)).toThrow("reference-unknown");
  });
  it("rejects a supplied next-step fact even though its compact handle exists", () => {
    const request = fixture(); const raw = candidate(request, ["s0", "s1", "s2"]);
    raw.steps[0]!.consumesCheckpointIds = ["s1"]; raw.steps[0]!.evidenceRefs = [{ checkpointId: "s1" }];
    raw.steps.push({ consumesCheckpointIds: ["s2"], boardDelta: { action: "KEEP", reason: "filler" }, cueDelta: { action: "KEEP" }, evidenceRefs: [], warnings: null });
    const codec = createOutputReferenceCodec(request); expect(codec.expand(codec.encode(raw))).toEqual(raw);
    expect(validate(request, raw).ok).toBe(false);
  });
  it("strengthens only live bounded instructions and explicitly assigns semantic responsibility", () => {
    expect(teachingProviderContract(profile).systemPolicy).toContain(ATTRIBUTION_INSTRUCTION);
    expect(ATTRIBUTION_INSTRUCTION).toContain("not by matching words");
    expect(ATTRIBUTION_INSTRUCTION).toContain("explicitly cited state item");
    expect(teachingProviderContract(ALPHA_CONTINUOUS_P4).systemPolicy).not.toContain(ATTRIBUTION_INSTRUCTION);
    expect(teachingProviderContract(ALPHA_CORE_P4).systemPolicy).not.toContain(ATTRIBUTION_INSTRUCTION);
  });
});
