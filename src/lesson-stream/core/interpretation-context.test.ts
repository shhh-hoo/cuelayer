import { expect, it } from "vitest";
import { acceptCoreStep } from "./accepted-steps.ts";
import { coreEntityId } from "./events.ts";
import { buildCoreInterpretationContext, CORE_CONTEXT_BUDGETS, historicalSources } from "./interpretation-context.ts";
import { evidence, fact, foundation, provenance, stepFor } from "./test-fixtures.ts";

it("projects complete mutable values with intra-Core structural closure", () => {
  const f = foundation(), base = evidence(f.replay);
  const bound = buildCoreInterpretationContext(base, { requestId: "closure", newEvidence: [base.checkpoints.at(-1)!], required: [{ kind: "RELATION", coreId: f.coreId, id: f.relationId }], budgets: { optionalRoots: 0 } });
  const relation = bound.context.entities.find(e => e.kind === "RELATION")!;
  expect(bound.context.entities.find(e => e.handle === relation.from)).toMatchObject({ text: "A definition", kind: "OBJECT" });
  expect(bound.context.entities.find(e => e.handle === relation.to)).toMatchObject({ text: "B proposition", kind: "OBJECT" });
  expect(bound.context.entities.find(e => e.kind === "CORE")!.contents).toBe("partial");
  expect(bound.context.entities.every(e => (!e.target || bound.entities.has(e.target)) && (!e.core || bound.entities.has(e.core)))).toBe(true);
  expect(JSON.stringify(bound.context)).not.toContain(f.coreId);
});

it("distinguishes authoritative emptiness, complete Core IDs, partial contents and omitted Cue", () => {
  const f = foundation(), base = evidence(f.replay);
  const bound = buildCoreInterpretationContext(base, { requestId: "partial", newEvidence: [base.checkpoints.at(-1)!], includeCue: false, budgets: { optionalRoots: 0 } });
  expect(bound.context.knowledge).toMatchObject({ empty: false, cores: "complete" });
  expect(bound.context.entities).toHaveLength(1);
  expect(bound.context.entities[0]!.contents).toBe("partial");
  expect(bound.context.cue.presence).toBe("omitted");
  const empty = buildCoreInterpretationContext(f.base, { requestId: "empty", newEvidence: f.base.checkpoints });
  expect(empty.context.knowledge).toEqual({ empty: true, cores: "complete", current: null });
  expect(empty.context.cue.presence).toBe("absent");
});

it("resolves historical provenance at its recorded revision rather than today's value", () => {
  const f = foundation(); let base = evidence(f.replay);
  const derived = stepFor(base), ref = { target: { kind: "OBJECT" as const, coreId: f.coreId, id: f.a }, revision: 1 };
  derived.knowledgeOps = [{ action: "REVISE_OBJECT", coreId: f.coreId, id: f.b, value: { text: "Representation of earlier A", provenance: { speechRefs: [], stateRefs: [ref] } } }];
  base = evidence(acceptCoreStep(base, derived).replay);
  const correction = stepFor(base);
  correction.knowledgeOps = [{ action: "REVISE_OBJECT", coreId: f.coreId, id: f.a, value: fact(base.checkpoints.at(-1)!.checkpointId, "Changed A"), correctionEvidence: { checkpointId: base.checkpoints.at(-1)!.checkpointId, quote: base.checkpoints.at(-1)!.text } }];
  base = evidence(acceptCoreStep(base, correction).replay);
  expect(historicalSources(base).resolve(ref.target, 1)).toMatchObject({ value: { text: "A definition" } });
  expect(historicalSources(base).resolve(ref.target, 3)).toMatchObject({ value: { text: "Changed A" } });
  const context = buildCoreInterpretationContext(base, { requestId: "source", newEvidence: [base.checkpoints.at(-1)!], required: [ref.target, { kind: "OBJECT", coreId: f.coreId, id: f.b }] }).context;
  expect(context.entities.find(e => e.text === "Representation of earlier A")!.origins).toEqual(["accepted_state", "speech"]);
  expect(() => historicalSources(base).resolve(ref.target, 999)).toThrow("historical-reference-invalid");
});

