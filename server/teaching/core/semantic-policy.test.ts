import { expect, it } from "vitest";
import { CORE_INTERPRETATION_POLICY, CORE_POLICY_VERSION } from "./semantic-policy.ts";
import { buildCoreInterpretationContext, CORE_CONTEXT_VERSION } from "../../../src/lesson-stream/core/interpretation-context.ts";
import { acceptCoreInterpretation } from "../../../src/lesson-stream/core/interpretation-validation.ts";
import { appendCoreEvent, type CoreReplay } from "../../../src/lesson-stream/core/replay.ts";
import { evidence, foundation, timestamp, start } from "../../../src/lesson-stream/core/test-fixtures.ts";
import type { ProposalStep } from "../../../src/lesson-stream/core/interpretation-proposal.ts";

function commit(base: CoreReplay, text: string) {
  const event = evidence(base).events.at(-1)!;
  if (event.type !== "evidence.checkpoint_committed") throw new Error("fixture");
  event.checkpoint.text = text;
  return appendCoreEvent(base, event);
}
const noop = (): ProposalStep => ({ consumes: ["e0"], knowledgeOps: [], cueDelta: { action: "KEEP" }, evidenceRefs: [], readRefs: [], reads: { knowledge: false, cue: false }, warnings: [] });
const propose = (step: ProposalStep) => ({ outcome: { kind: "PROPOSE", steps: [step] } });
it("versions the autonomy authority without a classifier or frozen-case wording", () => {
  expect(CORE_CONTEXT_VERSION).toBe("core-interpretation-context-v3");
  expect(CORE_POLICY_VERSION).toBe("alpha-core-interpretation-v6");
  for (const principle of [
    "reference permits structural targets and readRefs", "only factual_basis", "unfinished current teaching phrase", "not merely an unfinished current utterance",
    "without an explicit transition phrase", "unresolved active Cue does not imply", "Exact Core-boundary heuristics remain open", "lone visible Core shell does not identify",
    "use it as accepted-state provenance", "availability, not automatic relevance", "Model confidence alone is never sufficient factual authority",
    "NEEDS_VERIFICATION", "candidateEvidence is only a lead for verification", "aiCorrection.evidenceRule", "AI correction is knowledge authority only",
    "autonomously initiated by CueLayer", "origin.trigger", "Intervention Governor", "do not optimize for interaction count",
    "common learner-visible path must not wait"
  ]) expect(CORE_INTERPRETATION_POLICY).toContain(principle);
  for (const exposed of ["photosynthesis explanation", "Topic 19", "And the activation", "squares", "equal sides", "CORE2-H-accepted-representation", "Represent that same equality", "All prime numbers are odd"]) expect(CORE_INTERPRETATION_POLICY).not.toContain(exposed);
  for (const obsolete of ["confidence=high", "Cue lifecycle depends only on learner work actually established by current teacher speech", "Never invent tasks/questions/hints"]) expect(CORE_INTERPRETATION_POLICY).not.toContain(obsolete);
});
it("accepts an unfinished phrase as no-op and supplies its immutable evidence on continuation", () => {
  const f = foundation(), fragment = "The additional condition is...";
  const base = commit(f.replay, fragment), bound = buildCoreInterpretationContext(base, { requestId: "fragment", newEvidence: [base.checkpoints.at(-1)!] });
  const result = acceptCoreInterpretation(bound, propose(noop()), timestamp);
  expect(result.replay.state.knowledge).toEqual(base.state.knowledge);
  expect(result.replay.state.cue).toEqual(base.state.cue);
  expect(result.events).toHaveLength(1);
  const next = commit(result.replay, "that A must remain positive.");
  const continuation = buildCoreInterpretationContext(next, { requestId: "continuation", newEvidence: [next.checkpoints.at(-1)!] });
  const historical = continuation.context.evidence.find(e => e.text === fragment)!;
  expect(historical.consumption).toBe("history");
  const step = noop(); step.evidenceRefs = ["e0"];
  step.knowledgeOps = [{ action: "ADD_OBJECT", core: { existing: continuation.context.knowledge.current! }, as: "condition", value: { text: "A must remain positive.", provenance: { speech: [historical.handle, "e0"], state: [], domain: null } } }];
  const accepted = acceptCoreInterpretation(continuation, propose(step), timestamp);
  expect(accepted.steps[0]!.consumesCheckpointIds).toEqual([next.checkpoints.at(-1)!.checkpointId]);
  expect(accepted.steps[0]!.knowledgeOps[0]).toMatchObject({ value: { provenance: { speechRefs: [{ quote: fragment }, { quote: "that A must remain positive." }] } } });
});
it.each([true, false])("preserves active Cue across a %s distinct explanatory mainline", distinct => {
  const f = foundation(), text = distinct ? "Velocity is displacement per unit time." : "A's definition also requires a positive value.";
  const base = commit(f.replay, text), bound = buildCoreInterpretationContext(base, { requestId: "boundary", newEvidence: [base.checkpoints.at(-1)!] });
  const step = noop(); step.evidenceRefs = ["e0"];
  const provenance = { speech: ["e0"], state: [], domain: null };
  if (distinct) step.knowledgeOps.push({ action: "CREATE_CORE", as: "mainline", provenance });
  step.knowledgeOps.push({ action: "ADD_OBJECT", core: distinct ? { created: "mainline" } : { existing: bound.context.knowledge.current! }, as: "definition", value: { text, provenance } });
  if (distinct) step.knowledgeOps.push({ action: "SET_CURRENT_CORE", core: { created: "mainline" } });
  const result = acceptCoreInterpretation(bound, propose(step), timestamp);
  expect(result.replay.state.cue).toEqual(base.state.cue);
  expect(Object.keys(result.replay.state.knowledge.cores)).toHaveLength(distinct ? 2 : 1);
  expect(result.replay.state.knowledge.currentCoreId === f.coreId).toBe(!distinct);
});

