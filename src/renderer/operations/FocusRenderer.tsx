import type { OperationRendererProps, TokenPresentation } from "./shared";
import { includesWord } from "./shared";

export function focusPresentation({ cue, wordId, timeline, reducedMotion }: OperationRendererProps): TokenPresentation {
  if (cue.kind !== "FOCUS") return { className: "caption-token", opacity: 1, scale: 1 };
  const target = includesWord(wordId, cue.target.wordIds);
  if (!target) return { className: `caption-token caption-context ${timeline.emphasis ? "is-subdued" : ""}`, opacity: cue.treatment === "dim-surrounding" || cue.treatment === "spotlight" ? 1 - timeline.emphasis * 0.45 : 1, scale: 1 };
  const scale = reducedMotion || cue.treatment !== "scale" ? 1 : 1 + timeline.emphasis * 0.07;
  const treatmentClass = cue.treatment === "marker" ? "marker-sweep" : cue.treatment === "scale" ? "subtle-scale" : cue.treatment;
  return { className: `caption-token focus-target treatment-${treatmentClass}`, opacity: 1, scale };
}
