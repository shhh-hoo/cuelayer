import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { PresentationStage } from "./PresentationStage";
import { requestPresentationStream, stopPresentationStream } from "./presentation-capture";
import { SessionControls } from "./SessionControls";
import { createInitialSessionState } from "./session-state";
import { createSessionPageReducer } from "./page-session-reducer";
import { usePrepareSpeechmaticsAudioContext } from "./SpeechmaticsSessionProvider";
import { speechStartFailureFrom, useSpeechmaticsSession } from "./use-speechmatics-session";
import { useLiveTeaching } from "./use-live-teaching";
import { useCanonicalSpeechSpanLifecycle } from "./use-canonical-speech-span-lifecycle";
import { closeOpenCanonicalSpeechSpans } from "./canonical-speech";
import { TeachingTraceDrawer } from "./TeachingTraceDrawer";
import { traceDraft } from "../trace/contracts";
import { auditDigest } from "../trace/audit";
import { useCanonicalTrace } from "../trace/use-canonical-trace";
import { useSessionTrace } from "../trace/use-session-trace";
import { useTraceViewer } from "../trace/use-trace-viewer";
import type { BoardDensity } from "../teaching-cue/BoardLayout";
import { stopCurrentSpeechRun } from "./session-speech-lifecycle";

export function speechDebugEnabled(search: string) {
  return new URLSearchParams(search).getAll("debug").includes("speech");
}

export function developmentSpeechDebugEnabled(isDevelopment: boolean, search: string) {
  return isDevelopment && speechDebugEnabled(search);
}

