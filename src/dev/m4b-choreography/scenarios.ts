import type { CoreStep, CoreTeachingState, KnowledgeOperation, Provenance, SemanticReference } from "../../lesson-stream/core/contracts.ts";
import { coreEntityId } from "../../lesson-stream/core/events.ts";
import { reduceCoreStep } from "../../lesson-stream/core/teaching-state.ts";
import type { LearnerProjection } from "../../learner-projection/contracts.ts";
import { SCENARIOS, fixture, type ScenarioStep } from "../m4b-canvas/scenarios.ts";

export type ChoreographyStep = ScenarioStep & { home?: boolean };
export type ChoreographyScenario = { id: string; title: string; source: string; steps: ChoreographyStep[] };

const copy = <T,>(value: T): T => structuredClone(value);
const object = (coreId: string, id: string): SemanticReference => ({ kind: "OBJECT", coreId, id });
const existing = (id: string) => copy(SCENARIOS.find(scenario => scenario.id === id)!.steps);
const parked = (state: CoreTeachingState) => Object.keys(state.knowledge.cores).filter(id => id !== state.knowledge.currentCoreId);
const focus = (state: CoreTeachingState, anchor: SemanticReference): LearnerProjection => ({
  attention: { anchor, emphasis: [], context: [], support: [], representations: [] },
  transition: { knowledge: "PRESERVE", framing: "FOCUS", representation: "KEEP" },
  projector: "REFRAME_ATTENTION", parkedCoreIds: parked(state),
});

/** Isolated, explicitly synthetic teaching evidence exercises the existing
 * acceptance reducer. These snapshots are not persisted events or real speech.
 * No spatial fields enter the Core step, accepted state or M4A projection.
 */
function acceptSynthetic(
  state: CoreTeachingState, name: string, quote: string,
  operations: (step: CoreStep, provenance: Provenance) => KnowledgeOperation[],
) {
  const checkpointId = `m4b:choreography:${name}`;
  const provenance: Provenance = { speechRefs: [{ checkpointId, quote }], stateRefs: [] };
  const step: CoreStep = {
    requestId: checkpointId, stepIndex: 0,
    baseKnowledgeRevision: state.knowledge.revision, baseCueRevision: state.cue.revision,
    consumesCheckpointIds: [checkpointId], knowledgeOps: [], cueDelta: { action: "KEEP" },
    evidenceRefs: [{ checkpointId, quote }], stateRefs: [], warnings: [],
    acceptedAt: "2026-09-09T08:00:00.000Z",
  };
  step.knowledgeOps = operations(step, provenance);
  return reduceCoreStep(state, step, [{ checkpointId, lessonSequence: state.processedThroughSequence + 1,
    speechRunId: "m4b:choreography:synthetic", startMs: 0, endMs: 1, text: quote, sourceFinalIds: [], warnings: [] }]);
}

const shared = existing("shared-inspection");
const catalystHome = copy(shared[2]!);
const equation = copy(shared[4]!.state);
const rateText = "For fixed A and temperature, lower Eₐ gives a larger rate constant, k.";
let rateId = "";
const rate = acceptSynthetic(equation, "lower-barrier-rate", rateText, (step, provenance) => {
  rateId = coreEntityId(equation.sessionId, step, "OBJECT", 0);
  return [{ action: "ADD_OBJECT", coreId: "arrhenius", id: rateId, value: { text: rateText, provenance } }];
});
const rateRef = object("arrhenius", rateId);
const lowerEaRef = object("catalysts", "lower-ea");
const widen = (state: CoreTeachingState): LearnerProjection => ({
  ...focus(state, rateRef),
  attention: { anchor: rateRef, emphasis: [], context: [lowerEaRef], support: [], representations: [] },
  transition: { knowledge: "PRESERVE", framing: "WIDEN", representation: "KEEP" },
});
const rateExpandedText = "For fixed A and temperature, lower Eₐ gives a larger rate constant, k. The exponential factor becomes larger.";
const rateExpanded = acceptSynthetic(rate, "rate-explanation", rateExpandedText, (_step, provenance) => [
  { action: "REVISE_OBJECT", coreId: "arrhenius", id: rateId, value: { text: rateExpandedText, provenance } },
]);
const refocused = acceptSynthetic(rateExpanded, "accepted-catalyst-refocus", "Let's return to the catalyst explanation.", () => [
  { action: "SET_CURRENT_CORE", coreId: "catalysts" },
]);

const story: ChoreographyStep[] = [
  { ...copy(shared[0]!), home: true, label: "HOME · Catalyst begins" },
  copy(shared[1]!), copy(shared[2]!),
  { ...catalystHome, home: true, label: "HOME · Catalyst Option 2", note: "Persistent home geography; the full accepted Catalyst propositions remain available." },
  copy(shared[3]!), copy(shared[4]!),
  { label: "FOCUS · Lower barrier and rate", state: rate, projection: { ...focus(rate, rateRef), transition: { knowledge: "ADVANCE", framing: "FOCUS", representation: "KEEP" } },
    recentChanges: [{ ref: rateRef, kind: "ADDED" }], note: "Dev-only synthetic accepted proposition. A and temperature are held fixed. FOCUS does not request temporary positions." },
  { label: "WIDEN · Two distant propositions", state: rate, projection: widen(rate),
    note: "Exact selection: Arrhenius rate implication plus Catalyst lower activation energy. Spatial adjacency does not create a cross-Core semantic relation." },
  { label: "PRESERVE_VIEW · Hold this composition", state: rate, projection: { ...widen(rate), projector: "PRESERVE_VIEW" },
    note: "Keep the visible presentation positions and camera; do not initiate another composition." },
  { label: "WIDEN · Teaching explanation progresses", state: rateExpanded,
    projection: { ...widen(rateExpanded), transition: { knowledge: "ADVANCE", framing: "WIDEN", representation: "KEEP" } },
    recentChanges: [{ ref: rateRef, kind: "REVISED" }],
    note: "Dev-only accepted revision. During teacher inspection, hold rendered positions; Follow teaching derives this newest accepted composition directly." },
  { label: "FOCUS · Return selected objects home", state: rateExpanded, projection: focus(rateExpanded, rateRef),
    note: "Clear temporary presentation positions. Both canonical objects return to their unchanged home anchors." },
  { label: "Accepted semantic refocus · Catalysts", state: refocused, projection: focus(refocused, object("catalysts", "catalyst")),
    recentChanges: [{ ref: { kind: "CORE", id: "catalysts" }, kind: "REFOCUSED" }],
    note: "The accepted reducer changes currentCoreId independently of spatial inspection or previous presentation movement." },
];

