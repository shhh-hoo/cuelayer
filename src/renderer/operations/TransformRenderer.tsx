import type { OperationRendererProps, TokenPresentation } from "./shared";
import { overlapsCaptionSpan } from "./shared";

export function transformPresentation({ operation, span, timeline, treatmentId, reducedMotion }: OperationRendererProps): TokenPresentation {
  if (operation.kind !== "TRANSFORM") return { className: "caption-token", opacity: 1, scale: 1 };
  if (overlapsCaptionSpan(span, [operation.from])) return { className: `caption-token previous-state treatment-${treatmentId}`, opacity: 1 - timeline.emphasis * 0.44, scale: 1 };
  if (overlapsCaptionSpan(span, [operation.to])) return { className: `caption-token current-state treatment-${treatmentId}`, opacity: 0.62 + timeline.emphasis * 0.38, scale: reducedMotion ? 1 : 1 + timeline.emphasis * 0.035 };
  return { className: `caption-token caption-context ${timeline.emphasis ? "is-subdued" : ""}`, opacity: 1 - timeline.emphasis * 0.16, scale: 1 };
}
