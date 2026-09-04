import type { ReactNode } from "react";
import type { PresentationMode } from "../session/presentation-mode";
import type { ActiveLessonCue } from "../lesson-stream/contracts";
import { TeachingCueLayer } from "./TeachingCueLayer";
import "./board-layout.css";

export type BoardDensity = "full" | "compact" | "essential";

export function boardDensityForContent({ presentationMode, retainedCount, cueTextLength }: {
  presentationMode: PresentationMode;
  retainedCount: number;
  cueTextLength: number;
}): BoardDensity {
  if (presentationMode === "presentation-overlay") return "essential";
  if (cueTextLength > 180) return "essential";
  if (retainedCount > 2 || cueTextLength > 110) return "compact";
  return "full";
}

export function BoardLayout({ active, support, retained = [], cue, presentationMode, onCueExpire }: {
  active: ReactNode;
  support?: ReactNode;
  retained?: ReactNode[];
  cue?: ActiveLessonCue;
  presentationMode: PresentationMode;
  onCueExpire?(cueId: string, now: number): void;
}) {
  const density = boardDensityForContent({
    presentationMode,
    retainedCount: retained.length,
    cueTextLength: cue?.contribution.content.length ?? 0,
  });

  return <div
    className={`board-layout board-layout-${presentationMode}`}
    data-density={density}
    data-has-cue={cue ? "true" : "false"}
    data-retained-count={retained.length}
  >
    <div className="board-layout-content">
      {retained.length ? <div className="board-layout-retained" aria-label="Retained teaching context">{retained.map((item, index) => <div key={index}>{item}</div>)}</div> : null}
      <div className="board-layout-active">{active}</div>
      {support ? <div className="board-layout-support">{support}</div> : null}
    </div>
    {cue ? <div className="board-layout-cue-slot">
      <TeachingCueLayer cue={cue} presentationMode={presentationMode} placement="flow" onExpire={onCueExpire} />
    </div> : null}
  </div>;
}
