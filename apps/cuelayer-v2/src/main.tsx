import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Session } from "./session";
import { realInterpreter } from "./adapters/live";
import { Microphone } from "./adapters/microphone";
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
const real = params.get("services") === "real";
const serviceConfig = real
  ? await fetch("/api/v2/config").then((r) => r.json())
  : null;
let traceSession: Session | undefined;
const session = await Session.open(
  sessionId,
  real
    ? realInterpreter(() => traceSession?.trace)
    : deterministicInterpreter({
        live: Number(params.get("live") ?? 120),
        stage: Number(params.get("stage") ?? 1200),
      }),
  undefined,
  real
    ? {
        coalesceMs: 250,
        maxWaitMs: 750,
        sourceChars: 2400,
        maxRequestBytes: 28000,
        deadlineMs: serviceConfig.clientTimeoutMs,
        latencyPolicy: serviceConfig.effectiveLatencyPolicy,
      }
    : undefined,
);
traceSession = session;
if (real) session.trace.mark("model-config", serviceConfig);
const mic = new Microphone(session, () => api.refresh());
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
  mic,
  refresh: () => {},
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
  const [lessonText, setLessonText] = useState("");
  const [addingText, setAddingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [textAdded, setTextAdded] = useState(false);
  const revision = session.state.revision;
  const state = useMemo(() => session.state, [revision]);
  useEffect(() => session.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(timer);
  }, []);
  api.refresh = () => setTick((t) => t + 1);
  api.failRepresentation = setFailed;
  api.setMode = setMode;
  const intent = mode
    ? {
        targets:
          mode === "COMPARE"
            ? Object.values(state.units)
                .filter((u) => u.valid && u.coreId === state.currentCoreId)
                .slice(-2)
                .map((u) => u.id)
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
  const textUnavailable = session.readOnly || session.replay.captureClosed;
  const addText = async () => {
    if (!lessonText.trim() || addingText || textUnavailable) return;
    setAddingText(true);
    setTextError(null);
    setTextAdded(false);
    try {
      // Admission persists the source; interpretation continues independently.
      await api.inject(lessonText);
      setLessonText("");
      setTextAdded(true);
    } catch (e) {
      setTextError(
        `Could not add this passage. Your text is still here. ${String(e)}`,
      );
    } finally {
      setAddingText(false);
    }
  };
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
    await session.trace.flush(session.store, session.id);
    const blob = new Blob(
        [
          JSON.stringify({
            session: JSON.parse(await session.store.exportSession(sessionId)),
            diagnostics: await session.store.traces
              .where("sessionId")
              .equals(sessionId)
              .toArray(),
          }),
        ],
        {
          type: "application/json",
        },
      ),
      url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cuelayer-v2-${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <main
      className={`app${overlay ? " overlay" : ""}${real ? " with-text-entry" : ""}`}
    >
      <header>
        <div className="brand">
          cue<span>layer</span>
          <b>V2</b>
        </div>
        <div className="lesson-title">
          {state.cores[state.currentCoreId ?? ""]?.label ??
            state.cores[state.currentCoreId ?? ""]?.title ??
            "A place for the next idea"}
        </div>
        {real ? (
          <button
            onClick={() =>
              void (mic.status === "listening" ? mic.stop() : mic.start())
            }
            disabled={
              session.readOnly ||
              session.replay.captureClosed ||
              ["starting", "draining", "failed"].includes(mic.status)
            }
          >
            {mic.status === "listening"
              ? "Stop microphone"
              : "Enable microphone"}
          </button>
        ) : (
          <button
            onClick={run}
            disabled={
              session.readOnly ||
              running ||
              w.orderedCommittedEvidence.length > 0
            }
          >
            {running ? "Teaching…" : "Run teaching story"}
          </button>
        )}
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
            <p>
              {real
                ? "Add a passage below to begin, or enable the microphone."
                : "Run the deterministic story to explore this rebuild."}
            </p>
          </div>
        ) : null}
        {state.cue &&
        session.cuePresentation?.version === state.cueVersion &&
        session.cuePresentation.mainlineVersion === state.mainlineVersion ? (
          <TeachingCue
            text={state.cue.text}
            trace={session.trace}
            revision={revision}
            cueVersion={state.cueVersion}
          />
        ) : (
          <div className="cue-region quiet">
            <span>Room to think.</span>
          </div>
        )}
      </section>
      {real ? (
        <form
          className="text-entry"
          aria-label="Add teaching text"
          onSubmit={(event) => {
            event.preventDefault();
            void addText();
          }}
        >
          <label htmlFor="lesson-text">Teacher text</label>
          <div className="text-entry-controls">
            <textarea
              id="lesson-text"
              rows={2}
              value={lessonText}
              disabled={textUnavailable || addingText}
              aria-describedby="lesson-text-hint"
              placeholder="Type or paste the next part of your lesson…"
              onChange={(event) => {
                setLessonText(event.target.value);
                setTextAdded(false);
                setTextError(null);
              }}
            />
            <button
              type="submit"
              disabled={textUnavailable || addingText || !lessonText.trim()}
            >
              {addingText ? "Adding…" : "Add to lesson"}
            </button>
          </div>
          <p id="lesson-text-hint" role="status">
            {session.readOnly
              ? "This saved lesson is read-only."
              : session.replay.captureClosed
                ? "This lesson has ended."
                : textAdded
                  ? "Added to lesson. You can add the next passage while it updates."
                  : "Add a sentence or a short passage. You can keep adding while the lesson updates."}
          </p>
          {textError ? <p role="alert">{textError}</p> : null}
        </form>
      ) : null}
      <footer>
        <span className="status-dot" />
        {real
          ? `${serviceConfig.observationOnly ? "Observation run · " : ""}Microphone: ${mic.status}`
          : running
            ? "Teaching continues"
            : "Deterministic teaching experiment"}
        <span>
          {w.status === "LAGGING"
            ? "Interpretation is falling behind"
            : w.status === "INTERPRETATION_PAUSED"
              ? "Interpretation paused"
              : w.status === "SEALED"
                ? "Session saved"
                : `${w.unaccountedChars} source characters awaiting interpretation`}
        </span>
        <details>
          <summary>Session details</summary>
          <div>
            <p>
              Open source: {w.unaccountedChars} characters · Oldest:{" "}
              {(w.oldestPendingAge / 1000).toFixed(1)}s · Carried source:{" "}
              {w.carryChars} characters in {Object.keys(w.unresolved).length}{" "}
              obligations · Stage: {w.activeStage ? "reviewing" : "available"}
            </p>
            <button onClick={() => setMode("FOCUS")}>Focus</button>
            <button onClick={() => setMode("COMPARE")}>Compare</button>
            <button onClick={exportSession}>Export session</button>
            {real ? (
              <button
                onClick={() => mic.forceFinal()}
                disabled={mic.status !== "listening"}
              >
                Request final
              </button>
            ) : (
              <a href="?services=real">Real speech experiment</a>
            )}
            <p>
              {real
                ? `Speechmatics receives audio; OpenAI receives bounded teaching context. Diagnostic history is stored locally. Model: ${serviceConfig.model}; provider deadline: ${serviceConfig.providerTimeoutMs / 1000}s${serviceConfig.observationOnly ? " (observation only)" : ""}.`
                : "This authored story uses no microphone, ASR connection or model calls."}
            </p>
          </div>
        </details>
      </footer>
      {error || session.error || mic.error ? (
        <div role="alert" className="runtime-error">
          {error ?? session.error ?? mic.error}
          <button
            onClick={() =>
              void (mic.error
                ? mic.retry().catch((e) => setError(String(e)))
                : session.retryFailedLive().catch((e) => setError(String(e))))
            }
          >
            Retry pending work
          </button>
        </div>
      ) : null}
    </main>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(<App />);
import.meta.hot?.dispose(() => {
  void mic.stop(false);
  session.close();
  root.unmount();
});