it.each([true, false])("distinguishes available accepted factual content from an omitted referent (visible=%s)", visible => {
  const statement = "The reservoir holds twelve litres.", instruction = "Restate the reservoir's capacity.";
  const initial = commit(start(), statement);
  const initialBinding = buildCoreInterpretationContext(initial, { requestId: "capacity", newEvidence: initial.checkpoints });
  const setup = noop(), provenance = { speech: ["e0"], state: [], domain: null };
  setup.evidenceRefs = ["e0"];
  setup.knowledgeOps = [
    { action: "CREATE_CORE", as: "reservoir", provenance },
    { action: "ADD_OBJECT", core: { created: "reservoir" }, as: "capacity", value: { text: statement, provenance } },
    { action: "SET_CURRENT_CORE", core: { created: "reservoir" } },
  ];
  const accepted = acceptCoreInterpretation(initialBinding, propose(setup), timestamp);
  const coreId = accepted.replay.state.knowledge.currentCoreId!;
  const objectId = Object.keys(accepted.replay.state.knowledge.cores[coreId]!.objects)[0]!;
  const target = { kind: "OBJECT" as const, coreId, id: objectId };
  const base = commit(accepted.replay, instruction);
  const bound = buildCoreInterpretationContext(base, { requestId: "restate", newEvidence: [base.checkpoints.at(-1)!], includeCue: false,
    factualBasis: visible ? [target] : [], budgets: { optionalRoots: 0, recentEvidence: 0, recentChanges: 0 } });
  expect(bound.context.evidence.map(e => e.text)).toEqual([instruction]);
  expect(bound.context.knowledge.current).not.toBeNull();
  expect(bound.base.state.knowledge.cores[coreId]!.objects[objectId]!.value.text).toBe(statement);
  if (visible) {
    const fact = bound.context.entities.find(e => e.text === statement)!;
    expect(fact).toMatchObject({ kind: "OBJECT", status: "valid", capabilities: ["reference", "factual_basis"] });
    expect(bound.entities.get(fact.handle)!.target).toEqual(target);
    const step = noop(); step.evidenceRefs = ["e0"];
    step.knowledgeOps = [{ action: "ADD_OBJECT", core: { existing: bound.context.knowledge.current! }, as: "restated_capacity",
      value: { text: "The reservoir's capacity is twelve litres.", provenance: { speech: [], state: [{ existing: fact.handle }], domain: null } } }];
    const result = acceptCoreInterpretation(bound, propose(step), timestamp);
    expect(result.kind).toBe("PROPOSE");
    expect(result.events).toHaveLength(1);
    expect(result.steps[0]!.knowledgeOps[0]).toMatchObject({ value: { provenance: { stateRefs: [{ target, revision: 1 }], speechRefs: [] } } });
  } else {
    expect(bound.context.entities).toHaveLength(1);
    expect(bound.context.entities[0]).toMatchObject({ kind: "CORE", contents: "partial", capabilities: ["reference", "append"] });
    expect(bound.context.entities.some(e => e.capabilities.includes("factual_basis"))).toBe(false);
    const result = acceptCoreInterpretation(bound, { outcome: { kind: "NEEDS_CONTEXT", query: instruction, evidence: ["e0"] } }, timestamp);
    expect(result.events).toEqual([]);
    expect(result.steps).toEqual([]);
    expect(result.replay).toEqual(base);
  }
});

