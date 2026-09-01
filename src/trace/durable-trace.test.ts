import { describe, expect, it } from "vitest";
import { prepareDurableTraceEvent, sanitizeTracePayload, traceEventsToJsonl } from "./durable-trace";

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

  it("exports complete events in chronological JSONL order", () => {
    const later = prepareDurableTraceEvent("session-trace-test", { id: "event-later", timestamp: "2026-01-01T00:00:02.000Z", stage: "renderer", type: "render.activated", payload: {}, source: "browser" });
    const earlier = prepareDurableTraceEvent("session-trace-test", { id: "event-earlier", timestamp: "2026-01-01T00:00:01.000Z", stage: "speechmatics", type: "asr.partial", payload: { transcript: "exact" }, source: "browser" });
    const lines = traceEventsToJsonl([later, earlier]).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((event) => event.id)).toEqual(["event-earlier", "event-later"]);
    expect(lines.every((event) => event.schemaVersion === 1 && event.sessionId === "session-trace-test")).toBe(true);
  });
});
