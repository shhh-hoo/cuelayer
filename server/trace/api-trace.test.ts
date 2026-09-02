import { beforeEach, describe, expect, it, vi } from "vitest";

const append = vi.hoisted(() => vi.fn());
vi.mock("./trace-store.ts", () => ({ appendTraceEvents: append }));

import { TracedExternalCallError, traceExternalCall } from "./api-trace";

describe("external API trace boundary", () => {
  beforeEach(() => {
    append.mockReset();
    append.mockImplementation(async (sessionId, _capability, drafts) => drafts.map((draft: object) => ({ ...draft, sessionId, schemaVersion: 1 })));
  });

  it("persists start and normalized completion with usage", async () => {
    const traced = await traceExternalCall({ sessionId: "session-api-trace", apiRequestId: "api-request-1", provider: "openai", model: "gpt-test", operation: "planner", requestPayload: { recentSpeech: [{ text: "exact canonical" }] }, responsePayload: (value) => value }, async () => ({ decision: { display: { kind: "QUIET" } }, usage: { inputTokens: 10, outputTokens: 2 } }));
    expect(traced.result.usage.inputTokens).toBe(10);
    expect(traced.traceDelivery).toEqual({ persisted: true, events: [] });
    expect(append.mock.calls[0]?.[2]?.[0]).toMatchObject({ type: "api_call.started", correlation: { apiRequestId: "api-request-1" }, payload: { provider: "openai", model: "gpt-test", operation: "planner" } });
    expect(append.mock.calls[1]?.[2]?.[0]).toMatchObject({ type: "api_call.completed", payload: { status: "completed", response: { usage: { inputTokens: 10, outputTokens: 2 } } } });
  });

  it("calls Luna and returns recoverable facts when Neon is unavailable", async () => {
    append.mockRejectedValue(new Error("database-down"));
    const providerCall = vi.fn(async () => ({ decision: { display: { kind: "QUIET" } } }));
    const traced = await traceExternalCall({ sessionId: "session-api-trace", apiRequestId: "planner-1", provider: "openai", operation: "planner", requestPayload: { authorization: "Bearer secret" }, responsePayload: (value) => value }, providerCall);
    expect(providerCall).toHaveBeenCalledOnce();
    expect(traced.result).toEqual({ decision: { display: { kind: "QUIET" } } });
    expect(traced.traceDelivery).toMatchObject({ persisted: false, events: [{ id: "server:planner-1:started", type: "api_call.started" }, { id: "server:planner-1:completed", type: "api_call.completed" }] });
    expect(JSON.stringify(traced.traceDelivery.events)).not.toContain("Bearer secret");
  });

  it("keeps provider failure distinct when terminal trace persistence is unavailable", async () => {
    append.mockRejectedValue(new Error("database-down"));
    let captured: unknown;
    try {
      await traceExternalCall({ sessionId: "session-api-trace", apiRequestId: "planner-failure", provider: "openai", operation: "planner", requestPayload: {}, responsePayload: () => ({}) }, async () => { throw new Error("provider failed"); });
    } catch (error) { captured = error; }
    expect(captured).toBeInstanceOf(TracedExternalCallError);
    const traced = captured as TracedExternalCallError;
    expect(traced.message).toBe("provider failed");
    expect(traced.traceDelivery).toMatchObject({ persisted: false, events: [{ type: "api_call.started" }, { type: "api_call.failed" }] });
  });

  it("does not fabricate a provider failure when only completed persistence fails", async () => {
    append.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("database-down"));
    const traced = await traceExternalCall({ sessionId: "session-api-trace", apiRequestId: "planner-complete", provider: "openai", operation: "planner", requestPayload: {}, responsePayload: (value) => value }, async () => ({ decision: { display: { kind: "QUIET" } } }));
    expect(traced.result).toEqual({ decision: { display: { kind: "QUIET" } } });
    expect(traced.traceDelivery.events).toMatchObject([{ id: "server:planner-complete:completed", type: "api_call.completed" }]);
    expect(traced.traceDelivery.events.some((event) => event.type === "api_call.failed")).toBe(false);
  });
});
