import type { TeachingFrame, TeachingItem } from "./model.ts";

export type VisualLayer = "selected" | "review" | "suppressed" | "home" | "transient";

export const isComposition = (frame: TeachingFrame): boolean =>
  frame.scene.framing === "COMPARE" || frame.scene.framing === "WIDEN";

/** Visual attenuation only. Returning IDs keep travel legible until it settles;
 * they never retain old primary roles, alter identity or rewrite attention.
 * Work keeps its existing transient treatment throughout this focused revision.
 */
export function visualLayer(item: TeachingItem, frame: TeachingFrame, returningIds: readonly string[] = []): VisualLayer {
  if (item.kind === "WORK") return "transient";
  const composing = isComposition(frame);
  if (composing || returningIds.length > 0) {
    // HOME required includes its whole current Core for the camera. Revealing
    // that set during return would bring the old home world back through travel.
    if ((composing ? frame.scene.required : returningIds).includes(item.id)) return "selected";
    if (item.durable && frame.inspectedCoreId !== undefined && frame.inspectedCoreId === item.coreId) return "review";
    if (item.durable) return "suppressed";
  }
  return item.durable ? "home" : "transient";
}
