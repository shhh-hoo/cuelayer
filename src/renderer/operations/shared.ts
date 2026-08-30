import type { EffectCue } from "../../types";
import type { CaptionTimelineState } from "../timing";

export type TokenPresentation = { className: string; opacity: number; scale: number };

export type OperationRendererProps = { cue: EffectCue; wordId?: string; timeline: CaptionTimelineState; reducedMotion: boolean };

export function includesWord(wordId: string | undefined, wordIds: string[]) {
  return Boolean(wordId && wordIds.includes(wordId));
}
