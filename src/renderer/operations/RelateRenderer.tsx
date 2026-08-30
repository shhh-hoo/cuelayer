import type { OperationRendererProps, TokenPresentation } from "./shared";

export function relatePresentation({ operation, span, timeline, treatmentId }: OperationRendererProps): TokenPresentation {
  if (operation.kind !== "RELATE") return { className: "caption-token", opacity: 1, scale: 1 };
  const itemIndex = operation.items.findIndex((item) => item.fragmentId === span.fragmentId && span.startOffset < item.endOffset && span.endOffset > item.startOffset);
  if (itemIndex === -1) return { className: `caption-token caption-context ${timeline.emphasis ? "is-subdued" : ""}`, opacity: 1 - timeline.emphasis * 0.24, scale: 1 };
  const revealPoint = operation.reveal === "progressive" ? (itemIndex + 1) / operation.items.length : 0;
  const itemEmphasis = operation.reveal === "progressive" ? Math.max(0, Math.min(1, (timeline.itemProgress - revealPoint + 1 / operation.items.length) * operation.items.length)) : timeline.emphasis;
  return { className: `caption-token relation-item relation-item-${itemIndex + 1} treatment-${treatmentId}`, opacity: 0.58 + itemEmphasis * 0.42, scale: 1 };
}
