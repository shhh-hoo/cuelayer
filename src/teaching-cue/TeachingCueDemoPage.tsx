import { useReducer, useState } from "react";
import type { PresentationMode } from "../session/presentation-mode";
import { BoardLayout } from "./BoardLayout";
import type { ActiveTeachingCue, TeachingCueDraft } from "./contracts";
import { NotationRenderer, type EquationNotationSpec, type ReactionNotationSpec } from "./NotationRenderer";
import { createInitialTeachingCueState, teachingCueReducer } from "./runtime";
import "./teaching-cue-demo.css";

type BoardKind = "definition" | "cause" | "equation" | "reaction";

type DemoScenario = {
  id: BoardKind;
  label: string;
  cue: TeachingCueDraft;
};

const SCENARIOS: DemoScenario[] = [
  {
    id: "definition",
    label: "Definition",
    cue: { id: "demo-question", kind: "QUESTION", text: "What makes a collision successful?", sourceSegmentIds: ["demo-speech-definition"] },
  },
  {
    id: "cause",
    label: "Causal structure",
    cue: { id: "demo-note", kind: "NOTE", text: "Take note of this relationship.", sourceSegmentIds: ["demo-speech-cause"] },
  },
  {
    id: "equation",
    label: "Equation",
    cue: { id: "demo-task", kind: "TASK", text: "Rearrange the rate equation to make k the subject.", sourceSegmentIds: ["demo-speech-equation"] },
  },
  {
    id: "reaction",
    label: "Reaction",
    cue: { id: "demo-hint", kind: "HINT", text: "Focus on what happens to the carbon–carbon double bond.", sourceSegmentIds: ["demo-speech-reaction"] },
  },
];

const RATE_EQUATION: EquationNotationSpec = {
  kind: "equation",
  ariaLabel: "rate equals k times concentration of A squared",
  pieces: [
    { kind: "symbol", value: "rate", roman: true },
    { kind: "operator", value: "=" },
    { kind: "symbol", value: "k" },
    { kind: "symbol", value: "[A]", power: 2 },
  ],
};

const STRESS_RATE_EQUATION: EquationNotationSpec = {
  kind: "equation",
  ariaLabel: "rate equals k times concentrations of A, B, C and D raised to several powers",
  pieces: [
    { kind: "symbol", value: "rate", roman: true },
    { kind: "operator", value: "=" },
    { kind: "symbol", value: "k" },
    { kind: "symbol", value: "[A]", power: 2 },
    { kind: "symbol", value: "[B]", power: 3 },
    { kind: "symbol", value: "[C]", power: 2 },
    { kind: "symbol", value: "[D]" },
  ],
};

const ORDER_TERM: EquationNotationSpec = {
  kind: "equation",
  ariaLabel: "concentration of A squared",
  pieces: [{ kind: "symbol", value: "[A]", power: 2 }],
};

const BROMINATION: ReactionNotationSpec = {
  kind: "reaction",
  ariaLabel: "ethene plus bromine forms 1,2-dibromoethane",
  reactants: [{ formula: "CH2=CH2" }, { formula: "Br2" }],
  products: [{ formula: "CH2Br-CH2Br" }],
};

const STRESS_REACTION: ReactionNotationSpec = {
  kind: "reaction",
  ariaLabel: "a deliberately crowded reversible reaction used to test fitting",
  reactants: [
    { formula: "CH3CH2OH", state: "l" },
    { formula: "CH3COOH", state: "aq" },
    { formula: "H+", state: "aq" },
  ],
  products: [
    { formula: "CH3COOCH2CH3", state: "l" },
    { formula: "H2O", state: "l" },
  ],
  arrow: "equilibrium",
};

function stateFor(cue: TeachingCueDraft) {
  return teachingCueReducer(createInitialTeachingCueState(), { type: "set", cue, now: Date.now() });
}

function DefinitionActive() {
  return <div className="definition-object">
    <span className="definition-term">Activation energy</span>
    <span className="definition-equals">=</span>
    <span className="definition-meaning">minimum energy required</span>
  </div>;
}

function CauseActive() {
  return <div className="causal-chain" aria-label="Temperature increases, increasing particles above activation energy, increasing successful collisions">
    <span>Temperature ↑</span>
    <i>↓</i>
    <span>particles with E ≥ Eₐ ↑</span>
    <i>↓</i>
    <span>successful collisions ↑</span>
  </div>;
}

function EquationActive({ stress }: { stress: boolean }) {
  return <div className="equation-object"><NotationRenderer spec={stress ? STRESS_RATE_EQUATION : RATE_EQUATION} /></div>;
}

function ReactionActive({ stress }: { stress: boolean }) {
  return <div className="reaction-object"><NotationRenderer spec={stress ? STRESS_REACTION : BROMINATION} /></div>;
}

function stressCue(cue: ActiveTeachingCue | undefined, stress: boolean) {
  if (!cue || !stress) return cue;
  if (cue.kind === "TASK") return { ...cue, text: "Compare the two mechanisms, keep track of the relevant rate terms, and decide which pathway is faster. Which evidence on the board supports your choice?" };
  if (cue.kind === "QUESTION") return { ...cue, text: "What makes a collision successful, and which part of the current explanation gives you enough evidence to justify that answer?" };
  if (cue.kind === "HINT") return { ...cue, text: "Focus on the bond or term that actually changes, while keeping the unchanged context in view only if it still helps you reason." };
  return { ...cue, text: "Take note of the relationship that is being established, not every word that was spoken around it." };
}

