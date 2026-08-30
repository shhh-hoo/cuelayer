import type { EffectPlan } from "../grammar/types";

export type CaptionTimelineState = {
  phase: "plain" | "trigger" | "hold" | "decay" | "settled";
  emphasis: number;
  itemProgress: number;
};

const fadeTailMs = 400;

export function planEndMs(plan: EffectPlan): number {
  return plan.display.startMs + plan.display.durationMs + plan.display.holdMs + (plan.display.decay === "fade" ? fadeTailMs : 0);
}

export function resolveCaptionTimeline(plan: EffectPlan, currentMs: number, mode: "plain" | "fx", reducedMotion: boolean): CaptionTimelineState {
  const applyIntensity = (state: CaptionTimelineState): CaptionTimelineState => ({
    ...state,
    emphasis: state.emphasis * ({ subtle: 0.56, normal: 0.78, strong: 1 }[plan.display.intensity]),
  });
  if (mode === "plain" || plan.operation.kind === "NONE") return applyIntensity({ phase: "plain", emphasis: 0, itemProgress: 0 });
  if (reducedMotion) return applyIntensity({ phase: "hold", emphasis: 1, itemProgress: 1 });
  const { startMs, durationMs, holdMs, decay } = plan.display;
  if (currentMs < startMs) return applyIntensity({ phase: "plain", emphasis: 0, itemProgress: 0 });
  if (currentMs < startMs + durationMs) {
    const progress = durationMs === 0 ? 1 : (currentMs - startMs) / durationMs;
    return applyIntensity({ phase: "trigger", emphasis: progress, itemProgress: progress });
  }
  if (currentMs < startMs + durationMs + holdMs) return applyIntensity({ phase: "hold", emphasis: 1, itemProgress: 1 });
  if (decay === "fade" && currentMs < planEndMs(plan)) {
    const progress = (currentMs - startMs - durationMs - holdMs) / fadeTailMs;
    return applyIntensity({ phase: "decay", emphasis: 1 - progress, itemProgress: 1 });
  }
  return applyIntensity(decay === "remain" ? { phase: "settled", emphasis: 1, itemProgress: 1 } : { phase: "settled", emphasis: 0, itemProgress: 1 });
}
