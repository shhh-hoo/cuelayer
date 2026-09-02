import { describe, expect, it } from "vitest";
import { diagnosticBundle } from "./diagnostic-bundle";

describe("diagnostic bundle", () => {
  it("is immutable and orders complete local evidence deterministically without a sink", () => {
    const bundle = diagnosticBundle({ sessionId: "session-bundle", nextSeq: 3, createdAt: "2026-09-02T10:00:00.000Z", updatedAt: "2026-09-02T10:00:02.000Z", completedAt: "2026-09-02T10:00:03.000Z" }, [
      { id: "event-2", sessionId: "session-bundle", schemaVersion: 1, occurredAt: "2026-09-02T10:00:02.000Z", stage: "planner", type: "planner.completed", payload: {}, source: "browser", sourceInstanceId: "browser", sourceSeq: 2 },
      { id: "event-1", sessionId: "session-bundle", schemaVersion: 1, occurredAt: "2026-09-02T10:00:01.000Z", stage: "speechmatics", type: "asr.final", payload: { nested: { transcript: "immutable" } }, correlation: { finalId: "final-1" }, source: "browser", sourceInstanceId: "browser", sourceSeq: 1 },
    ]);
    expect(bundle.events.map((event) => event.id)).toEqual(["event-1", "event-2"]);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.events[0]?.payload)).toBe(true);
    expect(Object.isFrozen((bundle.events[0]?.payload as { nested: object }).nested)).toBe(true);
    expect(Object.isFrozen(bundle.events[0]?.correlation)).toBe(true);
    expect(Object.isFrozen(bundle.events)).toBe(true);
  });
});