function BoardScene({ kind, cue, presentationMode, stress, onCueExpire }: {
  kind: BoardKind;
  cue: ReturnType<typeof stateFor>["active"];
  presentationMode: PresentationMode;
  stress: boolean;
  onCueExpire(cueId: string, now: number): void;
}) {
  const displayedCue = stressCue(cue, stress);
  const retained = stress
    ? [<span key="one">previous definition still relevant</span>, <span key="two">unchanged condition retained</span>, <span key="three">earlier relationship kept only while useful</span>]
    : undefined;

  if (kind === "definition") return <BoardLayout
    presentationMode={presentationMode}
    cue={displayedCue}
    onCueExpire={onCueExpire}
    retained={retained ?? [<span key="collision">successful collision</span>]}
    active={<DefinitionActive />}
    support={<span>{stress ? "for particles to collide with enough energy and the correct orientation under the current conditions" : "for particles to collide successfully"}</span>}
  />;

  if (kind === "cause") return <BoardLayout
    presentationMode={presentationMode}
    cue={displayedCue}
    onCueExpire={onCueExpire}
    retained={retained ?? [<span key="ea">Eₐ unchanged</span>]}
    active={<CauseActive />}
    support={<span>{stress ? "the explanation should preserve the causal chain without turning every sentence into a separate board item" : "more particles can react when they collide"}</span>}
  />;

  if (kind === "equation") return <BoardLayout
    presentationMode={presentationMode}
    cue={displayedCue}
    onCueExpire={onCueExpire}
    retained={retained ?? [<span key="rate">rate depends on concentration</span>]}
    active={<EquationActive stress={stress} />}
    support={<div className="equation-support"><NotationRenderer displayMode={false} spec={ORDER_TERM} /><b>{stress ? "retain the order annotation only while it helps the rearrangement" : "second order in A"}</b></div>}
  />;

  return <BoardLayout
    presentationMode={presentationMode}
    cue={displayedCue}
    onCueExpire={onCueExpire}
    retained={retained ?? [<span key="pi">π bond present</span>]}
    active={<ReactionActive stress={stress} />}
    support={<span>{stress ? "the reaction renderer must fit or fall back legibly; it must never silently crop the product side" : "the C=C bond is the changing part"}</span>}
  />;
}

export function TeachingCueDemoPage() {
  const [scenarioId, setScenarioId] = useState<BoardKind>(SCENARIOS[0]!.id);
  const [presentationMode, setPresentationMode] = useState<PresentationMode>("presentationless");
  const [stress, setStress] = useState(false);
  const [cueState, dispatchCue] = useReducer(teachingCueReducer, SCENARIOS[0]!.cue, stateFor);
  const scenario = SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0]!;

  const choose = (next: DemoScenario) => {
    setScenarioId(next.id);
    dispatchCue({ type: "set", cue: { ...next.cue, id: `${next.cue.id}-${Date.now()}` }, now: Date.now() });
  };

  const restore = () => dispatchCue({ type: "set", cue: { ...scenario.cue, id: `${scenario.cue.id}-${Date.now()}` }, now: Date.now() });
  const expireCue = (cueId: string, now: number) => dispatchCue({ type: "expire", cueId, now });

  return <main className="teaching-cue-demo-shell">
    <header className="teaching-cue-demo-header">
      <div>
        <span className="teaching-cue-demo-eyebrow">CueLayer · learner surface study</span>
        <h1>Meaning sets the hierarchy.</h1>
        <p>The board allocates space before rendering. Retained context yields first, Support yields next, and Active keeps the readability budget. Equation and reaction notation now comes from a bounded structured contract rather than free-form TeX.</p>
      </div>
      <a href="/session" className="teaching-cue-demo-back">Live session</a>
    </header>

    <section className="teaching-cue-demo-toolbar" aria-label="Teaching Cue demo controls">
      <div className="teaching-cue-demo-scenarios">
        {SCENARIOS.map((item) => <button type="button" className={item.id === scenario.id ? "selected" : ""} key={item.id} onClick={() => choose(item)}>{item.label}</button>)}
      </div>
      <div className="teaching-cue-demo-actions">
        <button type="button" className={stress ? "selected" : ""} aria-pressed={stress} onClick={() => setStress((value) => !value)}>{stress ? "Stress on" : "Stress layout"}</button>
        <button type="button" onClick={() => setPresentationMode((mode) => mode === "presentationless" ? "presentation-overlay" : "presentationless")}>{presentationMode === "presentationless" ? "Presentationless" : "Presentation overlay"}</button>
        <button type="button" onClick={() => cueState.active ? dispatchCue({ type: "resolve", cueId: cueState.active.id }) : restore()}>{cueState.active ? "Resolve cue" : "Restore cue"}</button>
      </div>
    </section>

    <section className={`teaching-cue-demo-stage ${presentationMode}`} aria-label="Teaching Cue stage demo">
      {presentationMode === "presentation-overlay" ? <div className="teaching-cue-demo-slide">
        <div className="slide-figure" aria-hidden="true"><span /><span /><span /></div>
        <p>Existing presentation remains the primary canvas. CueLayer uses separate lower safe regions for the current board object and Teaching Cue.</p>
      </div> : null}
      <BoardScene kind={scenario.id} cue={cueState.active} presentationMode={presentationMode} stress={stress} onCueExpire={expireCue} />
    </section>

    <section className="teaching-cue-demo-principles">
      <article><strong>Real yield order</strong><p>Measured height drives Full → Compact → Essential density. Retained disappears before Support.</p></article>
      <article><strong>No silent crop</strong><p>Wide notation scales only to a readability floor; below it, the renderer falls back to wrapped plain text.</p></article>
      <article><strong>Structured notation</strong><p>Equation pieces and reaction species compile deterministically to KaTeX/mhchem. Free TeX is not a planner contract.</p></article>
      <article><strong>One cue, one task</strong><p>An instruction that contains a question remains one TASK cue instead of becoming two competing learner prompts.</p></article>
    </section>
  </main>;
}
