import { useLayoutEffect, useRef } from "react";
import { autoUpdate, computePosition, shift, offset } from "@floating-ui/dom";
export function TeachingCue({ text }: { text: string }) {
  const reference = useRef<HTMLDivElement>(null),
    floating = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!reference.current || !floating.current) return;
    const anchor = reference.current,
      cue = floating.current;
    return autoUpdate(anchor, cue, () => {
      void computePosition(anchor, cue, {
        placement: "bottom",
        strategy: "absolute",
        middleware: [offset(8), shift({ padding: 16 })],
      }).then(({ x, y }) => {
        Object.assign(cue.style, { left: `${x}px`, top: `${y}px` });
      });
    });
  }, [text]);
  return (
    <div className="cue-region">
      <div ref={reference} className="cue-anchor" />
      <aside ref={floating} className="teaching-cue" data-testid="teaching-cue">
        <small>THINK ABOUT</small>
        <p>{text}</p>
      </aside>
    </div>
  );
}
