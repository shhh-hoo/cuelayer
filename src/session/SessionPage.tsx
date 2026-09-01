import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { PresentationStage } from "./PresentationStage";
import { requestPresentationStream, stopPresentationStream } from "./presentation-capture";
import { SessionControls } from "./SessionControls";
import { createInitialSessionState, sessionReducer } from "./session-state";
import { usePrepareSpeechmaticsAudioContext } from "./SpeechmaticsSessionProvider";
import { speechStartFailureFrom, useSpeechmaticsSession } from "./use-speechmatics-session";

export function SessionPage() {
  const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialSessionState);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const endedListenerRef = useRef<(() => void) | null>(null);
  const speechRunIdRef = useRef(0);
  const prepareSpeechmaticsAudioContext = usePrepareSpeechmaticsAudioContext();

  const { start: startSpeechmatics, stop: stopSpeechmatics, pause: pauseSpeechmatics, resume: resumeSpeechmatics } = useSpeechmaticsSession({
    onEvent: (runId, event) => dispatch({ type: "speech-event", runId, event }),
    onReady: (runId) => dispatch({ type: "speech-ready", runId }),
  });

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
    <PresentationStage ref={stageRef} stream={state.presentation.stream} presentationStatus={state.presentation.status} sessionStatus={state.status} speech={state.speech.canonical} speechStatus={state.speech.status}>
      <SessionControls sessionStatus={state.status} isFullscreen={isFullscreen} onPauseToggle={toggleSessionPause} onFullscreen={toggleFullscreen} onEnd={() => void endSession()} speechStatus={state.speech.status} onSpeechToggle={() => void toggleSpeech()} onSpeechPrepare={prepareSpeechmaticsAudioContext} />
    </PresentationStage>
    <section className="session-panel" aria-live="polite">
      {hasPresentation ? <p>{state.status === "paused" ? "The shared presentation remains visible. Pause currently prepares the CueLayer runtime for later speech and AI layers." : "Your presentation is live in CueLayer. Keep controlling the original presentation as usual."}</p> : <>
        <p>{panelMessage}</p>
        <div className="session-panel-actions"><button className="choose-presentation-button" type="button" disabled={state.presentation.status === "starting"} onClick={() => void startPresentation()}>{state.presentation.status === "starting" ? "Choosing presentation…" : state.status === "ended" ? "Start another session" : "Choose presentation"}</button>{sessionIsRunning && state.presentation.status !== "starting" ? <button className="end-session-link" type="button" onClick={() => void endSession()}>End session</button> : null}</div>
      </>}
      {state.speech.error ? <p className="session-error" role="alert">{state.speech.error.message}</p> : null}
      {import.meta.env.DEV && state.speech.status !== "off" ? <p className="session-debug">Speech debug · run {state.speech.debug.runId} · partials {state.speech.debug.provisionalEvents} · finals {state.speech.debug.committedEvents}{state.speech.debug.lastError ? ` · last error: ${state.speech.debug.lastError.code}` : ""}</p> : null}
      {fullscreenError ? <p className="session-error" role="alert">{fullscreenError}</p> : null}
    </section>
  </main>;
}
