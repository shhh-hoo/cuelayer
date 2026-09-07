import { expect, it } from "vitest";
import { acceptCoreStep } from "./accepted-steps.ts";
import { coreEntityId } from "./events.ts";
import { buildCoreInterpretationContext, CORE_CONTEXT_BUDGETS, historicalSources } from "./interpretation-context.ts";
import { appendCoreEvent } from "./replay.ts";
import { acceptCoreInterpretation } from "./interpretation-validation.ts";
import { evidence, fact, foundation, provenance, stepFor, timestamp, start } from "./test-fixtures.ts";

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
  const bound = buildCoreInterpretationContext(base, { requestId: "keys", newEvidence: [base.checkpoints.at(-1)!], required: [ref], writable: [ref], readOnly: [ref] });
  const handles = [...bound.entities].filter(([, e]) => e.target.id === f.a);
  expect(handles).toHaveLength(1); expect(handles[0]![1].capabilities).toEqual(["reference", "factual_basis"]);
});

function parkedRequest(text: string, budgets = {}) {
  const parked = foundation(), current = foundation(evidence(parked.replay));
  const event = evidence(current.replay).events.at(-1)!;
  if (event.type !== "evidence.checkpoint_committed") throw new Error("fixture");
  event.checkpoint.text = text;
  const base = appendCoreEvent(current.replay, event);
  const bound = buildCoreInterpretationContext(base, { requestId: "retrieval", newEvidence: [base.checkpoints.at(-1)!], includeCue: false, budgets: { optionalRoots: 0, ...budgets } });
  return { parked, current, base, bound };
}

it.each([{ maxEntities: 2, optionalRoots: 18 }, { maxCharacters: 750, optionalRoots: 18 }])("rolls back candidate identity and authority when its anchor cannot fit: %j", budgets => {
  const { parked, bound } = parkedRequest("Return to the definition", budgets);
  expect(bound.context.candidates).toEqual([]);
  expect([...bound.entities.values()].some(e => e.target.id === parked.coreId || ("coreId" in e.target && e.target.coreId === parked.coreId))).toBe(false);
  expect(bound.context.entities.filter(e => e.kind === "CORE")).toHaveLength(1);
  expect(JSON.stringify(bound.context)).not.toContain(parked.coreId);
});

it("does not fill the candidate quota for an unrelated new topic", () => {
  const { bound } = parkedRequest("Photosynthesis chlorophyll sunlight");
  expect(bound.context.candidates).toEqual([]);
  expect(bound.context.entities).toHaveLength(1);
});

it("admits a positively retrieved factual anchor without mutation authority while allowing Core append/refocus", () => {
  const { parked, bound } = parkedRequest("Return to the definition");
  expect(bound.context.candidates).toHaveLength(1);
  const core = bound.context.candidates[0]!;
  expect(bound.entities.get(core)).toMatchObject({ target: { id: parked.coreId }, capabilities: ["reference", "append", "refocus"] });
  const anchor = bound.context.entities.find(e => e.core === core)!;
  expect(anchor.text).toBe("A definition");
  expect(anchor.capabilities).toEqual(["reference", "factual_basis"]);
  const step = { consumes: ["e0"], knowledgeOps: [], cueDelta: { action: "KEEP" }, evidenceRefs: ["e0"], readRefs: [], reads: { knowledge: false, cue: false }, warnings: [] };
  const value = { text: "Definition expanded", provenance: { speech: ["e0"], state: [], domain: null } };
  expect(() => acceptCoreInterpretation(bound, { outcome: { kind: "PROPOSE", steps: [{ ...step, knowledgeOps: [{ action: "REVISE_OBJECT", target: { existing: anchor.handle }, value, correctionEvidence: "e0" }] }] } }, timestamp)).toThrow("capability-denied");
  const result = acceptCoreInterpretation(bound, { outcome: { kind: "PROPOSE", steps: [{ ...step, knowledgeOps: [
    { action: "SET_CURRENT_CORE", core: { existing: core } },
    { action: "ADD_OBJECT", core: { existing: core }, as: "extension", value },
  ] }] } }, timestamp);
  expect(result.replay.state.knowledge.currentCoreId).toBe(parked.coreId);
  expect(Object.values(result.replay.state.knowledge.cores[parked.coreId]!.objects).some(o => o.value.text === value.text)).toBe(true);
});

it("keeps an ungrounded earlier reference unresolved without guessing a Parked identity", () => {
  const text = "Revisit whatever we discussed earlier", { bound, parked } = parkedRequest(text);
  expect(bound.context.candidates).toEqual([]);
  expect([...bound.entities.values()].some(e => e.target.id === parked.coreId)).toBe(false);
  const result = acceptCoreInterpretation(bound, { outcome: { kind: "NEEDS_CONTEXT", query: text, evidence: ["e0"] } }, timestamp);
  expect(result.events).toEqual([]);
  expect(result.replay).toEqual(bound.base);
});

