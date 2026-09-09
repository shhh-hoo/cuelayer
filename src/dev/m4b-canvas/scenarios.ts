import type { CoreTeachingState, SemanticReference } from "../../lesson-stream/core/contracts.ts";
import { reduceCoreStep } from "../../lesson-stream/core/teaching-state.ts";
import { M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES } from "../../learner-projection/grounded-fixtures.ts";
import type { LearnerProjection, LearnerProjectionFixture } from "../../learner-projection/contracts.ts";

export type ScenarioStep = { label: string; state: CoreTeachingState; projection: LearnerProjection; note?: string; recentChanges?: LearnerProjectionFixture["input"]["recentChanges"] };
export type Scenario = { id: string; title: string; steps: ScenarioStep[] };
export const fixture = (id: string) => M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES.find(f => f.id === id)!;
const clone = <T,>(value: T): T => structuredClone(value);
const object = (coreId: string, id: string): SemanticReference => ({ kind: "OBJECT", coreId, id });
const focus = (state: CoreTeachingState, anchor: SemanticReference, projector: LearnerProjection["projector"] = "FOLLOW_ATTENTION", context: SemanticReference[] = []): LearnerProjection => ({
  attention: { anchor, emphasis: [], context, support: [], representations: [] },
  transition: { knowledge: "ADVANCE", framing: "FOCUS", representation: "KEEP" }, projector,
  parkedCoreIds: Object.keys(state.knowledge.cores).filter(id => id !== state.knowledge.currentCoreId),
});
const step = (label: string, f: LearnerProjectionFixture): ScenarioStep => ({ label, state: f.input.state, projection: f.expected, recentChanges: f.input.recentChanges });

const catalyst = clone(fixture("rsc-catalyst-open-practical").input.state);
catalyst.sessionId = "m4b:catalyst-arrhenius";
catalyst.cue = { revision: 0 };
function catalystStage(ids: string[]) {
  const state = clone(catalyst), core = state.knowledge.cores.catalysts!;
  core.objects = Object.fromEntries(Object.entries(core.objects).filter(([id]) => ids.includes(id)));
  core.relations = Object.fromEntries(Object.entries(core.relations).filter(([, r]) => ids.includes(r.value.fromObjectId) && ids.includes(r.value.toObjectId)));
  return state;
}
const first = catalystStage(["catalyst"]);
const path = catalystStage(["catalyst", "alternative-path"]);
const growth: ScenarioStep[] = [
  { label: "Establish Catalyst", state: first, projection: focus(first, object("catalysts", "catalyst"), "REFRAME_ATTENTION") },
  { label: "Add alternative pathway", state: path, projection: focus(path, object("catalysts", "alternative-path"), "FOLLOW_ATTENTION", [object("catalysts", "catalyst")]) },
  { label: "Add lower activation energy", state: catalyst, projection: focus(catalyst, object("catalysts", "lower-ea"), "FOLLOW_ATTENTION", [object("catalysts", "alternative-path")]) },
];
// Synthetic accepted snapshots reuse PR16's Catalyst → Arrhenius sequence. They
// are review inputs, not a second interpreter or persisted lesson-event source.
const shifted = clone(catalyst);
const fact = (text: string) => ({ text, provenance: { speechRefs: [{ checkpointId: "m4b:arrhenius", quote: text }], stateRefs: [] } });
shifted.knowledge = { ...shifted.knowledge, revision: 2, currentCoreId: "arrhenius", cores: { ...shifted.knowledge.cores,
  arrhenius: { id: "arrhenius", provenance: fact("Arrhenius equation").provenance,
    objects: { rate: { id: "rate", status: "valid", value: fact("The Arrhenius equation relates the rate constant to temperature.") } }, relations: {}, supports: {} },
} };
const equation = clone(shifted);
equation.knowledge.revision++;
equation.knowledge.cores.arrhenius!.objects.equation = { id: "equation", status: "valid", value: fact("k = A exp(−Eₐ / RT)") };
equation.knowledge.cores.arrhenius!.relations.link = { id: "link", status: "valid", value: { ...fact("Temperature enters the exponential relationship."), fromObjectId: "rate", toObjectId: "equation" } };

/** True semantic refocus crosses the existing acceptance reducer independently
 * of every inspection control; this fixture carries explicit synthetic evidence.
 */