it("successfully bounds long lessons without deleting old Cores or Support", () => {
  const f = foundation(); let replay = f.replay;
  for (let index = 0; index < 100; index++) {
    replay = evidence(replay); const step = stepFor(replay), cp = replay.checkpoints.at(-1)!.checkpointId;
    const id = coreEntityId(replay.state.sessionId, step, "CORE", 0);
    step.knowledgeOps = [
      { action: "CREATE_CORE", id, provenance: provenance(cp) },
      { action: "ADD_OBJECT", coreId: id, id: coreEntityId(replay.state.sessionId, step, "OBJECT", 1), value: fact(cp, `Distinct topic ${index}`) },
      { action: "ADD_SUPPORT", coreId: f.coreId, id: coreEntityId(replay.state.sessionId, step, "SUPPORT", 2), value: { ...fact(cp, `Illustration ${index}`), target: { kind: "CORE", id: f.coreId } } },
      { action: "SET_CURRENT_CORE", coreId: id },
    ];
    replay = acceptCoreStep(replay, step).replay;
  }
  replay = evidence(replay); const before = structuredClone(replay);
  const bound = buildCoreInterpretationContext(replay, { requestId: "long", newEvidence: [replay.checkpoints.at(-1)!] });
  expect(JSON.stringify(bound.context).length).toBeLessThanOrEqual(CORE_CONTEXT_BUDGETS.maxCharacters);
  expect(bound.context.entities.length).toBeLessThanOrEqual(CORE_CONTEXT_BUDGETS.maxEntities);
  expect(bound.context.candidates.length).toBeLessThanOrEqual(CORE_CONTEXT_BUDGETS.candidateCores);
  expect(bound.context.knowledge.cores).toBe("partial");
  expect(Object.keys(replay.state.knowledge.cores)).toHaveLength(101);
  expect(Object.keys(replay.state.knowledge.cores[f.coreId]!.supports)).toHaveLength(101);
  expect(replay).toEqual(before);
});

it("blocks indivisible mandatory context instead of consuming or clipping evidence", () => {
  const f = foundation(), base = evidence(f.replay), before = structuredClone(base);
  expect(() => buildCoreInterpretationContext(base, { requestId: "small", newEvidence: [base.checkpoints.at(-1)!], budgets: { maxCharacters: 100 } })).toThrow("budget-exceeded");
  expect(() => buildCoreInterpretationContext(base, { requestId: "missing", newEvidence: [base.checkpoints.at(-1)!], required: [{ kind: "CORE", id: "missing" }] })).toThrow("reference-missing");
  expect(base).toEqual(before);
});

it("validates unresolved source phrases and keeps priors optional and bounded", () => {
  const f = foundation(), base = evidence(f.replay), cp = base.checkpoints.at(-1)!;
  const bound = buildCoreInterpretationContext(base, { requestId: "unresolved", newEvidence: [cp], unresolved: [{ checkpointId: cp.checkpointId, phrase: "Compare A" }], structuralPriors: Array(20).fill("Optional course outline") });
  expect(bound.context.unresolved).toEqual([{ evidence: "e0", phrase: "Compare A" }]);
  expect(bound.context.structuralPriors).toHaveLength(CORE_CONTEXT_BUDGETS.priors);
  expect(() => buildCoreInterpretationContext(base, { requestId: "bad", newEvidence: [cp], unresolved: [{ checkpointId: cp.checkpointId, phrase: "Invented speech" }] })).toThrow("unresolved-evidence-invalid");
});

it("honors zero optional budgets and explicit required Cue coverage", () => {
  const f = foundation(), base = evidence(f.replay);
  const options = { requestId: "zero", newEvidence: [base.checkpoints.at(-1)!], includeCue: false, budgets: { recentEvidence: 0, recentChanges: 0, optionalRoots: 0, candidateCores: 0 } };
  const context = buildCoreInterpretationContext(base, options).context;
  expect(context.evidence).toHaveLength(1); expect(context.recentChanges).toEqual([]);
  expect(context.cue.presence).toBe("omitted");
  const required = buildCoreInterpretationContext(base, { ...options, required: [{ kind: "CUE", id: f.cueId }] }).context;
  expect(required.cue.presence).toBe("included");
  expect(required.entities.find(e => e.handle === required.cue.active)?.kind).toBe("CUE");
});

it("does not duplicate entities or bypass read-only scope when reference key order differs", () => {
  const f = foundation(), base = evidence(f.replay);
  const ref = { id: f.a, coreId: f.coreId, kind: "OBJECT" as const };
  const bound = buildCoreInterpretationContext(base, { requestId: "keys", newEvidence: [base.checkpoints.at(-1)!], required: [ref], readOnly: [ref] });
  const handles = [...bound.entities].filter(([, e]) => e.target.id === f.a);
  expect(handles).toHaveLength(1); expect(handles[0]![1].capabilities).toEqual(["reference"]);
});
