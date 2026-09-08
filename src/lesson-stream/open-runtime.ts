import type { LessonEventStore, LessonStreamRuntime } from "./runtime.ts";
import type { CoreEventStore, CoreLessonStreamRuntime } from "./core/runtime.ts";

/** Explicit internal boundary; normal /session continues to open legacy directly. */
export function openLessonRuntime(sessionId: string, options?: { domain?: "legacy"; store?: LessonEventStore }): Promise<LessonStreamRuntime>;
export function openLessonRuntime(sessionId: string, options: { domain: "core"; store?: CoreEventStore }): Promise<CoreLessonStreamRuntime>;
export async function openLessonRuntime(sessionId: string, options: { domain?: "legacy"; store?: LessonEventStore } | { domain: "core"; store?: CoreEventStore } = {}) {
  if (options.domain === "core") return (await import("./core/runtime.ts")).CoreLessonStreamRuntime.open(sessionId, options.store);
  return (await import("./runtime.ts")).LessonStreamRuntime.open(sessionId, options.store);
}
