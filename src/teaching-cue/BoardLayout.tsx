import type { ReactNode } from "react";
import type { PresentationMode } from "../session/presentation-mode";
import type { ActiveTeachingCue } from "./contracts";
import { TeachingCueLayer } from "./TeachingCueLayer";
import "./board-layout.css";

export function BoardLayout({ active, support, retained = [], cue, presentationMode, onCueExpire }: {
  active: ReactNode;
  support?: ReactNode;
  retained?: ReactNode[];
  cue?: ActiveTeachingCue;
  presentationMode: PresentationMode;
  onCueExpire?(cueId: string, now: number): void;
}) {
  return <div
    className={`board-layout board-layout-${presentationMode}`}
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
