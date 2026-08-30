import { transcriptText } from "../grammar/span-utils";
import type { GroundedCaption, Transcript } from "../grammar/types";

function sourceLabel(source: GroundedCaption["fragments"][number]["provenance"][number]) {
  if (source.kind === "speech") return `speech: ${source.tokenIds.join(", ")}`;
  if (source.kind === "lesson-source") return `lesson: ${source.sourceId} · ${source.locator} · “${source.exactText}”`;
  return `normalization: ${source.ruleId}`;
}

export function ProvenanceInspector({ transcript, caption }: { transcript: Transcript; caption: GroundedCaption }) {
  return <section className="transcript-inspector"><div className="panel-label">Provenance inspector · authoring only</div><p className="raw-line"><strong>Raw speech:</strong> {transcriptText(transcript)}</p><div className="provenance-list">{caption.fragments.map((fragment) => <article key={fragment.id}><strong>Visible: “{fragment.text}”</strong><small>{fragment.transformation} · confidence {Math.round(fragment.confidence * 100)}%</small>{fragment.provenance.map((source, index) => <code key={`${fragment.id}-${index}`}>{sourceLabel(source)}</code>)}</article>)}</div>{caption.suppressed.length ? <div className="suppressed"><strong>Suppressed speech</strong>{caption.suppressed.map((entry) => <p key={entry.tokenIds.join("-")}>{entry.reason}: {entry.tokenIds.join(", ")}{entry.preserveAsPedagogicalCue ? " · preserved as a pedagogical cue" : ""}</p>)}</div> : null}{caption.pedagogicalCues.length ? <div className="suppressed"><strong>Preserved pedagogical cues</strong>{caption.pedagogicalCues.map((cue, index) => <p key={index}>{cue.kind}: {cue.reason}</p>)}</div> : null}</section>;
}
