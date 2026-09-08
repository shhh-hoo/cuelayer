import { describe, expect, it } from "vitest";
import { buildCoreInterpretationContext } from "./interpretation-context.ts";
import { acceptCoreInterpretation } from "./interpretation-validation.ts";
import { coreProposalSchema, type ProposalStep } from "./interpretation-proposal.ts";
import { appendCoreEvent, replayCoreEvents, type CoreReplay } from "./replay.ts";
import { evidence, expire, foundation, start, timestamp } from "./test-fixtures.ts";

const p = (speech = ["e0"]) => ({ speech, state: [], domain: null });
const value = (text = "A", speech = ["e0"]) => ({ text, provenance: p(speech) });
const created = (name: string) => ({ created: name });
const existing = (name: string) => ({ existing: name });
function empty(consumes = ["e0"]): ProposalStep { return { consumes, knowledgeOps: [], cueDelta: { action: "KEEP" }, evidenceRefs: [], readRefs: [], reads: { knowledge: false, cue: false }, warnings: [] }; }
function growth(): ProposalStep {
  return { ...empty(), evidenceRefs: ["e0"], knowledgeOps: [
    { action: "CREATE_CORE", as: "main", provenance: p() },
    { action: "ADD_OBJECT", core: created("main"), as: "a", value: value() },
    { action: "ADD_OBJECT", core: created("main"), as: "b", value: value("B") },
    { action: "ADD_RELATION", core: created("main"), as: "rel", value: { ...value("A relates to B"), from: created("a"), to: created("b") } },
    { action: "SET_CURRENT_CORE", core: created("main") },
  ] };
}
function commitText(base: CoreReplay, text: string) {
  const event = evidence(base).events.at(-1)!;
  if (event.type !== "evidence.checkpoint_committed") throw new Error("fixture");
  event.checkpoint.text = text;
  return appendCoreEvent(base, event);
}
const propose = (...steps: ProposalStep[]) => ({ outcome: { kind: "PROPOSE", steps } });
const binding = (two = false) => { let base = evidence(start()); if (two) base = evidence(base); return buildCoreInterpretationContext(base, { requestId: "req", newEvidence: base.checkpoints }); };

