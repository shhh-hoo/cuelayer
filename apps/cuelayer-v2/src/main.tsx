import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Session } from "./session";
import { deterministicInterpreter, inject, story, delay } from "./story";
import { decide, Geography } from "./display";
import { Board, type CanvasHandle } from "./adapters/canvas";
import { TeachingCue } from "./adapters/cue";
import type { ProjectionIntent } from "./contract";
import "./style.css";

const params = new URLSearchParams(location.search);
const sessionId = params.get("session") ?? crypto.randomUUID();
if (!params.has("session")) {
  params.set("session", sessionId);
  history.replaceState(null, "", `${location.pathname}?${params}`);
}
const session = await Session.open(
  sessionId,
  deterministicInterpreter({
    live: Number(params.get("live") ?? 120),
    stage: Number(params.get("stage") ?? 1200),
  }),
);
const handle: CanvasHandle = {
  editor: null,
  geography: new Geography(),
  inspection: false,
  frame: null,
  follow: () => {},
};
let inputIndex = session.replay.evidence.length;
const api = {
  session,
  handle,
  story,
  inject: async (text: string) => inject(session, text, inputIndex++),
  step: async (index: number) => {
    await inject(session, story[index], inputIndex++);
    await session.drainLive();
    await session.trace.flush(session.store, session.id);
  },
  run: async (interval = 90) => {
    for (const text of story) {
      await api.inject(text);
      await delay(interval);
    }
    await session.drainLive();
    await session.trace.flush(session.store, session.id);
  },
  failRepresentation: (_value: boolean) => {},
  setMode: (_mode: ProjectionIntent["mode"]) => {},
  snapshot: () => ({
    state: session.state,
    window: session.window,
    replay: session.replay,
    spans: session.trace.spans,
    camera: handle.editor?.getCamera(),
    homes: [...handle.geography.homes],
    inspection: handle.inspection,
    frame: handle.frame,
  }),
};
declare global {
  interface Window {
    v2: typeof api;
  }
}
window.v2 = api;
function App() {
  const [tick, setTick] = useState(0),
    [running, setRunning] = useState(false),
    [failed, setFailed] = useState(false),
    [mode, setMode] = useState<ProjectionIntent["mode"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = session.state.revision;
  const state = useMemo(() => session.state, [revision]);
  useEffect(() => session.subscribe(() => setTick((t) => t + 1)), []);
  api.failRepresentation = setFailed;
  api.setMode = setMode;
  const intent = mode
    ? {
        targets:
          mode === "COMPARE"
            ? ["pressure", "fraction"]
            : (session.attention?.targets ?? []),
        mode,
        expiresAt: Infinity,
      }
    : session.attention;
  const intentKey = JSON.stringify(intent);
  const frame = useMemo(() => {
    const start = performance.now();
    const result = decide(state, intent);
    session.trace.mark(
      "representation-selection",
      { revision, forms: result.selected.map((c) => c.form) },
      start,
    );
    return result;
  }, [state, intentKey]);
  const overlay = params.get("mode") === "overlay",
    w = session.window;
  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await api.run();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };
  const exportSession = async () => {
    const blob = new Blob([await session.store.exportSession(sessionId)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cuelayer-v2-${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <main className={overlay ? "app overlay" : "app"}>
      <header>
        <div className="brand">
          cue<span>layer</span>
          <b>V2</b>
        </div>
        <div className="lesson-title">
          {state.cores[state.currentCoreId ?? ""]?.title ??
            "A place for the next idea"}
        </div>
        <button
          onClick={run}
          disabled={running || w.orderedCommittedEvidence.length > 0}
        >
          {running ? "Teaching…" : "Run teaching story"}
        </button>
      </header>
      {overlay ? (
        <section className="presentation" aria-label="Synthetic presentation">
          <small>LESSON 01</small>
          <h1>
            How does each gas
            <br />
            contribute to a mixture?
          </h1>
          <p>Partial pressure · mole fraction · equilibrium</p>
          <div className="presentation-line" />
        </section>
      ) : null}
      <section className="learner" aria-label="Learner surface">
        <div className="surface-label">
          <span>{overlay ? "Alongside the lesson" : "THE TEACHING BOARD"}</span>
          <span>
            {frame.mode === "COMPARE"
              ? "Compare the relationships"
              : frame.mode === "WIDEN"
                ? "Reconnect the structure"
                : "Follow the idea"}
          </span>
        </div>
        <Board
          state={state}
          frame={frame}
          trace={session.trace}
          fail={failed}
          handle={handle}
        />
        {!state.revision ? (
          <div className="empty">
            <div>
              Ideas become visible
              <br />
              as the teaching unfolds.
            </div>
            <p>Run the deterministic story to explore this rebuild.</p>
          </div>
        ) : null}
        {frame.cueVisible &&
        state.cue &&
        session.cuePresentation?.version === state.cueVersion &&
        session.cuePresentation.mainlineVersion === state.mainlineVersion ? (
          <TeachingCue text={state.cue.text} />
        ) : (
          <div className="cue-region quiet">
            <span>Room to think.</span>
          </div>
        )}
      </section>
      <footer>
        <span className="status-dot" />
        {running ? "Teaching continues" : "Deterministic teaching experiment"}
        <span>
          {w.consumedEvidenceIds.length} / {w.orderedCommittedEvidence.length}{" "}
          evidence accounted for
        </span>
        <details>
          <summary>Session details</summary>
          <div>
            <p>
              Live pending: {w.livePendingCount} · Unresolved:{" "}
              {Object.keys(w.unresolved).length} · Stage:{" "}
              {w.activeStage ? "reviewing" : "available"}
            </p>
            <button onClick={() => setMode("FOCUS")}>Focus</button>
            <button onClick={() => setMode("COMPARE")}>Compare</button>
            <button onClick={exportSession}>Export session</button>
            <p>
              This authored story uses no microphone, ASR connection or model
              calls.
            </p>
          </div>
        </details>
      </footer>
      {error || session.error ? (
        <div role="alert" className="runtime-error">
          {error ?? session.error}
          <button onClick={() => session.resume()}>Retry pending work</button>
        </div>
      ) : null}
    </main>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(<App />);
import.meta.hot?.dispose(() => {
  session.close();
  root.unmount();
});
