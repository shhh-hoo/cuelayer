import type { EffectPlan, Transcript } from "../grammar/types";

export function planEndMs(plan: EffectPlan): number {
  return plan.display.startMs + plan.display.durationMs + plan.display.holdMs + (plan.display.decay === "fade" ? 400 : 0);
}

export function CaptionRenderer({ transcript }: { transcript: Transcript; plan: EffectPlan; currentMs: number; mode: "plain" | "fx"; reducedMotion: boolean }) {
  return <section className="stage-shell" aria-label="Learner-visible caption stage"><div className="stage-label">Learner-visible caption stage</div><p className="caption-line">{transcript.tokens.map((token) => `${token.text} `)}</p></section>;
}
