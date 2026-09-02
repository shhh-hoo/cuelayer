import { useReducer, useState } from "react";
import type { PresentationMode } from "../session/presentation-mode";
import type { TeachingCueDraft } from "./contracts";
import { TeachingCueLayer } from "./TeachingCueLayer";
import { createInitialTeachingCueState, teachingCueReducer } from "./runtime";
import "./teaching-cue-demo.css";

type DemoScenario = {
  id: string;
  label: string;
  cue: TeachingCueDraft;
  boardLead: string;
  boardRelation: string;
  boardContext: string;
};

const SCENARIOS: DemoScenario[] = [
  {
    id: "question",
    label: "Question",
    cue: { id: "demo-question", kind: "QUESTION", text: "Why does the reaction rate increase?", sourceSegmentIds: ["demo-speech-question"] },
    boardLead: "Temperature increases.",
    boardRelation: "molecules with E ≥ Eₐ ↑  →  successful collisions ↑",
    boardContext: "Eₐ remains unchanged.",
  },
  {
    id: "task",
    label: "Task",
    cue: { id: "demo-task", kind: "TASK", text: "Compare the two mechanisms. Decide which pathway is faster.", sourceSegmentIds: ["demo-speech-task"] },
    boardLead: "Two pathways. Same starting material.",
    boardRelation: "Pathway A  ↔  Pathway B",
    boardContext: "The board can keep changing while the task remains visible.",
  },
  {
    id: "note",
    label: "Take note",
    cue: { id: "demo-note", kind: "NOTE", text: "Take note of this relationship.", sourceSegmentIds: ["demo-speech-note"] },
    boardLead: "Temperature ↑",
    boardRelation: "E ≥ Eₐ molecules ↑  →  successful collisions ↑",
    boardContext: "The structure stays after the transient note cue fades.",
  },
  {
    id: "hint",
    label: "Teacher hint",
    cue: { id: "demo-hint", kind: "HINT", text: "Think about what changes — and what stays unchanged.", sourceSegmentIds: ["demo-speech-hint"] },
    boardLead: "Temperature ↑",
    boardRelation: "energy distribution changes  ·  Eₐ unchanged",
    boardContext: "This hint is teacher-grounded; CueLayer does not invent the answer.",
  },
];

function stateFor(cue: TeachingCueDraft) {
  return teachingCueReducer(createInitialTeachingCueState(), { type: "set", cue, now: Date.now() });
}

export function TeachingCueDemoPage() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]!.id);
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
        <span className="teaching-cue-demo-eyebrow">CueLayer · Teaching Cue</span>
        <h1>Teaching Cue is a sibling of the board.</h1>
        <p>The board preserves teaching content. Teaching Cue independently preserves the unresolved classroom question, task, note reminder, or teacher-provided hint.</p>
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
        <span>Collision theory</span>
        <strong>How temperature changes reaction rate</strong>
        <p>Use the particle energy distribution to explain the observed change.</p>
      </div> : null}
      <div className="teaching-cue-demo-board">
        <span className="teaching-cue-demo-board-label">Teaching board</span>
        <strong>{scenario.boardLead}</strong>
        <p className="teaching-cue-demo-relation">{scenario.boardRelation}</p>
        <p className="teaching-cue-demo-context">{scenario.boardContext}</p>
      </div>
      <TeachingCueLayer cue={cueState.active} presentationMode={presentationMode} onExpire={(cueId, now) => dispatchCue({ type: "expire", cueId, now })} />
    </section>

    <section className="teaching-cue-demo-principles">
      <article><strong>Independent lifecycle</strong><p>Board updates do not automatically remove an active Question or Task.</p></article>
      <article><strong>One active cue</strong><p>Alpha keeps one learner-facing cue at a time; a newer actionable cue replaces the older one.</p></article>
      <article><strong>Teacher-grounded</strong><p>Question, Task and Hint preserve what the teacher actually established rather than inventing new pedagogy.</p></article>
      <article><strong>Transient Note</strong><p>Take-note reminders disappear; the useful teaching structure can remain on the board.</p></article>
    </section>
  </main>;
}
