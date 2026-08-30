import type { OperationRendererProps, TokenPresentation } from "./shared";

export function relatePresentation({ cue, wordId, timeline }: OperationRendererProps): TokenPresentation {
  if (cue.kind !== "RELATE") return { className: "caption-token", opacity: 1, scale: 1 };
  const itemIndex = cue.targets.findIndex((target) => Boolean(wordId && target.wordIds.includes(wordId)));
  if (itemIndex === -1) return { className: `caption-token caption-context ${timeline.emphasis ? "is-subdued" : ""}`, opacity: 1 - timeline.emphasis * 0.24, scale: 1 };
  const progressive = cue.treatment === "chain" || cue.treatment === "ordered-steps";
  const revealPoint = progressive ? (itemIndex + 1) / cue.targets.length : 0;
  const itemEmphasis = progressive ? Math.max(0, Math.min(1, (timeline.itemProgress - revealPoint + 1 / cue.targets.length) * cue.targets.length)) : timeline.emphasis;
  const treatmentClass = cue.treatment === "chain" ? "progressive-chain" : cue.treatment === "ordered-steps" ? "aligned-sequence" : cue.treatment;
  return { className: `caption-token relation-item relation-item-${itemIndex + 1} treatment-${treatmentClass}`, opacity: 0.58 + itemEmphasis * 0.42, scale: 1 };
}
