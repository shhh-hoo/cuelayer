import { describe, expect, it } from "vitest";
import { compareTraceEvents, prepareDurableTraceEvent, sanitizeTracePayload } from "./durable-trace";

describe("durable trace contract", () => {
  it("removes secrets, credentials, audio, PCM, and binary values recursively", () => {
    const payload = sanitizeTracePayload({
      authorization: "Bearer private-value",
      nested: { apiKey: "sk-private-value", cookie: "session=private", transcript: "safe teaching text" },
      accessToken: "private-access-token",
      audio: "base64-private-audio",
      pcmBuffer: new Uint8Array([1, 2, 3]),
      providerText: "Bearer another-private-value",
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain("safe teaching text");
    expect(serialized).not.toContain("private-value");
    expect(serialized).not.toContain("base64-private-audio");
    expect(serialized).not.toContain("private-access-token");
    expect(serialized).not.toContain("1,2,3");
    expect(serialized).toContain("[REDACTED_SECRET]");
    expect(serialized).toContain("[OMITTED_NON_TEXT_MEDIA]");
  });

  it("orders complete events chronologically", () => {
    const later = prepareDurableTraceEvent("session-trace-test", { id: "event-later", timestamp: "2026-01-01T00:00:02.000Z", stage: "renderer", type: "render.activated", payload: {}, source: "browser" });
    const earlier = prepareDurableTraceEvent("session-trace-test", { id: "event-earlier", timestamp: "2026-01-01T00:00:01.000Z", stage: "speechmatics", type: "asr.partial", payload: { transcript: "exact" }, source: "browser" });
    const ordered = [later, earlier].sort(compareTraceEvents);
    expect(ordered.map((event) => event.id)).toEqual(["event-earlier", "event-later"]);
    expect(ordered.every((event) => event.schemaVersion === 1 && event.sessionId === "session-trace-test")).toBe(true);
  });

  it("uses source sequence to keep same-millisecond API facts in causal order", () => {
    const completed = prepareDurableTraceEvent("session-trace-test", { id: "a-completed", occurredAt: "2026-01-01T00:00:00.000Z", stage: "api", type: "api_call.completed", payload: {}, source: "server", sourceInstanceId: "server:request", sourceSeq: 2 });
    const started = prepareDurableTraceEvent("session-trace-test", { id: "z-started", occurredAt: "2026-01-01T00:00:00.000Z", stage: "api", type: "api_call.started", payload: {}, source: "server", sourceInstanceId: "server:request", sourceSeq: 1 });
    expect([completed, started].sort(compareTraceEvents).map((event) => event.type)).toEqual(["api_call.started", "api_call.completed"]);
  });
});
