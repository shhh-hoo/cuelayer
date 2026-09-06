import { applyOperation, type CoreNode, type CoreRelation, type Lesson, type Operation } from "./model";

const text = (id: string, value: string): CoreNode => ({ id, content: { kind: "text", text: value } });
const branch = (source: string, target: string): CoreRelation => ({ id: `${source}-${target}`, source, target, kind: "branch" });
type Step = { label: string; holdMs: number; operation: Operation };
export const STEPS: Step[] = [
  { label: "A Core begins", holdMs: 3000, operation: { kind: "begin", core: { id: "catalyst", nodes: [text("catalysts", "Catalysts")], relations: [] } } },
  { label: "Reaction rate", holdMs: 3000, operation: { kind: "grow", coreId: "catalyst", nodes: [text("rate", "increase reaction rate")], relations: [branch("catalysts", "rate")] } },
  { label: "An alternative pathway", holdMs: 3000, operation: { kind: "grow", coreId: "catalyst", nodes: [text("pathway", "alternative pathway")], relations: [branch("catalysts", "pathway")] } },
  { label: "Lower activation energy", holdMs: 3000, operation: { kind: "grow", coreId: "catalyst", nodes: [text("energy", "lower Ea")], relations: [branch("pathway", "energy")] } },
  { label: "Refine the same node", holdMs: 3000, operation: { kind: "revise", coreId: "catalyst", nodeId: "energy", content: { kind: "text", text: "lower activation energy (Ea)" } } },
  { label: "Classification grows here", holdMs: 3000, operation: { kind: "grow", coreId: "catalyst", nodes: [text("homogeneous", "Homogeneous"), text("same-phase", "same phase")], relations: [branch("catalysts", "homogeneous"), branch("homogeneous", "same-phase")] } },
  { label: "Both definitions stay in the Core", holdMs: 3000, operation: { kind: "grow", coreId: "catalyst", nodes: [text("heterogeneous", "Heterogeneous"), text("different-phases", "different phases")], relations: [branch("catalysts", "heterogeneous"), branch("heterogeneous", "different-phases"), { id: "phase-contrast", source: "same-phase", target: "different-phases", kind: "contrast" }] } },
  { label: "An example beside the Core", holdMs: 5000, operation: { kind: "support", support: { id: "converter", coreId: "catalyst", text: "Catalytic converters are an example of heterogeneous catalysis." } } },
  { label: "Another extra; the Core holds", holdMs: 5000, operation: { kind: "support", support: { id: "enzymes", coreId: "catalyst", text: "Enzymes catalyse reactions in living cells." } } },
  { label: "A new teaching mainline", holdMs: 5000, operation: { kind: "begin", core: { id: "arrhenius", nodes: [text("arrhenius", "Arrhenius equation")], relations: [] } } },
  { label: "The equation joins its Core", holdMs: 3000, operation: { kind: "grow", coreId: "arrhenius", nodes: [{ id: "equation", content: { kind: "math", tex: "k = Ae^{-E_a/RT}", label: "k equals A times e to the power minus Ea over RT" } }], relations: [branch("arrhenius", "equation")] } },
];

export type Playback = { lesson: Lesson; index: number; playing: boolean; resetKey: number };
export type PlaybackAction = { type: "tick" | "next" | "toggle" | "reset" };
export function initialPlayback(): Playback {
  return { lesson: applyOperation({ cores: [], supports: [], currentCoreId: "" }, STEPS[0]!.operation), index: 0, playing: true, resetKey: 0 };
}
export function playbackReducer(state: Playback, action: PlaybackAction): Playback {
  if (action.type === "reset") return { ...initialPlayback(), playing: false, resetKey: state.resetKey + 1 };
  if (action.type === "toggle") return { ...state, playing: state.index < STEPS.length - 1 && !state.playing };
  if (action.type === "tick" && !state.playing) return state;
  const next = STEPS[state.index + 1];
  if (!next) return state;
  return { ...state, index: state.index + 1, lesson: applyOperation(state.lesson, next.operation), playing: action.type === "tick" && state.index + 1 < STEPS.length - 1 };
}
