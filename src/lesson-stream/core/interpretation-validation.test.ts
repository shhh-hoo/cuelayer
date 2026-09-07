import { describe, expect, it } from "vitest";
import { buildCoreInterpretationContext } from "./interpretation-context.ts";
import { acceptCoreInterpretation } from "./interpretation-validation.ts";
import { coreProposalSchema, type ProposalStep } from "./interpretation-proposal.ts";
import { appendCoreEvent, replayCoreEvents } from "./replay.ts";
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
  it("does not leak creation aliases across requests", () => {
    const request = binding(), accepted = acceptCoreInterpretation(request, propose(growth()), timestamp);
    const next = evidence(accepted.replay), bound = buildCoreInterpretationContext(next, { requestId: "next", newEvidence: [next.checkpoints.at(-1)!] });
    const step = empty(); step.evidenceRefs = ["e0"]; step.knowledgeOps = [{ action: "SET_CURRENT_CORE", core: created("main") }];
    expect(() => acceptCoreInterpretation(bound, propose(step), timestamp)).toThrow();
  });
  it("rejects omitted and read-only mutations even though IDs exist in accepted state", () => {
    const f = foundation(), base = evidence(f.replay), target = { kind: "OBJECT" as const, coreId: f.coreId, id: f.a };
    const request = buildCoreInterpretationContext(base, { requestId: "r", newEvidence: [base.checkpoints.at(-1)!], required: [target], readOnly: [target] });
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
    const f = foundation(), base = evidence(f.replay), request = buildCoreInterpretationContext(base, { requestId: "cue-only", newEvidence: [base.checkpoints.at(-1)!] });
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
  it.each(["OBJECT", "RELATION", "SUPPORT"] as const)("revises and supersedes projected %s without changing unrelated identities", kind => {
    const f = foundation(), base = evidence(f.replay), request = buildCoreInterpretationContext(base, { requestId: "local", newEvidence: [base.checkpoints.at(-1)!] });
    const h = (id: string) => existing([...request.entities].find(([, e]) => e.target.id === id)![0]);
    const id = kind === "OBJECT" ? f.a : kind === "RELATION" ? f.relationId : f.supportId;
    const v = kind === "OBJECT" ? value("Corrected proposition") : kind === "RELATION" ? { ...value("Corrected relationship"), from: h(f.a), to: h(f.b) } : { ...value("Corrected example"), target: h(f.coreId) };
    const step = empty(); step.evidenceRefs = ["e0"];
    step.knowledgeOps = [{ action: `REVISE_${kind}`, target: h(id), value: v, correctionEvidence: "e0" } as ProposalStep["knowledgeOps"][number]];
    const revised = acceptCoreInterpretation(request, propose(step), timestamp);
    expect(revised.steps[0]!.knowledgeOps[0]).toMatchObject({ id });
    expect(revised.replay.state.cue).toEqual(base.state.cue);
    step.knowledgeOps = [{ action: `ADD_${kind}`, core: h(f.coreId), as: "replacement", value: v } as ProposalStep["knowledgeOps"][number], { action: "SUPERSEDE", target: h(id), replacement: created("replacement"), correctionEvidence: "e0" }];
    const superseded = acceptCoreInterpretation(request, propose(step), timestamp);
    const collection = kind === "OBJECT" ? "objects" : kind === "RELATION" ? "relations" : "supports";
    expect(superseded.replay.state.knowledge.cores[f.coreId]![collection][id]!.status).toBe("superseded");
    expect(superseded.replay.state.cue).toEqual(base.state.cue);
  });
  it.each(["REVISE", "REPLACE", "RESOLVE"] as const)("normalizes Cue %s while preserving knowledge", action => {
    const f = foundation(), base = evidence(f.replay), request = buildCoreInterpretationContext(base, { requestId: "cue", newEvidence: [base.checkpoints.at(-1)!] });
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