export function SessionPage() {
  const showSpeechDebug = speechDebugEnabled(window.location.search);
  const trace = useSessionTrace({ observeStatus: showSpeechDebug });
  const traceViewer = useTraceViewer(trace, showSpeechDebug);
  const pageReducer = useMemo(() => createSessionPageReducer(), []);
  const [state, dispatch] = useReducer(pageReducer, undefined, createInitialSessionState);
  const stateRef = useRef(state);
  const dispatchSession = useCallback((action: import("./page-session-reducer").SessionPageAction) => {
    stateRef.current = pageReducer(stateRef.current, action);
    dispatch(action);
  }, [pageReducer]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const endedListenerRef = useRef<(() => void) | null>(null);
  const previousPresentationStatusRef = useRef<string | undefined>(undefined);
  const teachingLayoutRef = useRef<string | undefined>(undefined);
  const prepareSpeechmaticsAudioContext = usePrepareSpeechmaticsAudioContext();

  const { start: startSpeechmatics, stop: stopSpeechmatics, pause: pauseSpeechmatics, resume: resumeSpeechmatics } = useSpeechmaticsSession({
    onEvent: (runId, event) => dispatchSession({ type: "speech-event", runId, event, now: Date.now() }),
    onReady: (runId) => dispatchSession({ type: "speech-ready", runId }),
    onTrace: trace.emit,
  });

  const liveTeaching = useLiveTeaching({
    sessionId: trace.sessionId,
    sessionStatus: state.status,
    speechStatus: state.speech.status,
    speechRunId: state.speech.debug.runId,
    canonicalSpeech: state.speech.canonical,
    onTrace: trace.emit,
  });

  useCanonicalSpeechSpanLifecycle({
    canonicalSpeech: state.speech.canonical,
    speechRunId: state.speech.debug.runId,
    dispatch: dispatchSession,
  });

  useCanonicalTrace(trace.sessionId, state.speech.debug.runId, state.speech.canonical, trace.emit);

  useEffect(() => {
    const status = state.presentation.status;
    const previousStatus = previousPresentationStatusRef.current;
    if (previousStatus === status) return;
    previousPresentationStatusRef.current = status;
    trace.emit(traceDraft("presentation.state_changed", {
      ...(previousStatus === undefined ? {} : { previousStatus }),
      status,
      ...(state.presentation.error?.message ? { message: state.presentation.error.message } : {}),
    }, { priority: "critical", correlation: { rootId: "presentation" } }));
  }, [state.presentation.error?.message, state.presentation.status, trace.emit]);

  const onTeachingSurfaceRendered = useCallback(({ renderId, boardRevision, cueRevision, presentationMode, density, state: renderedState }: { renderId: string; boardRevision: number; cueRevision: number; presentationMode: "presentationless" | "presentation-overlay"; density: BoardDensity; state: import("../lesson-stream/contracts").TeachingStateSnapshot }) => {
    trace.emit(traceDraft("teaching_surface.rendered", { renderId, boardRevision, cueRevision, presentationMode, density, state: renderedState, stateDigest: auditDigest(renderedState), ...(renderedState.board.active ? { activeBoardItemId: renderedState.board.active.id } : {}), ...(renderedState.cue.active ? { activeCueId: renderedState.cue.active.id } : {}) }, {
      priority: "critical",
      correlation: { rootId: `teaching-state:${boardRevision}:${cueRevision}`, renderId, boardRevision, cueRevision },
    }));
    const layoutKey = `${presentationMode}:${density}`;
    if (teachingLayoutRef.current !== layoutKey) {
      teachingLayoutRef.current = layoutKey;
      trace.emit(traceDraft("teaching_surface.layout_changed", { presentationMode, density }, { correlation: { rootId: `teaching-state:${boardRevision}:${cueRevision}`, renderId, boardRevision, cueRevision } }));
    }
  }, [trace.emit]);

  const releasePresentation = useCallback((stopTracks: boolean) => {
    const stream = streamRef.current;
    const videoTrack = stream?.getVideoTracks()[0];
    if (videoTrack && endedListenerRef.current) videoTrack.removeEventListener("ended", endedListenerRef.current);
    endedListenerRef.current = null;
    streamRef.current = null;
    if (stopTracks) stopPresentationStream(stream);
  }, []);

  const stopSpeech = useCallback(async () => {
    await stopCurrentSpeechRun({ stateRef, stopSpeechmatics, dispatchSession });
  }, [dispatchSession, stopSpeechmatics]);
  const stopSpeechRef = useRef(stopSpeech);
  stopSpeechRef.current = stopSpeech;

  // This is deliberately unmount-only. Speech callbacks may change identity as
  // a new run starts; cleanup must never be interpreted as an explicit stop.
  useEffect(() => () => {
    releasePresentation(true);
    void stopSpeechRef.current().catch(() => undefined);
  }, [releasePresentation]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const exitStageFullscreen = useCallback(async () => {
    if (document.fullscreenElement !== stageRef.current) return;
    try { await document.exitFullscreen(); } catch { setFullscreenError("CueLayer could not exit fullscreen automatically. You can exit it with your browser controls."); }
  }, []);

  const startPresentation = async () => {
    if (state.status === "ended") {
      trace.startNewSession();
      previousPresentationStatusRef.current = undefined;
      teachingLayoutRef.current = undefined;
      dispatchSession({ type: "restart-session" });
    }
    dispatchSession({ type: "begin-capture" });
    try {
      const stream = await requestPresentationStream();
      streamRef.current = stream;
      const videoTrack = stream.getVideoTracks()[0];
      const onCaptureEnded = () => {
        releasePresentation(false);
        dispatchSession({ type: "capture-ended" });
        void exitStageFullscreen();
      };
      endedListenerRef.current = onCaptureEnded;
      videoTrack?.addEventListener("ended", onCaptureEnded, { once: true });
      dispatchSession({ type: "capture-ready", stream });
    } catch (error) {
      dispatchSession({ type: "capture-failed", error: error && typeof error === "object" && "kind" in error && "message" in error ? error as { kind: "unsupported" | "cancelled" | "permission-denied" | "unknown"; message: string } : { kind: "unknown", message: "CueLayer could not start presentation capture. Please try selecting your presentation again." } });
    }
  };

  const endSession = async () => {
    try {
      await stopSpeech();
    } catch {
      // The hook has emitted a drain-incomplete diagnostic and preserved every
      // final it saw. Ending the lesson would falsely claim lossless closure.
      return;
    }
    const speechRunId = stateRef.current.speech.debug.runId;
    const finalCanonicalSpeech = closeOpenCanonicalSpeechSpans(stateRef.current.speech.canonical, "explicit_stop", Date.now());
    releasePresentation(true);
    await exitStageFullscreen();
    const finalized = await liveTeaching.endLesson({ canonicalSpeech: finalCanonicalSpeech, speechRunId });
    if (!finalized) return;
    await trace.complete("user_ended_session");
    dispatchSession({ type: "end", now: Date.now() });
  };

  const startSpeech = async () => {
    const runId = await liveTeaching.allocateSpeechRunId();
    dispatchSession({ type: "begin-speech", runId });
    try { await startSpeechmatics(runId); }
    catch (error) {
      const startFailure = speechStartFailureFrom(error);
      dispatchSession({ type: "speech-event", runId, event: { kind: "error", code: startFailure.code, message: startFailure.message } });
    }
  };

  const toggleSpeech = async () => {
    if (state.speech.status === "ready") {
      pauseSpeechmatics();
      dispatchSession({ type: "speech-paused", runId: state.speech.debug.runId });
    } else if (state.speech.status === "paused") {
      resumeSpeechmatics();
      dispatchSession({ type: "speech-resumed", runId: state.speech.debug.runId });
    } else await startSpeech();
  };

  const toggleSessionPause = () => {
    if (state.status === "active") pauseSpeechmatics();
    else if (state.speech.status === "paused") resumeSpeechmatics();
    dispatchSession({ type: state.status === "paused" ? "resume" : "pause" });
  };

  const toggleFullscreen = async () => {
    setFullscreenError(null);
    try {
      if (document.fullscreenElement === stageRef.current) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      setFullscreenError("Fullscreen is not available here. You can continue presenting in the current window.");
    }
  };

  const hasPresentation = state.presentation.status === "ready";
  const sessionIsRunning = state.status === "active" || state.status === "paused";
  const panelMessage = state.presentation.status === "starting"
    ? "Waiting for your browser’s presentation picker."
    : state.presentation.error?.message
      ?? (state.status === "ended"
        ? "This session has ended. Start another one whenever you are ready."
        : state.presentation.status === "ended"
          ? "The presentation share ended. CueLayer remains ready for another presentation."
          : "CueLayer mirrors your chosen presentation for learners. It does not read, parse, or interpret slides.");
  return <main className="session-shell">
    <header className="session-header">
      <a href="/" className="session-brand">CueLayer</a>
      <p>Live session</p>
    </header>
    <PresentationStage ref={stageRef} stream={state.presentation.stream} presentationStatus={state.presentation.status} sessionStatus={state.status} speech={state.speech.canonical} speechStatus={state.speech.status} showSpeechDebug={showSpeechDebug} teachingState={liveTeaching.state} onTeachingSurfaceRendered={onTeachingSurfaceRendered} onTeachingCueExpire={(cueId) => void liveTeaching.expireCue(cueId)}>
      <SessionControls sessionStatus={state.status} isFullscreen={isFullscreen} onPauseToggle={toggleSessionPause} onFullscreen={toggleFullscreen} onEnd={() => void endSession()} speechStatus={state.speech.status} onSpeechToggle={() => void toggleSpeech()} onSpeechPrepare={prepareSpeechmaticsAudioContext} />
    </PresentationStage>
    <section className="session-panel" aria-live="polite">
      {hasPresentation ? <p>{state.status === "paused" ? "The shared presentation remains visible. Resume when you are ready to continue live teaching interpretation." : "Your presentation is live in CueLayer. Teaching Board and Cue updates will use the learner-safe overlay regions."}</p> : <>
        <p>{panelMessage}</p>
        <div className="session-panel-actions"><button className="choose-presentation-button" type="button" disabled={state.presentation.status === "starting"} onClick={() => void startPresentation()}>{state.presentation.status === "starting" ? "Choosing presentation…" : state.status === "ended" ? "Start another session" : "Choose presentation"}</button>{sessionIsRunning && state.presentation.status !== "starting" ? <button className="end-session-link" type="button" onClick={() => void endSession()}>End session</button> : null}</div>
      </>}
      {state.speech.error ? <p className="session-error" role="alert">{state.speech.error.message}</p> : null}
      {showSpeechDebug && state.speech.status !== "off" ? <p className="session-debug">Speech debug · run {state.speech.debug.runId} · partials {state.speech.debug.provisionalEvents} · raw finals {state.speech.canonical.finals.length} · spans {state.speech.canonical.spans.length}{state.speech.debug.lastError ? ` · last error: ${state.speech.debug.lastError.code}` : ""}</p> : null}
      {showSpeechDebug && state.speech.status !== "off" ? <p className="session-debug">Teaching State · {liveTeaching.status} · pending {liveTeaching.pendingCount} · Board r{liveTeaching.state.board.revision} · Cue r{liveTeaching.state.cue.revision}{liveTeaching.error ? ` · ${liveTeaching.error}` : ""}</p> : null}
      {showSpeechDebug ? <TeachingTraceDrawer
        sessionId={trace.sessionId}
        events={traceViewer.events}
        status={trace.snapshot.status}
        pendingCount={trace.snapshot.pendingCount}
        droppedCount={trace.snapshot.droppedCount}
        error={traceViewer.error ?? trace.snapshot.error}
        loading={traceViewer.loading}
        sessions={traceViewer.sessions}
        selectedSessionId={traceViewer.selectedSessionId}
        viewingArchive={traceViewer.viewingArchive}
        onReload={() => void traceViewer.reload()}
        onExport={() => void traceViewer.downloadJsonl()}
        onSelectSession={traceViewer.selectSession}
      /> : null}
      {fullscreenError ? <p className="session-error" role="alert">{fullscreenError}</p> : null}
    </section>
  </main>;
}
