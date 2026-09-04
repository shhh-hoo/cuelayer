import { describe, expect, it } from "vitest";
import { prepareTraceEvent, sanitizeTraceEvent, traceDraft } from "./contracts";
import { auditDigest, canonicalJson } from "./audit";

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

  it("keeps complete typed audit snapshots while still redacting secrets and binary media", () => {
    const processedTimeline = Array.from({ length: 240 }, (_, index) => ({ type: "evidence", checkpointId: `checkpoint-${index}`, sequence: index + 1, text: `Evidence ${index}`, warnings: [] }));
    const event = prepareTraceEvent("session-test", "browser-test", 1, traceDraft("interpretation.request_snapshot", {
      requestId: "request-1", sessionId: "session-test", policyVersion: "p4", requestDigest: "digest", checkpointIds: ["checkpoint-239"], baseBoardRevision: 0, baseCueRevision: 0,
      request: { requestId: "request-1", sessionId: "session-test", policyVersion: "p4", processedTimeline, currentState: { lessonRevision: 0, processedThroughSequence: 0, board: { revision: 0, support: [], retained: [] }, cue: { revision: 0 } }, newEvidence: [], expected: { firstUnconsumedSequence: 1, lastUnconsumedSequence: 240 }, secret: "sk-never-store-this", pcm: new Uint8Array([1, 2]) } as never,
    }));
    const sanitized = sanitizeTraceEvent(event);
    const request = (sanitized.payload as unknown as { request: { processedTimeline: unknown[]; secret: string; pcm: string } }).request;
    expect(request.processedTimeline).toHaveLength(240);
    expect(request.secret).toBe("[REDACTED_SECRET]");
    expect(request.pcm).toBe("[OMITTED_NON_TEXT_MEDIA]");
  });

  it("uses canonical SHA-256 audit facts independent of insertion order", () => {
    expect(canonicalJson({ b: [2, 1], a: "Al₂Cl₆" })).toBe(canonicalJson({ a: "Al₂Cl₆", b: [2, 1] }));
    expect(auditDigest({ b: [2, 1], a: "Al₂Cl₆" })).toBe(auditDigest({ a: "Al₂Cl₆", b: [2, 1] }));
    // Audit values are hashed as canonical JSON, including the string quotes.
    expect(auditDigest("abc")).toBe("6cc43f858fbb763301637b5af970e2a46b46f461f27e5a0f41e009c59b827b25");
  });
});
