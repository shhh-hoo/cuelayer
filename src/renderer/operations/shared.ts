import type { CaptionOperation } from "../../grammar/types";
import type { CaptionTimelineState } from "../timing";

export type TokenPresentation = { className: string; opacity: number; scale: number };

export type OperationRendererProps = { operation: CaptionOperation; tokenId: string; timeline: CaptionTimelineState; treatmentId: string; reducedMotion: boolean };

export function isInSpan(tokenId: string, spans: { tokenIds: string[] }[]) {
  return spans.some((span) => span.tokenIds.includes(tokenId));
}
