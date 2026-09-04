import { useEffect } from "react";
import type { BoardContent, BoardItem, TeachingStateSnapshot } from "../lesson-stream/contracts";
import { BoardLayout, boardDensityForContent, type BoardDensity } from "../teaching-cue/BoardLayout";
import type { PresentationMode } from "./presentation-mode";
import "./teaching-surface.css";

function Content({ content }: { content: BoardContent }) {
  if (content.kind === "TEXT") return <p className="teaching-board-text">{content.text}</p>;
  if (content.kind === "FOCUS") return <p className="teaching-board-focus">{content.target}</p>;
  if (content.kind === "RELATION") return <div className={`teaching-board-relation relation-${content.relation}`} aria-label={`${content.relation} relationship`}>
    {content.targets.map((target, index) => <div className="teaching-board-relation-step" key={`${index}-${target}`}>
      {index ? <span className="teaching-board-connector" aria-hidden="true">{content.relation === "contrast" ? "↔" : "↓"}</span> : null}
      <span>{target}</span>
    </div>)}
  </div>;
  return <div className="teaching-board-transform" aria-label="Teaching transformation">
    <span>{content.from}</span><span aria-hidden="true">→</span><strong>{content.to}</strong>
  </div>;
}

function RetainedItem({ item }: { item: BoardItem }) {
  return <div className="teaching-board-retained-item" data-board-item-id={item.id}><Content content={item.contribution.content} /></div>;
}

export function TeachingSurfaceLayer({ state, presentationMode, onCueExpire, onRendered }: {
  state: TeachingStateSnapshot;
  presentationMode: PresentationMode;
  onCueExpire?(cueId: string, now: number): void;
  onRendered?(details: { renderId: string; boardRevision: number; cueRevision: number; presentationMode: PresentationMode; density: BoardDensity; state: TeachingStateSnapshot }): void;
}) {
  const renderId = `render-${state.board.revision}-${state.cue.revision}-${presentationMode}`;
  const density = boardDensityForContent({ presentationMode, retainedCount: state.board.retained.length, cueTextLength: state.cue.active?.contribution.content.length ?? 0 });
  useEffect(() => {
    if (!state.board.active && !state.cue.active) return;
    onRendered?.({ renderId, boardRevision: state.board.revision, cueRevision: state.cue.revision, presentationMode, density, state });
  }, [density, onRendered, presentationMode, renderId, state.board.active, state.board.revision, state.cue.active, state.cue.revision]);

  if (!state.board.active && !state.cue.active) return null;
  return <section className="teaching-surface-layer" data-render-id={renderId} data-board-revision={state.board.revision} data-cue-revision={state.cue.revision} aria-label="Live teaching surface">
    <BoardLayout
      presentationMode={presentationMode}
      active={state.board.active ? <div className="teaching-board-active" data-board-item-id={state.board.active.id}><Content content={state.board.active.contribution.content} /></div> : null}
      support={state.board.support.length ? <div className="teaching-board-support-list">{state.board.support.map((support) => <p key={support.id}>{support.contribution.content}</p>)}</div> : undefined}
      retained={state.board.retained.map((item) => <RetainedItem key={item.id} item={item} />)}
      cue={state.cue.active}
      onCueExpire={onCueExpire}
    />
  </section>;
}