it("projects dependencies without inheriting their explicitly writable root's authority", () => {
  const f = foundation(), base = evidence(f.replay);
  const bound = buildCoreInterpretationContext(base, { requestId: "scope", newEvidence: [base.checkpoints.at(-1)!], includeCue: false, writable: [{ kind: "RELATION", coreId: f.coreId, id: f.relationId }], budgets: { optionalRoots: 0 } });
  expect(bound.context.entities.find(e => e.kind === "RELATION")!.capabilities).toContain("revise");
  expect(bound.context.entities.filter(e => e.kind === "OBJECT").map(e => e.capabilities)).toEqual([["reference"], ["reference"]]);
});

it("identifies recent accepted semantic changes through bounded provider handles", () => {
  const f = foundation(); let base = evidence(f.replay);
  const step = stepFor(base), cp = base.checkpoints.at(-1)!;
  step.knowledgeOps = [{ action: "REVISE_OBJECT", coreId: f.coreId, id: f.a, value: fact(cp.checkpointId, "Corrected definition"), correctionEvidence: { checkpointId: cp.checkpointId, quote: cp.text } }];
  base = evidence(acceptCoreStep(base, step).replay);
  const bound = buildCoreInterpretationContext(base, { requestId: "recent", newEvidence: [base.checkpoints.at(-1)!], budgets: { recentChanges: 1, maxCharacters: 4000 } });
  expect(bound.context.recentChanges).toHaveLength(1);
  const change = bound.context.recentChanges[0]!;
  expect(change.complete).toBe(true);
  expect(change.changes).toHaveLength(1);
  expect(bound.context.entities.find(e => e.handle === change.changes[0]!.target)?.text).toBe("Corrected definition");
  expect(change.changes[0]!.action).toBe("REVISE_OBJECT");
  expect(JSON.stringify(bound.context).length).toBeLessThanOrEqual(4000);
});


it("does not retrieve a Parked Core whose only matching anchors are invalid", () => {
  const f = foundation(); let base = evidence(f.replay);
  const step = stepFor(base), cp = base.checkpoints.at(-1)!;
  step.knowledgeOps = [f.a, f.b].map(id => ({ action: "INVALIDATE" as const, target: { kind: "OBJECT" as const, coreId: f.coreId, id }, correctionEvidence: { checkpointId: cp.checkpointId, quote: cp.text } }));
  base = foundation(evidence(acceptCoreStep(base, step).replay)).replay;
  const event = evidence(base).events.at(-1)!;
  if (event.type !== "evidence.checkpoint_committed") throw new Error("fixture");
  event.checkpoint.text = "Return to definition proposition";
  base = appendCoreEvent(base, event);
  const bound = buildCoreInterpretationContext(base, { requestId: "invalid-anchor", newEvidence: [base.checkpoints.at(-1)!], includeCue: false });
  expect(bound.context.candidates).toEqual([]);
  expect([...bound.entities.values()].some(e => e.target.id === f.coreId)).toBe(false);
});

it("rejects ubiquitous templates while retaining short numeric retrieval in long histories", () => {
  let base = start();
  const ids: string[] = [];
  for (let i = 0; i < 25; i++) {
    base = evidence(base);
    const step = stepFor(base), cp = base.checkpoints.at(-1)!.checkpointId;
    const coreId = coreEntityId(base.state.sessionId, step, "CORE", 0); ids.push(coreId);
    step.knowledgeOps = [
      { action: "CREATE_CORE", id: coreId, provenance: provenance(cp) },
      { action: "ADD_OBJECT", coreId, id: coreEntityId(base.state.sessionId, step, "OBJECT", 1), value: fact(cp, `Module ${i} establishes statement number ${i}.`) },
      { action: "SET_CURRENT_CORE", coreId },
    ];
    base = acceptCoreStep(base, step).replay;
  }
  const project = (text: string) => {
    const event = evidence(base).events.at(-1)!;
    if (event.type !== "evidence.checkpoint_committed") throw new Error("fixture");
    event.checkpoint.text = text;
    const next = appendCoreEvent(base, event);
    return buildCoreInterpretationContext(next, { requestId: "numbers", newEvidence: [next.checkpoints.at(-1)!], includeCue: false, budgets: { optionalRoots: 0 } });
  };
  expect(project("Module 25 establishes statement number 25.").context.candidates).toEqual([]);
  expect(project("A module establishes a statement number").context.candidates).toEqual([]);
  const earlier = project("Return to module 7");
  expect(earlier.context.candidates.map(h => earlier.entities.get(h)!.target.id)).toEqual([ids[7]]);
  const short = project("Return to module 1");
  expect(short.context.candidates.map(h => short.entities.get(h)!.target.id)).toEqual([ids[1]]);
});
