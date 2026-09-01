import type { SpeechStatus } from "./speech-types";
import type { SessionStatus } from "./session-types";

type SessionControlsProps = {
  sessionStatus: SessionStatus;
  isFullscreen: boolean;
  onPauseToggle: () => void;
  onFullscreen: () => void;
  onEnd: () => void;
  speechStatus: SpeechStatus;
  onSpeechToggle: () => void;
};

export function SessionControls({ sessionStatus, isFullscreen, onPauseToggle, onFullscreen, onEnd, speechStatus, onSpeechToggle }: SessionControlsProps) {
  const paused = sessionStatus === "paused";
  const sessionIsRunning = sessionStatus === "active" || sessionStatus === "paused";
  const speechLabel = speechStatus === "ready" ? "Mute mic" : speechStatus === "paused" ? "Resume mic" : speechStatus === "starting" ? "Connecting mic…" : speechStatus === "error" ? "Reconnect mic" : "Enable mic";
  return <div className="session-controls" aria-label="Session controls">
    <button type="button" disabled={speechStatus === "starting" || paused || sessionStatus === "ended"} onClick={onSpeechToggle}>{speechLabel}</button>
    <button type="button" disabled={speechStatus === "starting" || !sessionIsRunning} onClick={onPauseToggle}>{paused ? "Resume" : "Pause"}</button>
    <button type="button" onClick={onFullscreen}>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
    <button type="button" className="end-session-button" disabled={!sessionIsRunning} onClick={onEnd}>End session</button>
  </div>;
}
