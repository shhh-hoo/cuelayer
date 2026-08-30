import type { OperationRendererProps, TokenPresentation } from "./shared";
import { includesWord } from "./shared";

export function transformPresentation({ cue, wordId, timeline, reducedMotion }: OperationRendererProps): TokenPresentation {
  if (cue.kind !== "TRANSFORM") return { className: "caption-token", opacity: 1, scale: 1 };
  const treatmentClass = cue.treatment === "derive" ? "derive-inline" : cue.treatment === "state-change" ? "shift-and-reveal" : cue.treatment;
  if (includesWord(wordId, cue.fromWordIds)) return { className: `caption-token previous-state treatment-${treatmentClass}`, opacity: 1 - timeline.emphasis * 0.44, scale: 1 };
  if (includesWord(wordId, cue.toWordIds)) return { className: `caption-token current-state treatment-${treatmentClass}`, opacity: 0.62 + timeline.emphasis * 0.38, scale: reducedMotion ? 1 : 1 + timeline.emphasis * 0.035 };
  return { className: `caption-token caption-context ${timeline.emphasis ? "is-subdued" : ""}`, opacity: 1 - timeline.emphasis * 0.16, scale: 1 };
}
