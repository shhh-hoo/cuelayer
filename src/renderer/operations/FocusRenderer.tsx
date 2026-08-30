import type { OperationRendererProps, TokenPresentation } from "./shared";
import { overlapsCaptionSpan } from "./shared";

export function focusPresentation({ operation, span, timeline, treatmentId, reducedMotion }: OperationRendererProps): TokenPresentation {
  if (operation.kind !== "FOCUS") return { className: "caption-token", opacity: 1, scale: 1 };
  const target = overlapsCaptionSpan(span, operation.targets);
  if (!target) return { className: `caption-token caption-context ${timeline.emphasis ? "is-subdued" : ""}`, opacity: treatmentId === "dim-surrounding" || treatmentId === "spotlight" ? 1 - timeline.emphasis * 0.45 : 1, scale: 1 };
  const scale = reducedMotion || treatmentId !== "subtle-scale" ? 1 : 1 + timeline.emphasis * 0.07;
  return { className: `caption-token focus-target treatment-${treatmentId}`, opacity: 1, scale };
}
