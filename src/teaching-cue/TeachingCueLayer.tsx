import { useEffect } from "react";
import type { PresentationMode } from "../session/presentation-mode";
import type { ActiveLessonCue } from "../lesson-stream/contracts";
import "./teaching-cue.css";

const LABEL: Record<ActiveLessonCue["kind"], string> = {
  QUESTION: "Question",
  TASK: "Task",
  NOTE: "Take note",
  HINT: "Hint",
};

export function TeachingCueLayer({ cue, presentationMode, placement = "overlay", onExpire }: {
  cue?: ActiveLessonCue;
  presentationMode: PresentationMode;
  placement?: "overlay" | "flow";
  onExpire?(cueId: string, now: number): void;
}) {
  useEffect(() => {
    if (!cue?.expiresAt || !onExpire) return;
    const timeout = window.setTimeout(() => onExpire(cue.id, Date.now()), Math.max(0, cue.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [cue, onExpire]);

  if (!cue) return null;

  return <aside
    className={`teaching-cue-layer teaching-cue-${presentationMode} teaching-cue-placement-${placement}`}
    data-kind={cue.kind.toLowerCase()}
    aria-label={`${LABEL[cue.kind]} teaching cue`}
    aria-live="polite"
  >
    <div className="teaching-cue-kicker">
      <span className="teaching-cue-marker" aria-hidden="true" />
      <span>{LABEL[cue.kind]}</span>
    </div>
    <p>{cue.contribution.content}</p>
    {cue.hint ? <div className="teaching-cue-hint" aria-label="Teacher hint"><strong>Hint</strong><p>{cue.hint.contribution.content}</p></div> : null}
  </aside>;
}
