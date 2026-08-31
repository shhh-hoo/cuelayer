import type { SpeechStatus } from "./speech-types";

type SessionControlsProps = {
  paused: boolean;
  isFullscreen: boolean;
  onPauseToggle: () => void;
  onFullscreen: () => void;
  onEnd: () => void;
  speechStatus: SpeechStatus;
  onSpeechToggle: () => void;
};

export function SessionControls({ paused, isFullscreen, onPauseToggle, onFullscreen, onEnd, speechStatus, onSpeechToggle }: SessionControlsProps) {
  const speechLabel = speechStatus === "ready" ? "Mute mic" : speechStatus === "paused" ? "Resume mic" : speechStatus === "starting" ? "Connecting mic…" : speechStatus === "error" ? "Reconnect mic" : "Enable mic";
  return <div className="session-controls" aria-label="Session controls">
    <button type="button" disabled={speechStatus === "starting" || paused} onClick={onSpeechToggle}>{speechLabel}</button>
    <button type="button" disabled={speechStatus === "starting"} onClick={onPauseToggle}>{paused ? "Resume" : "Pause"}</button>
    <button type="button" onClick={onFullscreen}>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
    <button type="button" className="end-session-button" onClick={onEnd}>End session</button>
  </div>;
}
