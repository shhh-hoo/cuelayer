import { motion } from "motion/react";
import type { EffectPlan, Transcript } from "../grammar/types";
import { focusPresentation } from "./operations/FocusRenderer";
import { nonePresentation } from "./operations/NoneRenderer";
import { relatePresentation } from "./operations/RelateRenderer";
import { transformPresentation } from "./operations/TransformRenderer";
import { planEndMs, resolveCaptionTimeline } from "./timing";

export { planEndMs } from "./timing";

export function CaptionRenderer({ transcript, plan, currentMs, mode, reducedMotion }: { transcript: Transcript; plan: EffectPlan; currentMs: number; mode: "plain" | "fx"; reducedMotion: boolean }) {
  const timeline = resolveCaptionTimeline(plan, currentMs, mode, reducedMotion);
  const present = (tokenId: string) => {
    const props = { operation: plan.operation, tokenId, timeline, treatmentId: plan.display.treatmentId, reducedMotion };
    if (mode === "plain" || plan.operation.kind === "NONE") return nonePresentation(props);
    if (plan.operation.kind === "FOCUS") return focusPresentation(props);
    if (plan.operation.kind === "RELATE") return relatePresentation(props);
    return transformPresentation(props);
  };
  const transition = { duration: reducedMotion ? 0 : Math.max(0.12, plan.display.durationMs / 1000), ease: "easeOut" as const };
  return <section className={`stage-shell operation-${plan.operation.kind.toLowerCase()} intensity-${plan.display.intensity} phase-${timeline.phase}`} aria-label="Learner-visible caption stage"><div className="stage-label">Learner-visible caption stage · {mode === "plain" ? "plain captions" : timeline.phase}</div><p className="caption-line">{transcript.tokens.map((token) => { const presentation = present(token.id); return <motion.span key={token.id} className={presentation.className} animate={{ opacity: presentation.opacity, scale: presentation.scale }} transition={transition}>{token.text}{" "}</motion.span>; })}</p></section>;
}
