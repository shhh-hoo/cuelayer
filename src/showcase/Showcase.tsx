import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { CaptionRenderer } from "../renderer/CaptionRenderer";
import { showcaseDurationMs, showcaseMoments } from "./showcase-data";

export function Showcase() {
  const [currentMs, setCurrentMs] = useState(0);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const startedAt = window.performance.now();
    let frame = 0;
    const tick = (now: number) => { setCurrentMs((now - startedAt) % showcaseDurationMs); frame = window.requestAnimationFrame(tick); };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const moment = useMemo(() => [...showcaseMoments].reverse().find(({ startMs }) => currentMs >= startMs) ?? showcaseMoments[0], [currentMs]);
  return <MotionConfig reducedMotion={reducedMotion ? "always" : "user"}><main className="showcase-shell"><CaptionRenderer clip={moment.clip} cue={moment.clip.cues[0]} currentMs={currentMs - moment.startMs} mode="fx" reducedMotion={Boolean(reducedMotion)} showcase /></main></MotionConfig>;
}
