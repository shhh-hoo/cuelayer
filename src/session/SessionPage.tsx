import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { PresentationStage } from "./PresentationStage";
import { requestPresentationStream, stopPresentationStream } from "./presentation-capture";
import { SessionControls } from "./SessionControls";
import { createDurableSessionState, sessionReducer } from "./session-state";
import { usePrepareSpeechmaticsAudioContext } from "./SpeechmaticsSessionProvider";
import { speechStartFailureFrom, useSpeechmaticsSession } from "./use-speechmatics-session";
import { useTeachingPlanner } from "./use-teaching-planner";
import { TeachingTraceDrawer } from "./TeachingTraceDrawer";
import type { CaptionEpisode } from "../planner/contracts";
import { createSyntheticSemanticFixture, type SyntheticIntentKind } from "./dev-semantic-fixtures";
import type { PresentationMode } from "./presentation-mode";
import { presentationModeFor } from "./presentation-mode";
import { beginNewTraceSession, resolveTraceSession } from "../trace/session-identity";
import { useDurableTrace } from "../trace/use-durable-trace";
import type { DurableTraceEventDraft } from "../trace/durable-trace";
import type { SpeechEvent } from "./speech-types";

export function speechDebugEnabled(search: string) {
  return new URLSearchParams(search).getAll("debug").includes("speech");
}

export function developmentSpeechDebugEnabled(isDevelopment: boolean, search: string) {
  return isDevelopment && speechDebugEnabled(search);
}