const trig = copy(fixture("math-trig-graph-comparison"));
const history = copy(fixture("history-contemporary-sources-competing-interpretations"));
const longText = "The alternative pathway has a lower activation energy. " +
  "A catalyst participates in intermediate steps and is regenerated overall; it does not change the equilibrium constant. ".repeat(5);
const longState = acceptSynthetic(rate, "long-lower-ea-revision", longText, (_step, provenance) => [
  { action: "REVISE_OBJECT", coreId: "catalysts", id: "lower-ea", value: { text: longText, provenance } },
]);

export const CHOREOGRAPHY_SCENARIOS: ChoreographyScenario[] = [
  { id: "teaching-story", title: "Catalyst → Arrhenius · teaching story",
    source: "Existing M4B Catalyst growth and synthetic Arrhenius snapshots. Rate implication, its revision and semantic refocus are new dev-only synthetic evidence accepted by the unchanged Core reducer.",
    steps: story },
  { id: "trig-compare", title: "COMPARE · real trigonometry fixture",
    source: "Unchanged math-trig-graph-comparison M4A fixture; three semantic targets, inline representation identity and transient Work. The fixture supplies no plot or Work payload.",
    steps: [
      { label: "HOME · Trigonometry", state: trig.input.state, projection: focus(trig.input.state, object("trig-graphs", "base-sine")), home: true },
      { label: "COMPARE · Base and transformed sine", state: trig.input.state, projection: trig.expected,
        note: "Full unchanged real selection: both co-primary targets, necessary equivalent-form context and existing transient Work. No invented graph payload." },
      { label: "FOCUS · Trigonometry returns home", state: trig.input.state, projection: focus(trig.input.state, object("trig-graphs", "base-sine")) },
    ] },
  { id: "history-compare", title: "COMPARE · full History pressure case",
    source: "Unchanged history-contemporary-sources-competing-interpretations M4A fixture. Five co-primary rendered identities plus Work; source quotations and Work content are not supplied.",
    steps: [
      { label: "HOME · Emancipation", state: history.input.state, projection: focus(history.input.state, object("emancipation", "proclamation")), home: true },
      { label: "COMPARE · Interpretations and both sources", state: history.input.state, projection: history.expected,
        note: "All five co-primary identities remain selected. Missing source payload stays explicit. Report inability to fit at the minimum font instead of omitting targets or inventing quotations." },
      { label: "FOCUS · History returns home", state: history.input.state, projection: focus(history.input.state, object("emancipation", "proclamation")) },
    ] },
  { id: "long-text", title: "Long text · measured composition pressure",
    source: "Dev-only synthetic long-text stress using the existing M4B repetition pattern. The unchanged Core reducer revises the same lower-ea object; M4A framing variants are isolated review inputs.",
    steps: [
      { label: "HOME · Before the long revision", state: rate, projection: focus(rate, rateRef), home: true },
      { label: "WIDEN · Before the long revision", state: rate, projection: widen(rate) },
      { label: "PRESERVE_VIEW · Long accepted text, positions held", state: longState,
        projection: { ...widen(longState), projector: "PRESERVE_VIEW", transition: { knowledge: "ADVANCE", framing: "WIDEN", representation: "KEEP" } },
        recentChanges: [{ ref: lowerEaRef, kind: "REVISED" }],
        note: "Measure expanded text but hold current positions/camera. Report any overlap or overflow until an allowed reframe; no internal scrollbar." },
      { label: "WIDEN · Recompose the measured long text", state: longState, projection: widen(longState),
        note: "Explicit dev-only REFRAME variant permits a new measured composition. Fixed viewport plus full text and minimum font may be infeasible; report that constraint failure." },
      { label: "FOCUS · Revised object returns home", state: longState, projection: focus(longState, lowerEaRef),
        note: "The revised object keeps its original identity and home anchor, even when its full measured text box expands." },
    ] },
  { id: "work", title: "Transient Work · appearance, settlement, removal",
    source: "Existing M4B lifecycle over unchanged cs-algorithm-code-dry-run fixture. Work status/removal are dev-only projection variants; code/table payload is not supplied.",
    steps: existing("work") },
  { id: "support", title: "Support · selected, omitted, inspected",
    source: "Existing M4B Support lifecycle over cambridge-kinetics-concept-graph-practical. Omission is visual; the original accepted Support remains in knowledge. Parked Arrhenius shift is an existing dev snapshot.",
    steps: existing("support") },
  { id: "group2-widen", title: "WIDEN · full Group 2 pressure case",
    source: "Existing unchanged rsc-group2-review-widen M4A fixture with one exact Periodicity context reference, selected Group 2 objects, representation identity and transient Work.",
    steps: existing("widen") },
];