describe("Core provider normalization", () => {
  it("creates same-step topology deterministically and replays through unchanged M1", () => {
    const request = binding(), before = structuredClone(request.base);
    const result = acceptCoreInterpretation(request, propose(growth()), timestamp);
    expect(result).toEqual(acceptCoreInterpretation(request, propose(growth()), timestamp));
    expect(request.base).toEqual(before);
    expect(result.steps[0]!.knowledgeOps[1]).toMatchObject({ id: JSON.stringify(["synthetic-lesson", "req", 0, "OBJECT", 1]) });
    expect(replayCoreEvents(result.replay.events).state).toEqual(result.replay.state);
    expect(result.replay.state.knowledge.revision).toBe(1);
  });
  it("accepts multiple ordered steps with rolling revisions and prior-step state provenance", () => {
    const request = binding(true), second = empty(["e1"]);
    second.evidenceRefs = ["e1"];
    second.knowledgeOps = [{ action: "ADD_SUPPORT", core: created("main"), as: "example", value: { text: "A's example", target: created("a"), provenance: { speech: ["e1"], state: [created("a")], domain: null } } }];
    const result = acceptCoreInterpretation(request, propose(growth(), second), timestamp);
    expect(result.steps.map(s => s.baseKnowledgeRevision)).toEqual([0, 1]);
    expect(result.steps.map(s => s.stepIndex)).toEqual([0, 1]);
    expect(result.replay.state.knowledge.revision).toBe(2);
    expect(result.replay.state.processedThroughSequence).toBe(2);
    expect(result.events).toHaveLength(2);
    expect(result.steps[1]!.knowledgeOps[0]).toMatchObject({ value: { provenance: { stateRefs: [{ revision: 1 }] } } });
  });
  it.each(["unknown", "forward", "same-step-provenance", "wrong-kind", "duplicate-alias", "future-speech", "coverage", "late-cue"])("rejects %s with no observable intermediate acceptance", failure => {
    const request = binding(true), first = growth(), second = empty(["e1"]), before = structuredClone(request.base);
    if (failure === "unknown") first.knowledgeOps.push({ action: "SET_CURRENT_CORE", core: existing("r999") });
    if (failure === "forward") first.knowledgeOps.unshift({ action: "SET_CURRENT_CORE", core: created("main") });
    if (failure === "same-step-provenance") first.readRefs = [created("a")];
    if (failure === "wrong-kind") first.knowledgeOps.push({ action: "SET_CURRENT_CORE", core: created("a") });
    if (failure === "duplicate-alias") first.knowledgeOps.push({ action: "ADD_OBJECT", core: created("main"), as: "a", value: value() });
    if (failure === "future-speech") first.evidenceRefs = ["e1"];
    if (failure === "coverage") second.consumes = ["e0"];
    if (failure === "late-cue") second.cueDelta = { action: "RESOLVE", target: created("main"), evidence: "e1" };
    expect(() => acceptCoreInterpretation(request, propose(first, second), timestamp)).toThrow();
    expect(request.base).toEqual(before);
  });
  it("rejects durable ID injection and foreign schema fields", () => {
    const raw = propose(growth());
    expect(coreProposalSchema.safeParse({ ...raw, baseKnowledgeRevision: 0 }).success).toBe(false);
    const step = growth(); step.knowledgeOps.push({ action: "SET_CURRENT_CORE", core: existing('["lesson","request",0,"CORE",0]') });
    expect(() => acceptCoreInterpretation(binding(), propose(step), timestamp)).toThrow();
  });
  it("accepted no-op consumes evidence; NEEDS_CONTEXT does not create events or revisions", () => {
    const request = binding();
    const noop = acceptCoreInterpretation(request, propose(empty()), timestamp);
    expect(noop.events).toHaveLength(1);
    expect(noop.replay.state.processedThroughSequence).toBe(1);
    expect(noop.replay.state.knowledge.revision).toBe(0);
    const needs = acceptCoreInterpretation(request, { outcome: { kind: "NEEDS_CONTEXT", query: "Compare A and B", evidence: ["e0"] } }, timestamp);
    expect(needs.events).toEqual([]); expect(needs.steps).toEqual([]); expect(needs.replay).toEqual(request.base);
    expect(() => acceptCoreInterpretation(request, { outcome: { kind: "NEEDS_CONTEXT", query: "guessed-durable-id", evidence: ["e0"] } }, timestamp)).toThrow();
  });
  it("keeps verification requests non-accepting and model-surfaced evidence non-authoritative", () => {
    const request = binding(), before = structuredClone(request.base);
    const result = acceptCoreInterpretation(request, { outcome: { kind: "NEEDS_VERIFICATION", query: "Compare A and B", evidence: ["e0"], claim: "A should differ from B.", candidateEvidence: "Check an independent reference." } }, timestamp);
    expect(result.kind).toBe("NEEDS_VERIFICATION");
    expect(result.events).toEqual([]); expect(result.steps).toEqual([]); expect(result.replay).toEqual(before);
    expect(result.candidateEvidence).toBe("Check an independent reference.");
  });
  it("does not leak creation aliases across requests", () => {
    const request = binding(), accepted = acceptCoreInterpretation(request, propose(growth()), timestamp);
    const next = evidence(accepted.replay), bound = buildCoreInterpretationContext(next, { requestId: "next", newEvidence: [next.checkpoints.at(-1)!] });
    const step = empty(); step.evidenceRefs = ["e0"]; step.knowledgeOps = [{ action: "SET_CURRENT_CORE", core: created("main") }];
    expect(() => acceptCoreInterpretation(bound, propose(step), timestamp)).toThrow();
  });
  it("rejects omitted and read-only mutations even though IDs exist in accepted state", () => {
    const f = foundation(), base = evidence(f.replay), target = { kind: "OBJECT" as const, coreId: f.coreId, id: f.a };
    const request = buildCoreInterpretationContext(base, { requestId: "r", newEvidence: [base.checkpoints.at(-1)!], required: [target] });
    const handle = [...request.entities].find(([, e]) => e.target.id === f.a)![0];
    const step = empty(); step.evidenceRefs = ["e0"]; step.knowledgeOps = [{ action: "REVISE_OBJECT", target: existing(handle), value: value(), correctionEvidence: "e0" }];
    expect(() => acceptCoreInterpretation(request, propose(step), timestamp)).toThrow("capability-denied");
    const omitted = buildCoreInterpretationContext(base, { requestId: "r", newEvidence: [base.checkpoints.at(-1)!], includeCue: false, budgets: { optionalRoots: 0 } });
    expect([...omitted.entities.values()].some(e => e.target.id === f.a)).toBe(false);
    expect(() => acceptCoreInterpretation(omitted, propose(step), timestamp)).toThrow();
  });
  it("preserves independence after unrelated Cue expiry and checks explicit no-op reads", () => {
    const request = binding(), step = empty(); step.evidenceRefs = ["e0"];
    step.cueDelta = { action: "SET", as: "note", value: { ...value("Note A"), kind: "NOTE", target: null } };
    const note = acceptCoreInterpretation(request, propose(step), timestamp), base = evidence(note.replay);
    const bound = buildCoreInterpretationContext(base, { requestId: "second", newEvidence: [base.checkpoints.at(-1)!] });
    const expired = appendCoreEvent(base, expire(base));
    expect(acceptCoreInterpretation(bound, propose(growth()), timestamp, expired).replay.state.cue.active).toBeUndefined();
    const dependent = empty(); dependent.reads.cue = true;
    expect(() => acceptCoreInterpretation(bound, propose(dependent), timestamp, expired)).toThrow("core-cue-conflict");
    const read = empty(); read.readRefs = [existing(bound.context.cue.active!)];
    expect(() => acceptCoreInterpretation(bound, propose(read), timestamp, expired)).toThrow();
  });
  it("accepts a Cue-only step despite unrelated knowledge revision changes", () => {
    const f = foundation(), base = evidence(f.replay), request = buildCoreInterpretationContext(base, { requestId: "cue-only", newEvidence: [base.checkpoints.at(-1)!], writable: [{ kind: "CUE", id: f.cueId }] });
    const advanced = structuredClone(base); advanced.state.knowledge.revision += 1;
    const step = empty(); step.evidenceRefs = ["e0"]; step.cueDelta = { action: "RESOLVE", target: existing(request.context.cue.active!), evidence: "e0" };
    expect(acceptCoreInterpretation(request, propose(step), timestamp, advanced).replay.state.cue.active).toBeUndefined();
    step.reads.knowledge = true;
    expect(() => acceptCoreInterpretation(request, propose(step), timestamp, advanced)).toThrow("core-knowledge-conflict");
  });
  it("permits only explicitly supplied domain facts, honestly marked", () => {
    const base = evidence(start()), request = buildCoreInterpretationContext(base, { requestId: "domain", newEvidence: base.checkpoints, domainRules: [{ id: "symbol", text: "ΔH", basis: "Approved conventional enthalpy symbol" }] });
    const step = growth(); step.knowledgeOps.push({ action: "ADD_OBJECT", core: created("main"), as: "symbol", value: { text: "ΔH", provenance: { speech: [], state: [], domain: { rule: "symbol" } } } });
    const result = acceptCoreInterpretation(request, propose(step), timestamp);
    expect(result.steps[0]!.knowledgeOps.at(-1)).toMatchObject({ value: { provenance: { speechRefs: [], domainBasis: "symbol: Approved conventional enthalpy symbol" } } });
    const denied = binding(); expect(() => acceptCoreInterpretation(denied, propose(step), timestamp)).toThrow("not-authorized");
    const last = step.knowledgeOps.at(-1)!; if ("value" in last) last.value.provenance.speech = ["e0"];
    expect(() => acceptCoreInterpretation(request, propose(step), timestamp)).toThrow("domain-not-speech");
  });
  it("requires host-verified evidence for settled AI correction", () => {
    const wrong = "A triangle has four sides.", corrected = "A triangle has three sides.";
    const rule = { id: "triangle_verified", text: corrected, basis: "Trusted geometry reference" };
    const base = commitText(start(), wrong);
    const request = buildCoreInterpretationContext(base, { requestId: "ai-correct", newEvidence: base.checkpoints, domainRules: [rule] });
    const step = empty(); step.evidenceRefs = ["e0"];
    step.knowledgeOps = [
      { action: "CREATE_CORE", as: "geometry", provenance: p() },
      { action: "ADD_OBJECT", core: created("geometry"), as: "corrected", value: { text: corrected, provenance: { speech: [], state: [], domain: null, aiCorrection: { trigger: "e0", evidenceRule: rule.id, rationale: "The trusted rule contradicts the teacher claim." } } } },
      { action: "SET_CURRENT_CORE", core: created("geometry") },
    ];
    const accepted = acceptCoreInterpretation(request, propose(step), timestamp);
    const op = accepted.steps[0]!.knowledgeOps[1]!;
    expect(op).toMatchObject({ action: "ADD_OBJECT", value: { text: corrected, provenance: { speechRefs: [], stateRefs: [], aiCorrection: { trigger: { quote: wrong }, evidenceBasis: `${rule.id}: ${rule.basis}` } } } });
    if (op.action !== "ADD_OBJECT") throw new Error("fixture");
    expect(op.value.provenance.domainBasis).toBeUndefined();
    const next = commitText(accepted.replay, "Continue with the example.");
    const target = { kind: "OBJECT" as const, coreId: op.coreId, id: op.id };
    const projected = buildCoreInterpretationContext(next, { requestId: "ai-origin", newEvidence: [next.checkpoints.at(-1)!], required: [target], domainRules: [rule] });
    expect(projected.context.entities.find(e => e.text === corrected)?.origins).toEqual(["ai_correction"]);

    const historical = projected.context.evidence.find(e => e.text === wrong)!;
    const stale = empty(); stale.evidenceRefs = ["e0"];
    stale.knowledgeOps = [{ action: "ADD_OBJECT", core: { existing: projected.context.knowledge.current! }, as: "stale_correction", value: { text: corrected, provenance: { speech: [], state: [], domain: null, aiCorrection: { trigger: historical.handle, evidenceRule: rule.id, rationale: "Historical trigger cannot authorize a fresh correction." } } } }];
    expect(() => acceptCoreInterpretation(projected, propose(stale), timestamp)).toThrow("speech-unavailable");

    const unverified = buildCoreInterpretationContext(base, { requestId: "ai-unverified", newEvidence: base.checkpoints });
    expect(() => acceptCoreInterpretation(unverified, propose(step), timestamp)).toThrow("evidence-not-verified");
    const mismatch = structuredClone(step);
    const mismatchOp = mismatch.knowledgeOps[1]!;
    if ("value" in mismatchOp) mismatchOp.value.text = "A triangle has exactly 3 edges.";
    expect(() => acceptCoreInterpretation(request, propose(mismatch), timestamp)).toThrow("evidence-mismatch");

    const cue = empty(); cue.evidenceRefs = ["e0"];
    cue.cueDelta = { action: "SET", as: "bad_cue", value: { text: "Do something.", kind: "TASK", target: null, provenance: { speech: [], state: [], domain: null, aiCorrection: { trigger: "e0", evidenceRule: rule.id, rationale: "Correction cannot create learner work." } } } };
    expect(() => acceptCoreInterpretation(request, propose(cue), timestamp)).toThrow("cue-ai-correction-forbidden");
  });
  it("accepts an explicitly AI-initiated Cue without pretending the teacher initiated it", () => {
    const teaching = "Activation energy is the barrier reactants must overcome.";
    const base = commitText(start(), teaching), request = buildCoreInterpretationContext(base, { requestId: "ai-cue", newEvidence: base.checkpoints });
    const step = empty(); step.evidenceRefs = ["e0"];
    step.cueDelta = { action: "SET", as: "check", value: { text: "Which part of an energy profile represents the activation barrier?", kind: "QUESTION", target: null,
      provenance: { speech: ["e0"], state: [], domain: null }, origin: { kind: "AI", trigger: "e0", rationale: "A brief retrieval question is useful at this concept boundary." } } };
    const accepted = acceptCoreInterpretation(request, propose(step), timestamp);
    expect(accepted.replay.state.cue.active).toMatchObject({ kind: "QUESTION", origin: { kind: "AI", trigger: { quote: teaching } } });
    expect(accepted.replay.state.cue.active!.provenance.speechRefs[0]!.quote).toBe(teaching);
    expect(accepted.replay.state.knowledge).toEqual(base.state.knowledge);
  });
  it.each(["OBJECT", "RELATION", "SUPPORT"] as const)("revises and supersedes projected %s without changing unrelated identities", kind => {
    const f = foundation(), base = evidence(f.replay), request = buildCoreInterpretationContext(base, { requestId: "local", newEvidence: [base.checkpoints.at(-1)!], writable: [{ kind, coreId: f.coreId, id: kind === "OBJECT" ? f.a : kind === "RELATION" ? f.relationId : f.supportId }] });
    const h = (id: string) => existing([...request.entities].find(([, e]) => e.target.id === id)![0]);
    const id = kind === "OBJECT" ? f.a : kind === "RELATION" ? f.relationId : f.supportId;
    const v = kind === "OBJECT" ? value("Corrected proposition") : kind === "RELATION" ? { ...value("Corrected relationship"), from: h(f.a), to: h(f.b) } : { ...value("Corrected example"), target: h(f.coreId) };
    const step = empty(); step.evidenceRefs = ["e0"];
    step.knowledgeOps = [{ action: `REVISE_${kind}`, target: h(id), value: v, correctionEvidence: "e0" } as ProposalStep["knowledgeOps"][number]];
    const revised = acceptCoreInterpretation(request, propose(step), timestamp);
    expect(revised.steps[0]!.knowledgeOps[0]).toMatchObject({ id });
    expect(revised.replay.state.cue).toEqual(base.state.cue);
    step.knowledgeOps = [{ action: `ADD_${kind}`, core: h(f.coreId), as: "replacement", value: v } as ProposalStep["knowledgeOps"][number], { action: "SUPERSEDE", target: h(id), replacement: created("replacement"), correctionEvidence: "e0" }];
    const invalidation = empty(); invalidation.evidenceRefs = ["e0"];
    invalidation.knowledgeOps = [{ action: "INVALIDATE", target: h(id), correctionEvidence: "e0" }];
    const invalidated = acceptCoreInterpretation(request, propose(invalidation), timestamp);
    expect(invalidated.steps[0]!.knowledgeOps[0]).toMatchObject({ action: "INVALIDATE", target: { id } });
    const superseded = acceptCoreInterpretation(request, propose(step), timestamp);
    const collection = kind === "OBJECT" ? "objects" : kind === "RELATION" ? "relations" : "supports";
    expect(superseded.replay.state.knowledge.cores[f.coreId]![collection][id]!.status).toBe("superseded");
    expect(superseded.replay.state.cue).toEqual(base.state.cue);
  });
  it.each(["REVISE", "REPLACE", "RESOLVE"] as const)("normalizes Cue %s while preserving knowledge", action => {
    const f = foundation(), base = evidence(f.replay), request = buildCoreInterpretationContext(base, { requestId: "cue", newEvidence: [base.checkpoints.at(-1)!], writable: [{ kind: "CUE", id: f.cueId }] });
    const step = empty(); step.evidenceRefs = ["e0"];
    const target = existing(request.context.cue.active!), v = { ...value("Compare A carefully"), kind: "QUESTION" as const, target: null };
    step.cueDelta = action === "RESOLVE" ? { action, target, evidence: "e0" } : action === "REVISE" ? { action, target, value: v } : { action, target, as: "nextcue", value: v, evidence: "e0" };
    const result = acceptCoreInterpretation(request, propose(step), timestamp);
    expect(result.replay.state.knowledge).toEqual(base.state.knowledge);
    if (action === "RESOLVE") expect(result.replay.state.cue.active).toBeUndefined();
    if (action === "REVISE") expect(result.replay.state.cue.active!.id).toBe(f.cueId);
    if (action === "REPLACE") expect(result.replay.state.cue.active!.id).not.toBe(f.cueId);
  });
});

