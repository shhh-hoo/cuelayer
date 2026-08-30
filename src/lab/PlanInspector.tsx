import type { CaptionClip, CueTarget, EffectCue } from "../types";
import { targetDisplayText } from "../renderer/cue-targets";

function targetGroups(cue?: EffectCue): CueTarget[] {
  if (!cue) return [];
  if (cue.kind === "FOCUS") return [cue.target];
  if (cue.kind === "RELATE") return cue.targets;
  return [cue.from, cue.to];
}

export function PlanInspector({ clip, cue }: { clip: CaptionClip; cue?: EffectCue }) {
  const groups = targetGroups(cue);
  return <aside className="inspector-panel"><div className="panel-label">Current effect plan</div><dl>
    <div><dt>Caption</dt><dd>{clip.captionText}</dd></div><div><dt>Operation</dt><dd>{cue?.kind ?? "NONE"}</dd></div>
    {cue?.kind === "RELATE" ? <div><dt>Relation</dt><dd>{cue.relation}</dd></div> : null}
    <div><dt>Treatment</dt><dd>{cue?.treatment ?? "plain"}</dd></div>{cue ? <><div><dt>Intensity</dt><dd>{cue.intensity}</dd></div><div><dt>Timing</dt><dd>{cue.startMs} / {cue.durationMs} / {cue.holdMs} ms</dd></div></> : null}
  </dl><div className="span-list"><span className="panel-label">Semantic targets</span>{groups.length ? groups.map((target) => <code key={target.id}>{targetDisplayText(clip, target)}</code>) : <p>None — plain caption is the default.</p>}</div></aside>;
}
