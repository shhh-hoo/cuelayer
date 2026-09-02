import { useReducer, useState } from "react";
import type { PresentationMode } from "../session/presentation-mode";
import type { TeachingCueDraft } from "./contracts";
import { TeachingCueLayer } from "./TeachingCueLayer";
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

function DefinitionBoard() {
  return <div className="board-scene definition-scene">
    <div className="board-retained">successful collision</div>
    <div className="definition-object board-active">
      <span className="definition-term">Activation energy</span>
      <span className="definition-equals">=</span>
      <span className="definition-meaning">minimum energy required</span>
    </div>
    <div className="board-support definition-support">for particles to collide successfully</div>
  </div>;
}

function CauseBoard() {
  return <div className="board-scene cause-scene">
    <div className="board-retained retained-fact">Eₐ unchanged</div>
    <div className="causal-chain board-active" aria-label="Temperature increases, increasing particles above activation energy, increasing successful collisions">
      <span>Temperature ↑</span>
      <i>↓</i>
      <span>particles with E ≥ Eₐ ↑</span>
      <i>↓</i>
      <span>successful collisions ↑</span>
    </div>
    <div className="board-support cause-support">more particles can react when they collide</div>
  </div>;
}

function EquationBoard() {
  return <div className="board-scene equation-scene">
    <div className="board-retained">rate depends on concentration</div>
    <div className="equation-object board-active">
      <span>rate</span>
      <span>=</span>
      <span>k[A]<sup>2</sup></span>
    </div>
    <div className="board-support equation-support"><span>[A]<sup>2</sup></span><b>second order in A</b></div>
  </div>;
}

function ReactionBoard() {
  return <div className="board-scene reaction-scene">
    <div className="board-retained">π bond present</div>
    <div className="reaction-object board-active">
      <span className="reaction-species reaction-focus">CH₂=CH₂</span>
      <span className="reaction-plus">+</span>
      <span className="reaction-species">Br₂</span>
      <span className="reaction-arrow">→</span>
      <span className="reaction-species">CH₂Br–CH₂Br</span>
    </div>
    <div className="board-support reaction-support">the C=C bond is the changing part</div>
  </div>;
}

function BoardScene({ kind }: { kind: BoardKind }) {
  if (kind === "definition") return <DefinitionBoard />;
  if (kind === "cause") return <CauseBoard />;
  if (kind === "equation") return <EquationBoard />;
  return <ReactionBoard />;
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

  return <main className="teaching-cue-demo-shell">
    <header className="teaching-cue-demo-header">
      <div>
        <span className="teaching-cue-demo-eyebrow">CueLayer · learner surface study</span>
        <h1>Meaning sets the hierarchy.</h1>
        <p>The board has no default title/body template. The active teaching object dominates; attached meaning supports it; only still-useful context is retained. Teaching Cue remains an independent classroom-task layer.</p>
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
        <p>Existing presentation remains the primary canvas. CueLayer borrows only enough space for the current semantic object and Teaching Cue.</p>
      </div> : null}
      <div className="teaching-cue-demo-board">
        <BoardScene kind={scenario.id} />
      </div>
      <TeachingCueLayer cue={cueState.active} presentationMode={presentationMode} onExpire={(cueId, now) => dispatchCue({ type: "expire", cueId, now })} />
    </section>

    <section className="teaching-cue-demo-principles">
      <article><strong>Active</strong><p>The concept, relation, equation or reaction currently being established is the visual centre.</p></article>
      <article><strong>Support</strong><p>Conditions and explanations attach to the active object instead of becoming generic body copy.</p></article>
      <article><strong>Retained</strong><p>Only context still needed for the current reasoning remains visible, with deliberately lower weight.</p></article>
      <article><strong>Teaching Cue</strong><p>Question, Task, Note and teacher-given Hint keep their own lifecycle and never become board content.</p></article>
    </section>
  </main>;
}
