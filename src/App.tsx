import { useMemo, useState } from "react";
import { fxExamples } from "./examples";
import { FxStage } from "./FxStage";

export default function App() {
  const [selectedId, setSelectedId] = useState(fxExamples[0].id);
  const [replayKey, setReplayKey] = useState(0);

  const selected = useMemo(
    () => fxExamples.find((example) => example.id === selectedId) ?? fxExamples[0],
    [selectedId],
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">CueLayer / Phase 1</div>
          <h1>Teaching Caption FX Lab</h1>
        </div>
        <div className="status-chip">Authoring lab · not product UI</div>
      </header>

      <section className="lab-grid">
        <aside className="operation-list" aria-label="Motion operations">
          <div className="panel-label">Motion grammar</div>
          {fxExamples.map((example) => (
            <button
              className={`operation-button ${selected.id === example.id ? "active" : ""}`}
              key={example.id}
              onClick={() => {
                setSelectedId(example.id);
                setReplayKey((value) => value + 1);
              }}
              type="button"
            >
              <span>{example.operation}</span>
              <small>{example.title}</small>
            </button>
          ))}
        </aside>

        <section className="preview-panel">
          <div className="preview-meta">
            <div>
              <div className="operation-kicker">{selected.operation}</div>
              <h2>{selected.title}</h2>
              <p>{selected.purpose}</p>
            </div>
            <button
              className="replay-button"
              type="button"
              onClick={() => setReplayKey((value) => value + 1)}
            >
              Replay effect
            </button>
          </div>

          <FxStage example={selected} replayKey={replayKey} />

          <div className="source-strip">
            <span>Teacher line</span>
            <p>“{selected.teacherLine}”</p>
          </div>
        </section>

        <aside className="plan-panel">
          <div className="panel-label">Effect plan</div>
          <dl>
            <div>
              <dt>Operation</dt>
              <dd>{selected.plan.operation}</dd>
            </div>
            <div>
              <dt>Targets</dt>
              <dd>{selected.plan.targets.join(" · ")}</dd>
            </div>
            {selected.plan.relation ? (
              <div>
                <dt>Relation</dt>
                <dd>{selected.plan.relation}</dd>
              </div>
            ) : null}
            <div>
              <dt>Intensity</dt>
              <dd>{selected.plan.intensity}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{selected.plan.durationMs} ms</dd>
            </div>
          </dl>
          <div className="lab-note">
            The future AI planner selects this semantic plan. It does not generate CSS, layout code or arbitrary animation.
          </div>
        </aside>
      </section>
    </main>
  );
}
