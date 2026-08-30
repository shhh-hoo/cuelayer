import type { EffectCue } from "../types";

export type CaptionTimelineState = {
  phase: "plain" | "trigger" | "effect" | "hold" | "settled";
  emphasis: number;
  itemProgress: number;
};

export function cueEndMs(cue?: EffectCue): number {
  return cue ? cue.startMs + cue.durationMs + cue.holdMs : 0;
}

export function playbackEndMs(cue?: EffectCue): number {
  return cueEndMs(cue) + 700;
}

export function resolveCaptionTimeline(cue: EffectCue | undefined, currentMs: number, mode: "plain" | "fx", reducedMotion: boolean): CaptionTimelineState {
  const applyIntensity = (state: CaptionTimelineState): CaptionTimelineState => ({ ...state, emphasis: state.emphasis * ({ subtle: 0.56, normal: 0.78, strong: 1 }[cue?.intensity ?? "subtle"]) });
  if (mode === "plain" || !cue) return applyIntensity({ phase: "plain", emphasis: 0, itemProgress: 0 });
  const { startMs, durationMs, holdMs } = cue;
  if (currentMs < startMs) return applyIntensity({ phase: "plain", emphasis: 0, itemProgress: 0 });
  if (reducedMotion) {
    if (currentMs < startMs + durationMs + holdMs) return applyIntensity({ phase: "hold", emphasis: 1, itemProgress: 1 });
    return applyIntensity({ phase: "settled", emphasis: 0, itemProgress: 1 });
  }
  if (currentMs < startMs + durationMs) {
    const progress = durationMs === 0 ? 1 : (currentMs - startMs) / durationMs;
    return applyIntensity({ phase: progress < 0.2 ? "trigger" : "effect", emphasis: progress, itemProgress: progress });
  }
  if (currentMs < startMs + durationMs + holdMs) return applyIntensity({ phase: "hold", emphasis: 1, itemProgress: 1 });
  return applyIntensity({ phase: "settled", emphasis: 0, itemProgress: 1 });
}
