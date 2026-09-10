import { describe, expect, it } from "vitest";
import { acceptCoreStep } from "./accepted-steps.ts";
import { cueMutationSchema, knowledgeOperationSchema, semanticReferenceSchema } from "./contracts.ts";
import { coreEntityId } from "./events.ts";
import { appendCoreEvent, pendingCoreEvidence } from "./replay.ts";
import { evidence, expire, fact, foundation, speechRef, start, stepFor } from "./test-fixtures.ts";

describe("pure atomic Core acceptance", () => {
  it.each(["CORE", "OBJECT", "RELATION"] as const)("accepts %s targets for both Support and Cue", kind => {
    const f = foundation(), base = evidence(f.replay), next = stepFor(base), cp = next.consumesCheckpointIds[0]!;
    const target = kind === "CORE" ? { kind, id: f.coreId } : { kind, coreId: f.coreId, id: kind === "OBJECT" ? f.a : f.relationId };
    next.knowledgeOps = [{ action: "REVISE_SUPPORT", coreId: f.coreId, id: f.supportId, value: { ...fact(cp), target } }];
    next.cueDelta = { action: "REVISE", targetCueId: f.cueId, value: { ...fact(cp), kind: "QUESTION", target } };
    expect(knowledgeOperationSchema.safeParse(next.knowledgeOps[0]).success).toBe(true);
    expect(cueMutationSchema.safeParse(next.cueDelta).success).toBe(true);
    const after = acceptCoreStep(base, next).replay.state;
    expect(after.knowledge.cores[f.coreId]!.supports[f.supportId]!.value.target).toEqual(target);
    expect(after.cue.active!.target).toEqual(target);
  });

  it.each(["support", "cue"])("rejects %s targeting Support at schema validation, without changing the base", channel => {
    const f = foundation(), base = evidence(f.replay), next = stepFor(base), cp = next.consumesCheckpointIds[0]!;
    const target = { kind: "SUPPORT", coreId: f.coreId, id: f.supportId };
    const mutation = channel === "support"
      ? { action: "REVISE_SUPPORT", coreId: f.coreId, id: f.supportId, value: { ...fact(cp), target } }
      : { action: "REVISE", targetCueId: f.cueId, value: { ...fact(cp), kind: "QUESTION", target } };
    expect((channel === "support" ? knowledgeOperationSchema : cueMutationSchema).safeParse(mutation).success).toBe(false);
    const input = channel === "support" ? { ...next, knowledgeOps: [mutation] } : { ...next, cueDelta: mutation };
    const before = structuredClone(base);
    expect(() => acceptCoreStep(base, input)).toThrow();
    expect(base).toEqual(before);
    // Support remains referenceable for provenance and local semantic mutation.
    expect(semanticReferenceSchema.safeParse(target).success).toBe(true);
  });

  it.each(["late-operation", "cue", "identity", "forward-reference"])("rejects all mutations and consumption on invalid %s", failure => {
    const f = foundation();
    const candidate = structuredClone(f.step), before = structuredClone(f.base);
    if (failure === "late-operation") candidate.knowledgeOps.push({ action: "SET_CURRENT_CORE", coreId: "missing" });
    if (failure === "cue") candidate.cueDelta = { action: "RESOLVE", targetCueId: "missing", evidence: speechRef("checkpoint-1") };
    if (failure === "identity") candidate.knowledgeOps[0] = { ...candidate.knowledgeOps[0]!, id: "invented" } as typeof candidate.knowledgeOps[0];
    if (failure === "forward-reference") candidate.knowledgeOps[0] = { action: "SET_CURRENT_CORE", coreId: f.coreId };
    expect(() => acceptCoreStep(f.base, candidate)).toThrow();
    expect(f.base).toEqual(before);
    expect(pendingCoreEvidence(f.base)).toHaveLength(1);
    expect(f.base.state.knowledge.cores).toEqual({});
    expect(f.base.state.cue.revision).toBe(0);
  });

  it("consumes an accepted empty semantic step without advancing channel revisions", () => {
    const base = evidence(start()), candidate = stepFor(base, { evidenceRefs: [] });
    const { event, replay } = acceptCoreStep(base, candidate);
    expect(event.type).toBe("core.step_accepted");
    expect(replay.state.knowledge).toEqual(base.state.knowledge);
    expect(replay.state.cue).toEqual(base.state.cue);
    expect(replay.state.processedThroughSequence).toBe(1);
    expect(pendingCoreEvidence(replay)).toEqual([]);
    expect(pendingCoreEvidence(base)).toHaveLength(1);
    expect(() => acceptCoreStep(replay, { ...candidate, requestId: "another-request" })).toThrow("core-evidence-prefix-invalid");
  });

  it("accepts knowledge-only work after unrelated Cue expiry", () => {
    let base = evidence(start()); const note = stepFor(base);
    note.cueDelta = { action: "SET", id: coreEntityId(base.state.sessionId, note, "CUE", 0), value: { ...fact("checkpoint-1"), kind: "NOTE" } };
    base = evidence(acceptCoreStep(base, note).replay);
    const next = stepFor(base);
    next.knowledgeOps = [{ action: "CREATE_CORE", id: coreEntityId(base.state.sessionId, next, "CORE", 0), provenance: fact("checkpoint-2").provenance }];
    const expired = appendCoreEvent(base, expire(base));
    const after = acceptCoreStep(expired, next).replay;
    expect(after.state.knowledge.revision).toBe(1);
    expect(after.state.cue).toEqual(expired.state.cue);
    expect(after.state.cue.revision).toBe(2);
  });

  it("accepts Cue-only work at an older unrelated knowledge base", () => {
    const f = foundation(), base = evidence(f.replay), next = stepFor(base, { baseKnowledgeRevision: 0 });
    next.cueDelta = { action: "RESOLVE", targetCueId: f.cueId, evidence: speechRef("checkpoint-2") };
    const after = acceptCoreStep(base, next).replay;
    expect(after.state.knowledge).toEqual(base.state.knowledge);
    expect(after.state.cue).toEqual({ revision: 2 });
  });

  it.each(["knowledge", "cue", "cue-reads-knowledge", "knowledge-reads-cue", "noop-reads-state"])("rejects an actual %s dependency conflict atomically", conflict => {
    const f = foundation(), base = evidence(f.replay), next = stepFor(base), before = structuredClone(base);
    if (conflict === "knowledge") {
      next.baseKnowledgeRevision = 0;
      next.knowledgeOps = [{ action: "SET_CURRENT_CORE", coreId: f.coreId }];
    } else if (conflict === "cue") {
      next.baseCueRevision = 0;
      next.cueDelta = { action: "RESOLVE", targetCueId: f.cueId, evidence: speechRef("checkpoint-2") };
    } else if (conflict === "cue-reads-knowledge") {
      next.baseKnowledgeRevision = 0;
      next.cueDelta = { action: "REVISE", targetCueId: f.cueId, value: { ...fact("checkpoint-2"), kind: "QUESTION", target: { kind: "OBJECT", coreId: f.coreId, id: f.a } } };
    } else if (conflict === "knowledge-reads-cue") {
      next.baseCueRevision = 0;
      next.knowledgeOps = [{ action: "REVISE_OBJECT", coreId: f.coreId, id: f.a, value: { text: "From the Cue", provenance: { speechRefs: [], stateRefs: [{ target: { kind: "CUE", id: f.cueId }, revision: 1 }] } } }];
    } else {
      next.baseKnowledgeRevision = 0;
      next.stateRefs = [{ target: { kind: "CORE", id: f.coreId }, revision: 1 }];
    }
    expect(() => acceptCoreStep(base, next)).toThrow(/conflict/);
    expect(base).toEqual(before);
  });

  it.each(["unknown-evidence", "fabricated-quote", "future-evidence", "out-of-order", "repeat-id", "no-trigger", "old-correction", "unknown-state", "wrong-kind", "wrong-revision", "future-base"])("rejects %s before consumption", invalid => {
    const f = foundation(), base = evidence(evidence(f.replay)), next = stepFor(base);
    next.knowledgeOps = [{ action: "SET_CURRENT_CORE", coreId: f.coreId }];
    if (invalid === "unknown-evidence") next.evidenceRefs = [speechRef("unknown")];
    if (invalid === "fabricated-quote") next.evidenceRefs = [{ checkpointId: "checkpoint-2", quote: "Never spoken" }];
    if (invalid === "future-evidence") next.evidenceRefs = [speechRef("checkpoint-3")];
    if (invalid === "out-of-order") next.consumesCheckpointIds = ["checkpoint-3", "checkpoint-2"];
    if (invalid === "repeat-id") next.consumesCheckpointIds = ["checkpoint-2", "checkpoint-2"];
    if (invalid === "no-trigger") next.evidenceRefs = [speechRef("checkpoint-1")];
    if (invalid === "old-correction") next.knowledgeOps = [{ action: "INVALIDATE", target: { kind: "OBJECT", coreId: f.coreId, id: f.a }, correctionEvidence: speechRef("checkpoint-1") }];
    if (invalid === "unknown-state") next.stateRefs = [{ target: { kind: "CORE", id: "missing" }, revision: 1 }];
    if (invalid === "wrong-kind") next.stateRefs = [{ target: { kind: "RELATION", coreId: f.coreId, id: f.a }, revision: 1 }];
    if (invalid === "wrong-revision") next.stateRefs = [{ target: { kind: "CORE", id: f.coreId }, revision: 0 }];
    if (invalid === "future-base") next.baseCueRevision = 42;
    const before = structuredClone(base);
    expect(() => acceptCoreStep(base, next)).toThrow();
    expect(base).toEqual(before);
  });

  it("rejects cross-Core relation endpoints and Support targets", () => {
    const first = foundation(), base = evidence(first.replay), second = foundation(base);
    const pending = evidence(second.replay), next = stepFor(pending), cp = next.consumesCheckpointIds[0]!;
    next.knowledgeOps = [{ action: "REVISE_RELATION", coreId: first.coreId, id: first.relationId, value: { ...fact(cp), fromObjectId: first.a, toObjectId: second.b } }];
    expect(() => acceptCoreStep(pending, next)).toThrow("core-reference-invalid");
    next.knowledgeOps = [{ action: "REVISE_SUPPORT", coreId: first.coreId, id: first.supportId, value: { ...fact(cp), target: { kind: "CORE", id: second.coreId } } }];
    expect(() => acceptCoreStep(pending, next)).toThrow("core-support-target-invalid");
  });

  it("rejects entity IDs minted for another lesson or creation site", () => {
    const f = foundation(), other = evidence(start("other-lesson"));
    expect(() => acceptCoreStep(other, f.step)).toThrow("core-creation-identity-invalid");
    const pending = evidence(f.replay), next = stepFor(pending);
    next.knowledgeOps = [{ action: "ADD_OBJECT", coreId: f.coreId, id: f.a, value: fact("checkpoint-2") }];
    expect(() => acceptCoreStep(pending, next)).toThrow("core-creation-identity-invalid");
  });

  it("revises Cue identity, replaces explicitly, and rejects stale resolution", () => {
    const f = foundation(); let base = evidence(f.replay), next = stepFor(base);
    next.cueDelta = { action: "REVISE", targetCueId: f.cueId, value: { ...fact("checkpoint-2", "Compare carefully"), kind: "QUESTION" } };
    base = acceptCoreStep(base, next).replay;
    expect(base.state.cue.active!.id).toBe(f.cueId);
    expect(base.state.cue.revision).toBe(2);
    expect(base.state.knowledge).toEqual(f.replay.state.knowledge);
    base = evidence(base); next = stepFor(base);
    const id = coreEntityId(base.state.sessionId, next, "CUE", 0);
    next.cueDelta = { action: "REPLACE", targetCueId: f.cueId, id, evidence: speechRef("checkpoint-3"), value: { ...fact("checkpoint-3"), kind: "TASK" } };
    base = acceptCoreStep(base, next).replay;
    expect(base.state.cue.active!.id).toBe(id);
    base = evidence(base); next = stepFor(base);
    next.cueDelta = { action: "RESOLVE", targetCueId: f.cueId, evidence: speechRef("checkpoint-4") };
    expect(() => acceptCoreStep(base, next)).toThrow("core-cue-target-invalid");
  });
});
