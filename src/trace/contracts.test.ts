import { describe, expect, it } from "vitest";
import { prepareTraceEvent, sanitizeTraceEvent, traceDraft } from "./contracts";

describe("session trace contract", () => {
  it("redacts secrets and omits binary values outside the live product path", () => {
    const event = prepareTraceEvent("session-test", "browser-test", 1, traceDraft("planner.started", {
      runId: 1,
      requestId: 2,
      spanId: "span-1",
      spanRevision: 1,
      input: { authorization: "Bearer private-value", transcript: "safe teaching text", pcmBuffer: new Uint8Array([1, 2, 3]) },
    }));
    const serialized = JSON.stringify(sanitizeTraceEvent(event));
    expect(serialized).toContain("safe teaching text");
    expect(serialized).not.toContain("private-value");
    expect(serialized).not.toContain("1,2,3");
    expect(serialized).toContain("[REDACTED_SECRET]");
    expect(serialized).toContain("[OMITTED_NON_TEXT_MEDIA]");
  });

  it("assigns stable source-local sequence identities", () => {
    const first = prepareTraceEvent("session-test", "browser-test", 1, traceDraft("session.ended", { reason: "test" }));
    const second = prepareTraceEvent("session-test", "browser-test", 2, traceDraft("session.ended", { reason: "test" }));
    expect(first.eventId).toBe("browser-test:1");
    expect(second.eventId).toBe("browser-test:2");
    expect(first.sourceSeq).toBeLessThan(second.sourceSeq);
  });
});
