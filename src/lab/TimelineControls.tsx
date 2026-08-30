import type { EffectCue } from "../types";

type TimelineControlsProps = {
  currentMs: number;
  maxMs: number;
  onCurrentMsChange: (value: number) => void;
  cue?: EffectCue;
  treatmentOptions: string[];
  onCueChange: (patch: Partial<EffectCue>) => void;
  onReplay: () => void;
  reducedMotion: boolean;
  onReducedMotionChange: (value: boolean) => void;
};

export function TimelineControls({ currentMs, maxMs, onCurrentMsChange, cue, treatmentOptions, onCueChange, onReplay, reducedMotion, onReducedMotionChange }: TimelineControlsProps) {
  return (
    <section className="timeline-controls" aria-label="Effect authoring controls">
      <div className="timeline-header">
        <div><span className="panel-label">Deterministic timeline</span><strong>{Math.round(currentMs)} ms</strong></div>
        <button className="replay-button" type="button" onClick={onReplay}>Replay</button>
      </div>
      <input aria-label="Timeline progress" className="timeline-range" type="range" min="0" max={Math.max(1, maxMs)} value={Math.min(currentMs, Math.max(1, maxMs))} onChange={(event) => onCurrentMsChange(Number(event.target.value))} />
      {cue ? <div className="control-grid">
        <label>Treatment<select value={cue.treatment} onChange={(event) => onCueChange({ treatment: event.target.value as never })}>{treatmentOptions.map((id) => <option key={id}>{id}</option>)}</select></label>
        <label>Intensity<select value={cue.intensity} onChange={(event) => onCueChange({ intensity: event.target.value as EffectCue["intensity"] })}><option>subtle</option><option>normal</option><option>strong</option></select></label>
        <label>Duration<input aria-label="Effect duration in milliseconds" type="number" min="0" step="100" value={cue.durationMs} onChange={(event) => onCueChange({ durationMs: Number(event.target.value) })} /></label>
        <label>Hold duration<input aria-label="Hold duration in milliseconds" type="number" min="0" step="100" value={cue.holdMs} onChange={(event) => onCueChange({ holdMs: Number(event.target.value) })} /></label>
        <label className="toggle-label"><input type="checkbox" checked={reducedMotion} onChange={(event) => onReducedMotionChange(event.target.checked)} /> Reduced-motion preview</label>
      </div> : <p className="lab-note">This clip has no cue. It is the plain-caption baseline.</p>}
    </section>
  );
}