it("separates structural references from authorized factual provenance without weakening Core rejection", () => {
  const f = foundation(), base = evidence(f.replay);
  const target = { kind: "OBJECT" as const, coreId: f.coreId, id: f.a };
  const options = { requestId: "basis", newEvidence: [base.checkpoints.at(-1)!], includeCue: false, required: [{ kind: "RELATION" as const, coreId: f.coreId, id: f.relationId }], budgets: { optionalRoots: 0 } };
  const referenceOnly = buildCoreInterpretationContext(base, options);
  const h = (id: string) => ({ existing: [...referenceOnly.entities].find(([, e]) => e.target.id === id)![0] });
  const step = empty(); step.evidenceRefs = ["e0"];
  step.knowledgeOps = [{ action: "ADD_SUPPORT", core: h(f.coreId), as: "derived", value: { text: "Representation of A", target: h(f.a), provenance: { speech: [], state: [h(f.a)], domain: null } } }];
  expect(referenceOnly.entities.get(h(f.a).existing)!.capabilities).toEqual(["reference"]);
  expect(() => acceptCoreInterpretation(referenceOnly, propose(step), timestamp)).toThrow("capability-denied");
  const authorized = buildCoreInterpretationContext(base, { ...options, factualBasis: [target] });
  const result = acceptCoreInterpretation(authorized, propose(step), timestamp);
  expect(result.steps[0]!.knowledgeOps[0]).toMatchObject({ value: { provenance: { stateRefs: [{ target, revision: 1 }], speechRefs: [] } } });
  const coreSource = structuredClone(step);
  const op = coreSource.knowledgeOps[0]!;
  if ("value" in op) op.value.provenance.state = [h(f.coreId)];
  expect(() => acceptCoreInterpretation(authorized, propose(coreSource), timestamp)).toThrow("core-container-not-factual-basis");
  expect(buildCoreInterpretationContext(base, { ...options, factualBasis: [{ kind: "CORE", id: f.coreId }] }).entities.get(h(f.coreId).existing)!.capabilities).not.toContain("factual_basis");
});

it("cannot refocus an ungrounded current shell even with explicit Core write scope", () => {
  const f = foundation(), base = evidence(f.replay);
  const bound = buildCoreInterpretationContext(base, { requestId: "shell", newEvidence: [base.checkpoints.at(-1)!], includeCue: false, writable: [{ kind: "CORE", id: f.coreId }], budgets: { optionalRoots: 0 } });
  expect(bound.context.entities).toHaveLength(1);
  expect(bound.context.entities[0]!.capabilities).toEqual(["reference", "append"]);
  const step = empty(); step.evidenceRefs = ["e0"]; step.knowledgeOps = [{ action: "SET_CURRENT_CORE", core: existing(bound.context.knowledge.current!) }];
  expect(() => acceptCoreInterpretation(bound, propose(step), timestamp)).toThrow("capability-denied");
  expect(acceptCoreInterpretation(bound, { outcome: { kind: "NEEDS_CONTEXT", query: "the earlier statement", evidence: ["e0"] } }, timestamp).events).toEqual([]);
});
