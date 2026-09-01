import type { PresentationStatus } from "./session-types";

export type PresentationMode = "presentationless" | "presentation-overlay";

/** A live capture is the only thing that turns captions into an overlay. */
export function presentationModeFor(presentation: { status: PresentationStatus; stream: MediaStream | null }): PresentationMode {
  return presentation.status === "ready" && presentation.stream ? "presentation-overlay" : "presentationless";
}
