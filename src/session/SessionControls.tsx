type SessionControlsProps = {
  paused: boolean;
  isFullscreen: boolean;
  onPauseToggle: () => void;
  onFullscreen: () => void;
  onEnd: () => void;
};

export function SessionControls({ paused, isFullscreen, onPauseToggle, onFullscreen, onEnd }: SessionControlsProps) {
  return <div className="session-controls" aria-label="Session controls">
    <button type="button" onClick={onPauseToggle}>{paused ? "Resume" : "Pause"}</button>
    <button type="button" onClick={onFullscreen}>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
    <button type="button" className="end-session-button" onClick={onEnd}>End session</button>
  </div>;
}
