import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { PresentationStage } from "./PresentationStage";
import { requestPresentationStream, stopPresentationStream } from "./presentation-capture";
import { SessionControls } from "./SessionControls";
import { createInitialSessionState } from "./session-state";
import { createSessionPageReducer } from "./page-session-reducer";
import { usePrepareSpeechmaticsAudioContext } from "./SpeechmaticsSessionProvider";
import { speechStartFailureFrom, useSpeechmaticsSession } from "./use-speechmatics-session";
import { useTeachingPlanner } from "./use-teaching-planner";
import { TeachingTraceDrawer } from "./TeachingTraceDrawer";
import type { CaptionEpisode } from "../planner/contracts";
import { createSyntheticSemanticFixture, type SyntheticIntentKind } from "./dev-semantic-fixtures";
import type { PresentationMode } from "./presentation-mode";
import { traceDraft } from "../trace/contracts";
import { useCanonicalTrace } from "../trace/use-canonical-trace";
import { useSessionTrace } from "../trace/use-session-trace";
import { useTraceViewer } from "../trace/use-trace-viewer";

export function speechDebugEnabled(search: string) {
  return new URLSearchParams(search).getAll("debug").includes("speech");
}

export function developmentSpeechDebugEnabled(isDevelopment: boolean, search: string) {
  return isDevelopment && speechDebugEnabled(search);
}