export function SessionPage() {
  const showSpeechDebug = speechDebugEnabled(window.location.search);
  const developmentDebug = developmentSpeechDebugEnabled(import.meta.env.DEV, window.location.search);
  const [traceIdentity, setTraceIdentity] = useState(() => resolveTraceSession(window.location, window.history));
  const [state, dispatch] = useReducer(sessionReducer, undefined, createDurableSessionState);
  const durableTrace = useDurableTrace({ sessionId: traceIdentity.sessionId, isNewSession: traceIdentity.isNew, liveTrace: state.trace });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const endedListenerRef = useRef<(() => void) | null>(null);
  const speechRunIdRef = useRef(0);
  const syntheticSequenceRef = useRef(0);
  const lifecycleSequenceRef = useRef(0);
  const previousPresentationModeRef = useRef<PresentationMode | undefined>(undefined);
  const prepareSpeechmaticsAudioContext = usePrepareSpeechmaticsAudioContext();

  const appendTrace = useCallback((event: Omit<DurableTraceEventDraft, "id" | "timestamp" | "source">) => durableTrace.append([{
    ...event,
    id: `${durableTrace.pageInstanceId}:lifecycle-${++lifecycleSequenceRef.current}`,
    timestamp: new Date().toISOString(),
    source: "browser",
  }]), [durableTrace.append, durableTrace.pageInstanceId]);
  const onSpeechEvent = useCallback((runId: number, event: SpeechEvent) => {
    dispatch({ type: "speech-event", runId, event, now: Date.now() });
  }, []);
  const onSpeechReady = useCallback((runId: number) => dispatch({ type: "speech-ready", runId }), []);
  const onSpeechTrace = useCallback((event: Omit<DurableTraceEventDraft, "id" | "timestamp" | "source">) => { void appendTrace(event); }, [appendTrace]);

  const { start: startSpeechmatics, stop: stopSpeechmatics, pause: pauseSpeechmatics, resume: resumeSpeechmatics, diagnostics: speechDiagnostics } = useSpeechmaticsSession({
    traceSessionId: traceIdentity.sessionId,
    tracePageInstanceId: durableTrace.pageInstanceId,
    onServerTraceEvents: durableTrace.append,
    onEvent: onSpeechEvent,
    onReady: onSpeechReady,
    onTrace: onSpeechTrace,
  });

  useTeachingPlanner({
    sessionStatus: state.status,
    speechStatus: state.speech.status,
    speechRunId: state.speech.debug.runId,
    canonicalSpeech: state.speech.canonical,
    planner: state.planner,
    tracingEnabled: true,
    traceSessionId: traceIdentity.sessionId,
    tracePageInstanceId: durableTrace.pageInstanceId,
    onServerTraceEvents: durableTrace.append,
    dispatch,
  });

  useEffect(() => {
    const mode = presentationModeFor(state.presentation);
    if (previousPresentationModeRef.current === mode) return;
    const previousMode = previousPresentationModeRef.current;
    previousPresentationModeRef.current = mode;
    void appendTrace({ stage: "presentation", type: "presentation.mode_changed", payload: { previousMode, presentationMode: mode, presentationStatus: state.presentation.status } });
  }, [appendTrace, state.presentation]);

  const onCaptionRendered = useCallback((episode: CaptionEpisode, now: number, presentationMode: PresentationMode, observation: { surfaceSource: "semantic" | "canonical_fallback"; previousEpisodeId?: string; suppressedEpisodeId?: string; rendererState: unknown }) => {
    dispatch({ type: "renderer-activated", episode, now, presentationMode, ...observation });
  }, []);

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
    appendTrace({ stage: "session", type: "session.ended", payload: { reason: "user_ended_session" } });
    await durableTrace.complete();
    dispatch({ type: "end" });
  };

  const startAnotherSession = async () => {
    speechRunIdRef.current = 0;
    syntheticSequenceRef.current = 0;
    lifecycleSequenceRef.current = 0;
    previousPresentationModeRef.current = undefined;
    setTraceIdentity(beginNewTraceSession(window.location, window.history));
    dispatch({ type: "restart" });
    await startPresentation();
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
    <PresentationStage ref={stageRef} stream={state.presentation.stream} presentationStatus={state.presentation.status} sessionStatus={state.status} speech={state.speech.canonical} speechStatus={state.speech.status} showSpeechDebug={showSpeechDebug} captionRuntime={state.planner.runtime} onCaptionRendered={onCaptionRendered} onCaptionExpire={(episodeId, now, presentationMode) => dispatch({ type: "caption-expired", episodeId, now, presentationMode })} onLearnerCueExpire={(cueId) => dispatch({ type: "learner-cue-expired", cueId })}>
      <SessionControls sessionStatus={state.status} isFullscreen={isFullscreen} onPauseToggle={toggleSessionPause} onFullscreen={toggleFullscreen} onEnd={() => void endSession()} speechStatus={state.speech.status} onSpeechToggle={() => void toggleSpeech()} onSpeechPrepare={prepareSpeechmaticsAudioContext} />
    </PresentationStage>
    <section className="session-panel" aria-live="polite">
      {hasPresentation ? <p>{state.status === "paused" ? "The shared presentation remains visible. Resume when you are ready to continue speech-aware captions." : "Your presentation is live in CueLayer. Press Space to keep or release the current semantic caption."}</p> : <>
        <p>{panelMessage}</p>
        <div className="session-panel-actions"><button className="choose-presentation-button" type="button" disabled={state.presentation.status === "starting"} onClick={() => void (state.status === "ended" ? startAnotherSession() : startPresentation())}>{state.presentation.status === "starting" ? "Choosing presentation…" : state.status === "ended" ? "Start another session" : "Choose presentation"}</button>{sessionIsRunning && state.presentation.status !== "starting" ? <button className="end-session-link" type="button" onClick={() => void endSession()}>End session</button> : null}</div>
      </>}
      {state.speech.error ? <p className="session-error" role="alert">{state.speech.error.message}</p> : null}
      {showSpeechDebug ? <section className="speech-diagnostic-panel" aria-label="Speech diagnostics">
        <strong>Speech diagnostics</strong>
        <p>Input permission: {speechDiagnostics.permissionState} · selected: {speechDiagnostics.selectedDeviceLabel}</p>
        {speechDiagnostics.permissionState === "prompt" && speechDiagnostics.requestPermission ? <button type="button" onClick={() => void speechDiagnostics.requestPermission?.()}>Allow microphone to inspect inputs</button> : null}
        {speechDiagnostics.permissionState === "granted" ? <label>Input device <select value={speechDiagnostics.selectedDeviceId ?? ""} onChange={(event) => speechDiagnostics.setSelectedDeviceId(event.target.value || undefined)}>
          <option value="">Browser default input</option>
          {speechDiagnostics.deviceList.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
        </select></label> : null}
        {speechDiagnostics.latestPcmWindow ? <p>PCM · {speechDiagnostics.latestPcmWindow.classification} · peak {speechDiagnostics.latestPcmWindow.peakAbsolute.toFixed(3)} · RMS {speechDiagnostics.latestPcmWindow.rmsDbfs.toFixed(1)} dBFS · {speechDiagnostics.latestPcmWindow.sampleCount} samples</p> : <p>PCM level appears after live audio starts.</p>}
        <div className="speech-diagnostic-actions">
          <button type="button" disabled={state.speech.status !== "ready" || speechDiagnostics.soundCheckState.status === "capturing"} onClick={speechDiagnostics.startSoundCheck}>5-second local sound check</button>
          <button type="button" disabled={speechDiagnostics.soundCheckState.status !== "ready"} onClick={speechDiagnostics.playSoundCheck}>Play local check</button>
          <button type="button" disabled={speechDiagnostics.soundCheckState.status === "idle"} onClick={speechDiagnostics.closeSoundCheck}>Discard local check</button>
        </div>
        <p>Local check: {speechDiagnostics.soundCheckState.status} · {speechDiagnostics.soundCheckState.sampleCount} samples. It stays only in this tab’s memory and is discarded on reload or close.</p>
      </section> : null}
      {showSpeechDebug && state.speech.status !== "off" ? <p className="session-debug">Speech debug · run {state.speech.debug.runId} · partials {state.speech.debug.provisionalEvents} · raw finals {state.speech.canonical.finals.length} · spans {state.speech.canonical.spans.length}{state.speech.debug.lastError ? ` · last error: ${state.speech.debug.lastError.code}` : ""}</p> : null}
      {showSpeechDebug && state.speech.status !== "off" ? <p className="session-debug">Planner debug · {state.planner.status} · request {state.planner.requestId}{state.planner.inFlightRequestId ? ` · in flight ${state.planner.inFlightRequestId}` : ""}{state.planner.latestDecision ? ` · ${state.planner.latestDecision.display.kind}/${state.planner.latestDecision.learner.kind}` : ""}{state.planner.lastValidationError ? ` · validation: ${state.planner.lastValidationError}` : state.planner.lastError ? ` · error: ${state.planner.lastError}` : ""}</p> : null}
      {showSpeechDebug ? <TeachingTraceDrawer sessionId={durableTrace.sessionId} events={durableTrace.events} status={durableTrace.status} error={durableTrace.error} pendingCount={durableTrace.pendingCount} onReload={() => void durableTrace.reload()} onExport={() => void durableTrace.exportJsonl()} onInject={developmentDebug ? injectSemanticCue : undefined} /> : null}
      {fullscreenError ? <p className="session-error" role="alert">{fullscreenError}</p> : null}
    </section>
  </main>;
}
