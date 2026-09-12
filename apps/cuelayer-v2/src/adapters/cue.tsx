import { useLayoutEffect, useRef } from "react";
import { autoUpdate, computePosition, shift, offset } from "@floating-ui/dom";
import type { Trace } from "./trace";
export function TeachingCue({
  text,
  trace,
  revision,
  cueVersion,
}: {
  text: string;
  trace: Trace;
  revision: number;
  cueVersion: number;
}) {
  const reference = useRef<HTMLDivElement>(null),
    floating = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!reference.current || !floating.current) return;
    const anchor = reference.current,
      cue = floating.current;
    let observed = false,
      active = true;
    const cleanup = autoUpdate(anchor, cue, () => {
      void computePosition(anchor, cue, {
        placement: "bottom",
        strategy: "absolute",
        middleware: [offset(8), shift({ padding: 16 })],
      }).then(({ x, y }) => {
        if (!active) return;
        Object.assign(cue.style, { left: `${x}px`, top: `${y}px` });
        const box = cue.getBoundingClientRect();
        if (
          !observed &&
          box.width > 0 &&
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= innerWidth &&
          box.bottom <= innerHeight &&
          document.visibilityState === "visible"
        ) {
          observed = true;
          trace.mark("cue-visible-dom", {
            revision,
            cueVersion,
            complete: true,
          });
        }
      });
    });
    return () => {
      active = false;
      cleanup();
    };
  }, [text, trace, revision, cueVersion]);
  return (
    <div className="cue-region">
      <div ref={reference} className="cue-anchor" />
      <aside
        ref={floating}
        className="teaching-cue"
        data-testid="teaching-cue"
        data-cue-version={cueVersion}
      >
        <small>THINK ABOUT</small>
        <p>{text}</p>
      </aside>
    </div>
  );
}
