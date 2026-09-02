import { useReducer, useState } from "react";
import type { PresentationMode } from "../session/presentation-mode";
import { BoardLayout } from "./BoardLayout";
import type { TeachingCueDraft } from "./contracts";
import { NotationRenderer } from "./NotationRenderer";
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

function EquationActive() {
  return <div className="equation-object">
    <NotationRenderer spec={{ kind: "equation", source: "\\mathrm{rate}=k[A]^2", ariaLabel: "rate equals k times concentration of A squared" }} />
  </div>;
}

function ReactionActive() {
  return <div className="reaction-object">
    <NotationRenderer spec={{ kind: "reaction", source: "CH2=CH2 + Br2 -> CH2Br-CH2Br", ariaLabel: "ethene plus bromine forms 1,2-dibromoethane" }} />
  </div>;
}

function BoardScene({ kind, cue, presentationMode, onCueExpire }: {
  kind: BoardKind;
  cue: ReturnType<typeof stateFor>["active"];
  presentationMode: PresentationMode;
  onCueExpire(cueId: string, now: number): void;
}) {
  if (kind === "definition") return <BoardLayout
    presentationMode={presentationMode}
    cue={cue}
    onCueExpire={onCueExpire}
    retained={[<span key="collision">successful collision</span>]}
    active={<DefinitionActive />}
    support={<span>for particles to collide successfully</span>}
  />;

  if (kind === "cause") return <BoardLayout
    presentationMode={presentationMode}
    cue={cue}
    onCueExpire={onCueExpire}
    retained={[<span key="ea">Eₐ unchanged</span>]}
    active={<CauseActive />}
    support={<span>more particles can react when they collide</span>}
  />;

  if (kind === "equation") return <BoardLayout
    presentationMode={presentationMode}
    cue={cue}
    onCueExpire={onCueExpire}
    retained={[<span key="rate">rate depends on concentration</span>]}
    active={<EquationActive />}
    support={<div className="equation-support"><NotationRenderer displayMode={false} spec={{ kind: "equation", source: "[A]^2", ariaLabel: "concentration of A squared" }} /><b>second order in A</b></div>}
  />;

  return <BoardLayout
    presentationMode={presentationMode}
    cue={cue}
    onCueExpire={onCueExpire}
    retained={[<span key="pi">π bond present</span>]}
    active={<ReactionActive />}
    support={<span>the C=C bond is the changing part</span>}
  />;
}

export function TeachingCueDemoPage() {
  const [scenarioId, setScenarioId] = useState<BoardKind>(SCENARIOS[0]!.id);
  const [presentationMode, setPresentationMode] = useState<PresentationMode>("presentationless");
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
        <p>The board now allocates space before rendering: Active, Support and Retained occupy bounded regions, while Teaching Cue owns a separate safe area. Equations and reactions render as notation objects rather than hand-spaced text.</p>
      </div>
      <a href="/session" className="teaching-cue-demo-back">Live session</a>
    </header>

    <section className="teaching-cue-demo-toolbar" aria-label="Teaching Cue demo controls">
      <div className="teaching-cue-demo-scenarios">
        {SCENARIOS.map((item) => <button type="button" className={item.id === scenario.id ? "selected" : ""} key={item.id} onClick={() => choose(item)}>{item.label}</button>)}
      </div>
      <div className="teaching-cue-demo-actions">
        <button type="button" onClick={() => setPresentationMode((mode) => mode === "presentationless" ? "presentation-overlay" : "presentationless")}>{presentationMode === "presentationless" ? "Presentationless" : "Presentation overlay"}</button>
        <button type="button" onClick={() => cueState.active ? dispatchCue({ type: "resolve", cueId: cueState.active.id }) : restore()}>{cueState.active ? "Resolve cue" : "Restore cue"}</button>
      </div>
    </section>

    <section className={`teaching-cue-demo-stage ${presentationMode}`} aria-label="Teaching Cue stage demo">
      {presentationMode === "presentation-overlay" ? <div className="teaching-cue-demo-slide">
        <div className="slide-figure" aria-hidden="true"><span /><span /><span /></div>
        <p>Existing presentation remains the primary canvas. CueLayer uses separate lower safe regions for the current board object and Teaching Cue.</p>
      </div> : null}
      <BoardScene kind={scenario.id} cue={cueState.active} presentationMode={presentationMode} onCueExpire={expireCue} />
    </section>

    <section className="teaching-cue-demo-principles">
      <article><strong>Safe regions</strong><p>Teaching Cue occupies layout space. Active content can no longer extend underneath it.</p></article>
      <article><strong>Yield order</strong><p>Retained context is lowest priority; Active remains readable instead of shrinking everything equally.</p></article>
      <article><strong>Notation</strong><p>Equation uses TeX and reaction uses mhchem syntax through one bounded renderer with plain-text fallback.</p></article>
      <article><strong>Independent state</strong><p>Question, Task, Note and teacher-given Hint keep their own lifecycle without becoming board content.</p></article>
    </section>
  </main>;
}
