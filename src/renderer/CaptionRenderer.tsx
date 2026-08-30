import { motion } from "motion/react";
import type { CaptionFragment, CaptionSpanRef, EffectPlan, GroundedCaption } from "../grammar/types";
import { focusPresentation } from "./operations/FocusRenderer";
import { nonePresentation } from "./operations/NoneRenderer";
import { relatePresentation } from "./operations/RelateRenderer";
import { transformPresentation } from "./operations/TransformRenderer";
import { planEndMs, resolveCaptionTimeline } from "./timing";

export { planEndMs } from "./timing";

function targetSpans(plan: EffectPlan): CaptionSpanRef[] {
  if (plan.operation.kind === "FOCUS") return plan.operation.targets;
  if (plan.operation.kind === "RELATE") return plan.operation.items;
  if (plan.operation.kind === "TRANSFORM") return [plan.operation.from, plan.operation.to];
  return [];
}

function fragmentSegments(fragment: CaptionFragment, targets: CaptionSpanRef[]): CaptionSpanRef[] {
  const points = new Set([0, fragment.text.length]);
  targets.filter((target) => target.fragmentId === fragment.id).forEach((target) => { points.add(target.startOffset); points.add(target.endOffset); });
  return [...points].sort((a, b) => a - b).slice(0, -1).map((startOffset, index, pointsArray) => ({ fragmentId: fragment.id, startOffset, endOffset: pointsArray[index + 1], exactText: fragment.text.slice(startOffset, pointsArray[index + 1]) }));
}

export function CaptionRenderer({ caption, plan, currentMs, mode, reducedMotion }: { caption: GroundedCaption; plan: EffectPlan; currentMs: number; mode: "plain" | "fx"; reducedMotion: boolean }) {
  const timeline = resolveCaptionTimeline(plan, currentMs, mode, reducedMotion);
  const present = (span: CaptionSpanRef) => {
    const props = { operation: plan.operation, span, timeline, treatmentId: plan.display.treatmentId, reducedMotion };
    if (mode === "plain" || plan.operation.kind === "NONE") return nonePresentation(props);
    if (plan.operation.kind === "FOCUS") return focusPresentation(props);
    if (plan.operation.kind === "RELATE") return relatePresentation(props);
    return transformPresentation(props);
  };
  const transition = { duration: reducedMotion ? 0 : Math.max(0.12, plan.display.durationMs / 1000), ease: "easeOut" as const };
  const targets = targetSpans(plan);
  return <section className={`stage-shell operation-${plan.operation.kind.toLowerCase()} intensity-${plan.display.intensity} phase-${timeline.phase}`} aria-label="Learner-visible caption stage"><div className="stage-label">Learner-visible caption stage · {mode === "plain" ? "plain captions" : timeline.phase}</div><p className="caption-line">{caption.fragments.flatMap((fragment) => fragmentSegments(fragment, targets).map((span) => { const presentation = present(span); return <motion.span key={`${span.fragmentId}-${span.startOffset}-${span.endOffset}`} className={presentation.className} animate={{ opacity: presentation.opacity, scale: presentation.scale }} transition={transition}>{span.exactText}</motion.span>; }))}</p></section>;
}
