/** Session metadata, independent of either semantic reducer. */
export type LessonDomain = "legacy" | "core";

export function assertLessonDomain(events: readonly { schemaVersion: string }[], domain: LessonDomain) {
  for (const event of events) {
    const generation = event.schemaVersion === "lesson-event-v5-core" ? "core"
      : ["lesson-event-v3-learner-agency", "lesson-event-v4-continuous"].includes(event.schemaVersion) ? "legacy" : undefined;
    if (!generation) throw new Error("lesson-event-schema-incompatible");
    if (generation !== domain) throw new Error("lesson-domain-mismatch");
  }
}
