import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PresentationMode } from "../session/presentation-mode";
import type { ActiveTeachingCue } from "./contracts";
import { TeachingCueLayer } from "./TeachingCueLayer";
import "./board-layout.css";

export type BoardDensity = "full" | "compact" | "essential";

/**
 * The content region is measured after the Teaching Cue has taken its own row.
 * Retained context yields first; support yields only when the active object needs
 * nearly the whole remaining region.
 */
export function boardDensityForHeight(height: number): BoardDensity {
  if (!Number.isFinite(height) || height <= 0) return "full";
  if (height < 240) return "essential";
  if (height < 360) return "compact";
  return "full";
}

export function BoardLayout({ active, support, retained = [], cue, presentationMode, onCueExpire }: {
  active: ReactNode;
  support?: ReactNode;
  retained?: ReactNode[];
  cue?: ActiveTeachingCue;
  presentationMode: PresentationMode;
  onCueExpire?(cueId: string, now: number): void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [density, setDensity] = useState<BoardDensity>("full");

  useEffect(() => {
    const element = contentRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const update = () => setDensity(boardDensityForHeight(element.clientHeight));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div
    className={`board-layout board-layout-${presentationMode}`}
    data-density={density}
    data-has-cue={cue ? "true" : "false"}
    data-retained-count={retained.length}
  >
    <div className="board-layout-content" ref={contentRef}>
      {retained.length ? <div className="board-layout-retained" aria-label="Retained teaching context">{retained.map((item, index) => <div key={index}>{item}</div>)}</div> : null}
      <div className="board-layout-active">{active}</div>
      {support ? <div className="board-layout-support">{support}</div> : null}
    </div>
    {cue ? <div className="board-layout-cue-slot">
      <TeachingCueLayer cue={cue} presentationMode={presentationMode} placement="flow" onExpire={onCueExpire} />
    </div> : null}
  </div>;
}