export function acceptedRefocus(state: CoreTeachingState, coreId: string): CoreTeachingState {
  const checkpointId = "m4b:accepted-refocus", quote = "Let's go back to catalysts.";
  return reduceCoreStep(state, {
    requestId: "m4b:refocus", stepIndex: 0, baseKnowledgeRevision: state.knowledge.revision,
    baseCueRevision: state.cue.revision, consumesCheckpointIds: [checkpointId],
    knowledgeOps: [{ action: "SET_CURRENT_CORE", coreId }], cueDelta: { action: "KEEP" },
    evidenceRefs: [{ checkpointId, quote }], stateRefs: [], warnings: [], acceptedAt: "2026-09-09T04:00:00.000Z",
  }, [{ checkpointId, lessonSequence: state.processedThroughSequence + 1, speechRunId: "m4b:synthetic", startMs: 1, endMs: 2, text: quote, sourceFinalIds: [], warnings: [] }]);
}
const refocused = acceptedRefocus(equation, "catalysts");
const shift: ScenarioStep[] = [...growth,
  { label: "Shift teaching to Arrhenius", state: shifted, projection: focus(shifted, object("arrhenius", "rate"), "REFRAME_ATTENTION"), note: "Inspect Catalyst now. Teaching remains on Arrhenius; Next keeps the camera under your control." },
  { label: "Arrhenius grows during inspection", state: equation, projection: focus(equation, object("arrhenius", "equation")), note: "Follow teaching returns directly to the latest equation. Or continue to the accepted refocus." },
  { label: "Accepted semantic refocus to Catalyst", state: refocused, projection: focus(refocused, object("catalysts", "catalyst"), "REFRAME_ATTENTION"), recentChanges: [{ ref: { kind: "CORE", id: "catalysts" }, kind: "REFOCUSED" }], note: "Semantic acceptance changed currentCoreId. Inspection still holds until Follow teaching." },
];
const ion = fixture("cambridge-ionisation-representation-switch");
const ionText = clone(ion.expected);
ionText.attention.representations = [];
ionText.transition.representation = "KEEP";
ionText.projector = "REFRAME_ATTENTION";
const work = fixture("cs-algorithm-code-dry-run");
const withoutWork = clone(work.expected); delete withoutWork.workSurface;
const workSettled = clone(work.expected); workSettled.workSurface!.blocks[0]!.status = "SETTLED";
const history = fixture("history-contemporary-sources-competing-interpretations");
const widen = fixture("rsc-group2-review-widen");
const tangent = fixture("mit-free-tangent-and-return");
const support = fixture("cambridge-kinetics-concept-graph-practical");
const supportHidden = clone(support.expected); supportHidden.attention.support = []; supportHidden.projector = "PRESERVE_VIEW";
const supportParked = clone(support.input.state);
supportParked.knowledge.currentCoreId = "arrhenius";
supportParked.knowledge.revision++;
supportParked.knowledge.cores.arrhenius = clone(shifted.knowledge.cores.arrhenius!);
const longRevision = clone(first);
longRevision.knowledge.revision++;
longRevision.knowledge.cores.catalysts!.objects.catalyst!.value = fact(
  "A catalyst increases the reaction rate by providing an alternative pathway with a lower activation energy. " +
  "It participates in intermediate steps and is regenerated overall; it does not change the equilibrium constant. ".repeat(5));

export const SCENARIOS: Scenario[] = [
  { id: "growth", title: "A · Incremental Core growth", steps: growth },
  { id: "shared-inspection", title: "F–J · Core shift, inspection & refocus", steps: shift },
  { id: "representation", title: "B · Ionisation representation switch", steps: [
    { label: "Definition as text", state: ion.input.state, projection: ionText },
    step("Same identity · chemical equation", ion),
  ] },
  { id: "work", title: "C · CS Work Surface lifecycle", steps: [
    { label: "Established algorithm", state: work.input.state, projection: { ...withoutWork, projector: "REFRAME_ATTENTION" } },
    step("Dry-run table appears", work),
    { label: "Same work block settles", state: work.input.state, projection: workSettled },
    { label: "Work disappears; knowledge stays", state: work.input.state, projection: withoutWork },
  ] },
  { id: "compare", title: "D · History COMPARE", steps: [
    { label: "Historical context", state: history.input.state, projection: focus(history.input.state, object("emancipation", "proclamation"), "REFRAME_ATTENTION") },
    { ...step("Co-primary interpretations and source slots", history), note: "The approved fixture supplies source identities, not primary-source text. Slots remain explicit; no quotations are invented." },
  ] },
  { id: "widen", title: "E · Group 2 / Periodicity WIDEN", steps: [
    { label: "Group 2 local attention", state: widen.input.state, projection: focus(widen.input.state, object("group2", "reactivity"), "REFRAME_ATTENTION") },
    step("Reconnect selected trends", widen),
  ] },
  { id: "tangent", title: "H · Preserve during a tangent", steps: [
    { ...step("Establish equilibrium view", tangent), projection: { ...tangent.expected, projector: "REFRAME_ATTENTION" } },
    step("Tangent · preserve view", tangent), step("Tangent continues · no camera command", tangent),
  ] },
  { id: "support", title: "Support visibility & history", steps: [
    step("Relevant practical Support", support), { label: "Support leaves attention", state: support.input.state, projection: supportHidden },
    { label: "Kinetics is parked; inspect its retained Support", state: supportParked,
      projection: focus(supportParked, object("arrhenius", "rate"), "REFRAME_ATTENTION"),
      note: "Inspect kinetics restores its historical Support and frames the same rendered elements. Teaching stays on Arrhenius." },
  ] },
  { id: "long-revision", title: "Long revision & local scroll", steps: [
    growth[0]!,
    { label: "Long revision keeps the established rectangle", state: longRevision,
      projection: focus(longRevision, object("catalysts", "catalyst"), "PRESERVE_VIEW"),
      note: "Scroll inside the revised object. Its identity, reserved rectangle and the shared camera stay fixed." },
  ] },
];