export function SessionPage() {
  const showSpeechDebug = speechDebugEnabled(window.location.search);
  const developmentDebug = developmentSpeechDebugEnabled(import.meta.env.DEV, window.location.search);
  const trace = useSessionTrace({ observeStatus: showSpeechDebug });
  const traceViewer = useTraceViewer(trace, showSpeechDebug);
  const pageReducer = useMemo(() => createSessionPageReducer(developmentDebug), [developmentDebug]);
  const [state, dispatch] = useReducer(pageReducer, developmentDebug, createInitialSessionState);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const endedListenerRef = useRef<(() => void) | null>(null);
  const speechRunIdRef = useRef(0);
  const syntheticSequenceRef = useRef(0);
  const previousPresentationStatusRef = useRef<string | undefined>(undefined);
  const prepareSpeechmaticsAudioContext = usePrepareSpeechmaticsAudioContext();

  const { start: startSpeechmatics, stop: stopSpeechmatics, pause: pauseSpeechmatics, resume: resumeSpeechmatics } = useSpeechmaticsSession({
    onEvent: (runId, event) => dispatch({ type: "speech-event", runId, event, now: Date.now() }),
    onReady: (runId) => dispatch({ type: "speech-ready", runId }),
    onTrace: trace.emit,
  });

  useTeachingPlanner({
    sessionStatus: state.status,
    speechStatus: state.speech.status,
    speechRunId: state.speech.debug.runId,
    canonicalSpeech: state.speech.canonical,
    planner: state.planner,
    tracingEnabled: state.trace.enabled,
    dispatch,
    onTrace: trace.emit,
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

  const onCaptionRendered = useCallback((episode: CaptionEpisode, now: number, presentationMode: PresentationMode) => {
    const runId = speechRunIdRef.current;
    const spanId = episode.sourceSegmentIds.at(-1);
    trace.emit(traceDraft("renderer.activated", {
      runId,
      episodeId: episode.id,
      captionText: episode.clip.captionText,
      displayKind: episode.cue?.kind ?? "TEXT",
      presentationMode,
      sourceSegmentIds: episode.sourceSegmentIds,
    }, {
      occurredAt: now,
      priority: "critical",
      correlation: {
        rootId: spanId ? `speech:${runId}:span:${spanId}` : `cue:${episode.id}`,
        runId,
        ...(spanId ? { spanId } : {}),
        cueId: episode.id,
      },
    }));
    dispatch({ type: "renderer-activated", episode, now, presentationMode });
  }, [trace.emit]);

  const onCaptionExpire = useCallback((episodeId: string) => {
    trace.emit(traceDraft("renderer.expired", { episodeId }, { priority: "critical", correlation: { rootId: `cue:${episodeId}`, cueId: episodeId } }));
    dispatch({ type: "caption-expired", episodeId });
  }, [trace.emit]);

  const injectSemanticCue = useCallback((kind: SyntheticIntentKind) => {
    const fixture = createSyntheticSemanticFixture(kind, ++syntheticSequenceRef.current);
    dispatch({ type: "debug-inject-decision", ...fixture, now: Date.now() });
  }, []);

  const releasePresentation = useCallback((stopTracks: boolean) => {
    const stream = streamRef.current;
    const videoTrack = stream?.getVideoTracks()[0];
    if (videoTrack && endedListenerRef.current) videoTrack.removeEventListener("ended", endedListenerRef.current);
    endedListenerRef.current = null;
    streamRef.current = null;
    if (stopTracks) stopPresentationStream(stream);
  }, []);

  const stopSpeech = useCallback(async () => {
    await stopSpeechmatics();
  }, [stopSpeechmatics]);

  useEffect(() => () => { releasePresentation(true); void stopSpeech(); }, [releasePresentation, stopSpeech]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if ((state.status !== "active" && state.status !== "paused") || event.code !== "Space" || event.repeat || target?.closest("input, textarea, select, button")) return;
      event.preventDefault();
      dispatch({ type: "toggle-caption-lock" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.status]);

  const exitStageFullscreen = useCallback(async () => {
    if (document.fullscreenElement !== stageRef.current) return;
    try { await document.exitFullscreen(); } catch { setFullscreenError("CueLayer could not exit fullscreen automatically. You can exit it with your browser controls."); }
  }, []);

  const startPresentation = async () => {
    if (state.status === "ended") {
      trace.startNewSession();
      speechRunIdRef.current = 0;
      syntheticSequenceRef.current = 0;
      previousPresentationStatusRef.current = undefined;
      dispatch({ type: "restart-session" });
    }
    dispatch({ type: "begin-capture" });
    try {
      const stream = await requestPresentationStream();
      streamRef.current = stream;
      const videoTrack = stream.getVideoTracks()[0];
      const onCaptureEnded = () => {
        releasePresentation(false);
        dispatch({ type: "capture-ended" });
        void exitStageFullscreen();
      };
      endedListenerRef.current = onCaptureEnded;
      videoTrack?.addEventListener("ended", onCaptureEnded, { once: true });
      dispatch({ type: "capture-ready", stream });
    } catch (error) {
      dispatch({ type: "capture-failed", error: error && typeof error === "object" && "kind" in error && "message" in error ? error as { kind: "unsupported" | "cancelled" | "permission-denied" | "unknown"; message: string } : { kind: "unknown", message: "CueLayer could not start presentation capture. Please try selecting your presentation again." } });
    }
  };

  const endSession = async () => {
    await stopSpeech();
    releasePresentation(true);
    await exitStageFullscreen();
    await trace.complete("user_ended_session");
    dispatch({ type: "end" });
  };

  const startSpeech = async () => {
    const runId = ++speechRunIdRef.current;
    dispatch({ type: "begin-speech", runId });
    try { await startSpeechmatics(runId); }
    catch (error) {
      const startFailure = speechStartFailureFrom(error);
      dispatch({ type: "speech-event", runId, event: { kind: "error", code: startFailure.code, message: startFailure.message } });
    }
  };

  const toggleSpeech = async () => {
    if (state.speech.status === "ready") {
      pauseSpeechmatics();
      dispatch({ type: "speech-paused", runId: state.speech.debug.runId });
    } else if (state.speech.status === "paused") {
      resumeSpeechmatics();
      dispatch({ type: "speech-resumed", runId: state.speech.debug.runId });
    } else await startSpeech();
  };

  const toggleSessionPause = () => {
    if (state.status === "active") pauseSpeechmatics();
    else if (state.speech.status === "paused") resumeSpeechmatics();
    dispatch({ type: state.status === "paused" ? "resume" : "pause" });
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
    <PresentationStage ref={stageRef} stream={state.presentation.stream} presentationStatus={state.presentation.status} sessionStatus={state.status} speech={state.speech.canonical} speechStatus={state.speech.status} showSpeechDebug={showSpeechDebug} captionRuntime={state.planner.runtime} onCaptionRendered={onCaptionRendered} onCaptionExpire={onCaptionExpire} onLearnerCueExpire={(cueId) => dispatch({ type: "learner-cue-expired", cueId })}>
      <SessionControls sessionStatus={state.status} isFullscreen={isFullscreen} onPauseToggle={toggleSessionPause} onFullscreen={toggleFullscreen} onEnd={() => void endSession()} speechStatus={state.speech.status} onSpeechToggle={() => void toggleSpeech()} onSpeechPrepare={prepareSpeechmaticsAudioContext} />
    </PresentationStage>
    <section className="session-panel" aria-live="polite">
      {hasPresentation ? <p>{state.status === "paused" ? "The shared presentation remains visible. Resume when you are ready to continue speech-aware captions." : "Your presentation is live in CueLayer. Press Space to keep or release the current semantic caption."}</p> : <>
        <p>{panelMessage}</p>
        <div className="session-panel-actions"><button className="choose-presentation-button" type="button" disabled={state.presentation.status === "starting"} onClick={() => void startPresentation()}>{state.presentation.status === "starting" ? "Choosing presentation…" : state.status === "ended" ? "Start another session" : "Choose presentation"}</button>{sessionIsRunning && state.presentation.status !== "starting" ? <button className="end-session-link" type="button" onClick={() => void endSession()}>End session</button> : null}</div>
      </>}
      {state.speech.error ? <p className="session-error" role="alert">{state.speech.error.message}</p> : null}
      {showSpeechDebug && state.speech.status !== "off" ? <p className="session-debug">Speech debug · run {state.speech.debug.runId} · partials {state.speech.debug.provisionalEvents} · raw finals {state.speech.canonical.finals.length} · spans {state.speech.canonical.spans.length}{state.speech.debug.lastError ? ` · last error: ${state.speech.debug.lastError.code}` : ""}</p> : null}
      {showSpeechDebug && state.speech.status !== "off" ? <p className="session-debug">Planner debug · {state.planner.status} · request {state.planner.requestId}{state.planner.inFlightRequestId ? ` · in flight ${state.planner.inFlightRequestId}` : ""}{state.planner.latestDecision ? ` · ${state.planner.latestDecision.display.kind}/${state.planner.latestDecision.learner.kind}` : ""}{state.planner.lastValidationError ? ` · validation: ${state.planner.lastValidationError}` : state.planner.lastError ? ` · error: ${state.planner.lastError}` : ""}</p> : null}
      {showSpeechDebug ? <TeachingTraceDrawer
        sessionId={trace.sessionId}
        events={traceViewer.events}
        status={trace.snapshot.status}
        pendingCount={trace.snapshot.pendingCount}
        droppedCount={trace.snapshot.droppedCount}
        error={traceViewer.error ?? trace.snapshot.error}
        loading={traceViewer.loading}
        onReload={() => void traceViewer.reload()}
        onExport={() => void traceViewer.downloadJsonl()}
        onInject={developmentDebug ? injectSemanticCue : undefined}
      /> : null}
      {fullscreenError ? <p className="session-error" role="alert">{fullscreenError}</p> : null}
    </section>
  </main>;
}
