import type { CaptionClip, EffectCue } from "../types";

function targetGroups(cue?: EffectCue): string[][] {
  if (!cue) return [];
  if (cue.kind === "FOCUS") return [cue.targetWordIds];
  if (cue.kind === "RELATE") return cue.targetGroups;
  return [cue.fromWordIds, cue.toWordIds];
}

export function PlanInspector({ clip, cue }: { clip: CaptionClip; cue?: EffectCue }) {
  const groups = targetGroups(cue);
  const wordText = new Map(clip.words.map((word) => [word.id, word.text]));
  return <aside className="inspector-panel"><div className="panel-label">Current effect plan</div><dl>
    <div><dt>Caption</dt><dd>{clip.captionText}</dd></div><div><dt>Operation</dt><dd>{cue?.kind ?? "NONE"}</dd></div>
    {cue?.kind === "RELATE" ? <div><dt>Relation</dt><dd>{cue.relation}</dd></div> : null}
    <div><dt>Treatment</dt><dd>{cue?.treatment ?? "plain"}</dd></div>{cue ? <><div><dt>Intensity</dt><dd>{cue.intensity}</dd></div><div><dt>Timing</dt><dd>{cue.startMs} / {cue.durationMs} / {cue.holdMs} ms</dd></div></> : null}
  </dl><div className="span-list"><span className="panel-label">Target words</span>{groups.length ? groups.map((group, index) => <code key={index}>{group.map((id) => wordText.get(id) ?? id).join(" · ")}</code>) : <p>None — plain caption is the default.</p>}</div></aside>;
}
