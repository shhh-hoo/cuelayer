import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpTraceTransport, TraceTransportError } from "./trace-client";

const sessionId = "session-transport-test";
const event = { id: "browser:transport-1", occurredAt: "2026-09-01T10:00:00.000Z", stage: "session" as const, type: "session.started", source: "browser" as const, payload: {} };

describe("HTTP trace transport failure classification", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [403, "trace-capability-invalid", "authorization"],
    [409, "trace-session-capability-conflict", "conflict"],
    [400, "invalid-trace-batch", "invalid_request"],
    [503, "trace-store-unavailable", "transient"],
  ] as const)("classifies HTTP %i as %s", async (status, error, kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } })));
    const transport = createHttpTraceTransport("/api/trace");
    let caught: unknown;
    try { await transport.append(sessionId, "w".repeat(43), [event]); } catch (reason) { caught = reason; }
    expect(caught).toBeInstanceOf(TraceTransportError);
    expect(caught).toMatchObject({ message: error, kind, status });
  });
});
