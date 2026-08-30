import { groundedCaptionText } from "../grammar/span-utils";
import { validateGroundedCaption } from "../grammar/validation";
import type { GroundedCaption, Transcript } from "../grammar/types";

/**
 * The V0 composer accepts a bounded, source-attributed composition result.
 * It validates high-precision cleanup rather than attempting open-ended summarisation.
 */
export function composeGroundedCaption(rawTranscript: Transcript, composition: GroundedCaption): GroundedCaption {
  validateGroundedCaption(rawTranscript, composition);
  return composition;
}

export function visibleCaptionText(caption: GroundedCaption): string {
  return groundedCaptionText(caption);
}
