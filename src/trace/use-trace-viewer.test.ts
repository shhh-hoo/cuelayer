import { describe, expect, it } from "vitest";
import type { SessionTraceEvent } from "./contracts";
import { sameTraceEventSnapshot } from "./use-trace-viewer";

function event(eventId: string): SessionTraceEvent {
  return {
    schemaVersion: 2,
    eventId,
    sessionId: "session-viewer-test",
    sourceInstanceId: "browser-viewer-test",
    sourceSeq: Number(eventId.split(":").at(-1) ?? 0),
    occurredAt: "2026-09-02T14:00:00.000Z",
    type: "session.ended",
    payload: { reason: "test" },
    priority: "critical",
    source: "browser",
  };
}

describe("trace viewer snapshot equality", () => {
  it("keeps a frozen v2 archive event readable after the v3 audit expansion", () => {
    expect(event("legacy:1")).toMatchObject({ schemaVersion: 2, type: "session.ended", payload: { reason: "test" } });
  });

  it("keeps the current React array when polling returns the same immutable events", () => {
    const current = [event("page:1"), event("page:2")];
    const reloaded = [event("page:1"), event("page:2")];
    expect(sameTraceEventSnapshot(current, reloaded)).toBe(true);
  });

  it("detects a newly durable event", () => {
    expect(sameTraceEventSnapshot([event("page:1")], [event("page:1"), event("page:2")])).toBe(false);
  });
});
