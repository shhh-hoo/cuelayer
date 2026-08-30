import { motion } from "motion/react";
import type { CaptionClip, EffectCue } from "../types";
import { captionSegments } from "./caption-segments";
import { focusPresentation } from "./operations/FocusRenderer";
import { nonePresentation } from "./operations/NoneRenderer";
import { relatePresentation } from "./operations/RelateRenderer";
import { transformPresentation } from "./operations/TransformRenderer";
import { resolveCaptionTimeline } from "./timing";

export function CaptionRenderer({ clip, cue, currentMs, mode, reducedMotion }: { clip: CaptionClip; cue?: EffectCue; currentMs: number; mode: "plain" | "fx"; reducedMotion: boolean }) {
  const timeline = resolveCaptionTimeline(cue, currentMs, mode, reducedMotion);
  const present = (wordId?: string) => {
    if (!cue || mode === "plain") return nonePresentation();
    const props = { cue, wordId, timeline, reducedMotion };
    if (cue.kind === "FOCUS") return focusPresentation(props);
    if (cue.kind === "RELATE") return relatePresentation(props);
    return transformPresentation(props);
  };
  const transition = { duration: reducedMotion ? 0 : Math.max(0.12, (cue?.durationMs ?? 0) / 1000), ease: "easeOut" as const };
  return <section className={`stage-shell operation-${cue?.kind.toLowerCase() ?? "none"} intensity-${cue?.intensity ?? "subtle"} phase-${timeline.phase}`} aria-label="Learner-visible caption stage"><div className="stage-label">Learner-visible caption stage · {mode === "plain" ? "plain captions" : timeline.phase}</div><p className="caption-line">{captionSegments(clip).map((segment) => { const presentation = present(segment.wordId); return <motion.span key={segment.key} className={presentation.className} animate={{ opacity: presentation.opacity, scale: presentation.scale }} transition={transition}>{segment.text}</motion.span>; })}</p></section>;
}
