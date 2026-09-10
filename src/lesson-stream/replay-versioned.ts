import type { LessonEvent } from "./contracts.ts";
import { replayLessonEvents } from "./replay.ts";
import { CORE_EVENT_SCHEMA_VERSION } from "./core/contracts.ts";
import { replayCoreEvents } from "./core/replay.ts";

/** Offline dispatch only. Production remains on replayLessonEvents and the legacy runtime. */
export function replayVersionedLessonEvents(events: readonly unknown[]) {
  const generations = new Set(events.map(event => {
    const version = event && typeof event === "object" && "schemaVersion" in event ? event.schemaVersion : undefined;
    if (version === CORE_EVENT_SCHEMA_VERSION) return "core";
    if (version === "lesson-event-v3-learner-agency" || version === "lesson-event-v4-continuous") return "legacy";
    throw new Error("lesson-event-schema-incompatible");
  }));
  if (generations.size > 1) throw new Error("lesson-domain-generation-mixed");
  if (generations.has("core")) return { generation: "core" as const, replay: replayCoreEvents(events) };
  // No new legacy validation or conversion: historically readable v3/v4 mixtures stay readable.
  return { generation: "legacy" as const, replay: replayLessonEvents(events as readonly LessonEvent[]) };
}
