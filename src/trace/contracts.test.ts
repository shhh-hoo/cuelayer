import { describe, expect, it } from "vitest";
import { prepareTraceEvent, sanitizeTraceEvent, traceDraft } from "./contracts";

describe("session trace contract", () => {
  it("redacts secrets from durable trace payloads", () => {
    const event = prepareTraceEvent("session-test", "browser-test", 1, traceDraft("speech.lifecycle", {
      runId: 1,
      state: "failed",
      message: "authorization=Bearer private-value; safe teaching text",
    }));
    const serialized = JSON.stringify(sanitizeTraceEvent(event));
    expect(serialized).toContain("safe teaching text");
    expect(serialized).not.toContain("private-value");
    expect(serialized).toContain("[REDACTED_SECRET]");
  });

  it("assigns stable source-local sequence identities", () => {
    const first = prepareTraceEvent("session-test", "browser-test", 1, traceDraft("session.ended", { reason: "test" }));
    const second = prepareTraceEvent("session-test", "browser-test", 2, traceDraft("session.ended", { reason: "test" }));
    expect(first.eventId).toBe("browser-test:1");
    expect(second.eventId).toBe("browser-test:2");
    expect(first.sourceSeq).toBeLessThan(second.sourceSeq);
  });
});