it("keeps domain metadata distinct from learner-action authority", () => {
  for (const rule of ["Domain rules are host-supplied trusted factual authority", "metadata, labels, permissions", "must never by themselves establish that the teacher asked a NOTE, QUESTION, TASK or HINT", "TEACHER origin", "AI origin", "origin.trigger", "do not ask or hint merely because interaction is possible"]) expect(CORE_INTERPRETATION_POLICY).toContain(rule);
  for (const frozen of ["CORE1-domain", "enthalpy", "ΔH", "Supply its conventional symbol as enrichment."]) expect(CORE_INTERPRETATION_POLICY).not.toContain(frozen);
});

it.each([false, true])("keeps authorized domain knowledge independent of teacher-established learner work (instruction=%s)", learnerWork => {
  const teaching = "Shear stress is force parallel to a surface divided by area.";
  const instruction = "Sketch a surface with a force arrow parallel to it.";
  const rule = { id: "stress_notation", text: "τ is the conventional symbol for shear stress.",
    basis: "Knowledge permission. TASK label: copy notation. QUESTION label: name the symbol. NOTE label: remember notation. HINT label: inspect notation." };
  const base = commit(start(), teaching + (learnerWork ? ` ${instruction}` : ""));
  const bound = buildCoreInterpretationContext(base, { requestId: "domain-cue-separation", newEvidence: base.checkpoints, domainRules: [rule] });
  expect(bound.context.cue.presence).toBe("absent");
  expect(bound.context.domainRules).toEqual([rule]);
  expect(bound.context.evidence).toHaveLength(1);
  expect(bound.context.evidence[0]!.text).not.toContain(rule.text);
  expect(bound.context.evidence[0]!.text).not.toContain(rule.basis);
  const speech = { speech: ["e0"], state: [], domain: null };
  const step = noop(); step.evidenceRefs = ["e0"];
  step.knowledgeOps = [
    { action: "CREATE_CORE", as: "stress", provenance: speech },
    { action: "ADD_OBJECT", core: { created: "stress" }, as: "definition", value: { text: teaching, provenance: speech } },
    { action: "ADD_OBJECT", core: { created: "stress" }, as: "notation", value: { text: rule.text, provenance: { speech: [], state: [], domain: { rule: rule.id } } } },
    { action: "SET_CURRENT_CORE", core: { created: "stress" } },
  ];
  if (learnerWork) step.cueDelta = { action: "SET", as: "drawing", value: { text: instruction, kind: "TASK", target: { created: "stress" }, provenance: speech,
    origin: { kind: "TEACHER", evidence: "e0" } } };
  const accepted = acceptCoreInterpretation(bound, propose(step), timestamp);
  const domainOp = accepted.steps[0]!.knowledgeOps[2]!;
  expect(domainOp).toMatchObject({ value: { text: rule.text, provenance: { speechRefs: [], stateRefs: [], domainBasis: `${rule.id}: ${rule.basis}` } } });
  if (learnerWork) {
    expect(accepted.replay.state.cue.active).toMatchObject({ kind: "TASK", text: instruction, provenance: { speechRefs: [{ quote: `${teaching} ${instruction}` }], stateRefs: [] }, origin: { kind: "TEACHER" } });
    expect(accepted.replay.state.cue.active!.provenance.domainBasis).toBeUndefined();
    expect(accepted.replay.state.cue.active!.provenance.aiCorrection).toBeUndefined();
    const withoutCue = structuredClone(step); withoutCue.cueDelta = { action: "KEEP" };
    expect(acceptCoreInterpretation(bound, propose(withoutCue), timestamp).replay.state.knowledge).toEqual(accepted.replay.state.knowledge);
    const cueOnly = noop(); cueOnly.evidenceRefs = ["e0"];
    cueOnly.cueDelta = { action: "SET", as: "drawing", value: { text: instruction, kind: "TASK", target: null, provenance: speech, origin: { kind: "TEACHER", evidence: "e0" } } };
    const cueAccepted = acceptCoreInterpretation(bound, propose(cueOnly), timestamp);
    expect(cueAccepted.replay.state.knowledge).toEqual(base.state.knowledge);
    expect(cueAccepted.replay.state.cue.active?.text).toBe(instruction);
  } else {
    expect(accepted.steps[0]!.cueDelta).toEqual({ action: "KEEP" });
    expect(accepted.replay.state.cue).toEqual(base.state.cue);
    expect(accepted.replay.state.cue.active).toBeUndefined();
  }
  for (const kind of ["NOTE", "QUESTION", "TASK", "HINT"] as const) {
    const invalid = structuredClone(step);
    invalid.cueDelta = { action: "SET", as: "metadata_cue", value: { text: rule.basis, kind, target: null, provenance: { speech: [], state: [], domain: { rule: rule.id } }, origin: { kind: "AI", trigger: "e0", rationale: "Metadata is not learner-work authority." } } };
    expect(() => acceptCoreInterpretation(bound, propose(invalid), timestamp)).toThrow("cue-domain-forbidden");
  }
});
