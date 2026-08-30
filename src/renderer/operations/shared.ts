import type { CaptionOperation, CaptionSpanRef } from "../../grammar/types";
import type { CaptionTimelineState } from "../timing";

export type TokenPresentation = { className: string; opacity: number; scale: number };

export type OperationRendererProps = { operation: CaptionOperation; span: CaptionSpanRef; timeline: CaptionTimelineState; treatmentId: string; reducedMotion: boolean };

export function overlapsCaptionSpan(segment: CaptionSpanRef, spans: CaptionSpanRef[]) {
  return spans.some((span) => span.fragmentId === segment.fragmentId && segment.startOffset < span.endOffset && segment.endOffset > span.startOffset);
}
