import type { DisplayPolicy } from "../grammar/types";

type TimelineControlsProps = {
  currentMs: number;
  maxMs: number;
  onCurrentMsChange: (value: number) => void;
  display: DisplayPolicy;
  treatmentOptions: string[];
  onDisplayChange: (patch: Partial<DisplayPolicy>) => void;
  onReplay: () => void;
  reducedMotion: boolean;
  onReducedMotionChange: (value: boolean) => void;
};

export function TimelineControls({ currentMs, maxMs, onCurrentMsChange, display, treatmentOptions, onDisplayChange, onReplay, reducedMotion, onReducedMotionChange }: TimelineControlsProps) {
  return (
    <section className="timeline-controls" aria-label="Effect authoring controls">
      <div className="timeline-header">
        <div><span className="panel-label">Deterministic timeline</span><strong>{Math.round(currentMs)} ms</strong></div>
        <button className="replay-button" type="button" onClick={onReplay}>Replay</button>
      </div>
      <input aria-label="Timeline progress" className="timeline-range" type="range" min="0" max={maxMs} value={Math.min(currentMs, maxMs)} onChange={(event) => onCurrentMsChange(Number(event.target.value))} />
      <div className="control-grid">
        <label>Treatment<select value={display.treatmentId} onChange={(event) => onDisplayChange({ treatmentId: event.target.value })}>{treatmentOptions.map((id) => <option key={id}>{id}</option>)}</select></label>
        <label>Intensity<select value={display.intensity} onChange={(event) => onDisplayChange({ intensity: event.target.value as DisplayPolicy["intensity"] })}><option>subtle</option><option>normal</option><option>strong</option></select></label>
        <label>Duration<input aria-label="Effect duration in milliseconds" type="number" min="0" step="100" value={display.durationMs} onChange={(event) => onDisplayChange({ durationMs: Number(event.target.value) })} /></label>
        <label>Hold duration<input aria-label="Hold duration in milliseconds" type="number" min="0" step="100" value={display.holdMs} onChange={(event) => onDisplayChange({ holdMs: Number(event.target.value) })} /></label>
        <label>Decay<select value={display.decay} onChange={(event) => onDisplayChange({ decay: event.target.value as DisplayPolicy["decay"] })}><option>restore-caption</option><option>fade</option><option>remain</option></select></label>
        <label className="toggle-label"><input type="checkbox" checked={reducedMotion} onChange={(event) => onReducedMotionChange(event.target.checked)} /> Reduced-motion preview</label>
      </div>
    </section>
  );
}
