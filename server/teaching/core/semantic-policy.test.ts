import { expect, it } from "vitest";
import { CORE_INTERPRETATION_POLICY, CORE_POLICY_VERSION } from "./semantic-policy.ts";
import { buildCoreInterpretationContext, CORE_CONTEXT_VERSION } from "../../../src/lesson-stream/core/interpretation-context.ts";
import { acceptCoreInterpretation } from "../../../src/lesson-stream/core/interpretation-validation.ts";
import { appendCoreEvent, type CoreReplay } from "../../../src/lesson-stream/core/replay.ts";
import { evidence, foundation, timestamp } from "../../../src/lesson-stream/core/test-fixtures.ts";
import type { ProposalStep } from "../../../src/lesson-stream/core/interpretation-proposal.ts";

function commit(base: CoreReplay, text: string) {
  const event = evidence(base).events.at(-1)!;
  if (event.type !== "evidence.checkpoint_committed") throw new Error("fixture");
  event.checkpoint.text = text;
  return appendCoreEvent(base, event);
}
const noop = (): ProposalStep => ({ consumes: ["e0"], knowledgeOps: [], cueDelta: { action: "KEEP" }, evidenceRefs: [], readRefs: [], reads: { knowledge: false, cue: false }, warnings: [] });
const propose = (step: ProposalStep) => ({ outcome: { kind: "PROPOSE", steps: [step] } });
it("versions the changed context and policy without a classifier or holdout wording", () => {
  expect(CORE_CONTEXT_VERSION).toBe("core-interpretation-context-v2");
  expect(CORE_POLICY_VERSION).toBe("alpha-core-interpretation-v2");
  for (const principle of ["reference permits structural targets and readRefs", "only factual_basis", "unfinished current teaching phrase", "not merely an unfinished current utterance", "without an explicit transition phrase", "unresolved active Cue does not imply", "Exact Core-boundary heuristics remain open", "lone visible Core shell does not identify"]) expect(CORE_INTERPRETATION_POLICY).toContain(principle);
  for (const exposed of ["photosynthesis explanation", "Topic 19", "And the activation"]) expect(CORE_INTERPRETATION_POLICY).not.toContain(exposed);
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
