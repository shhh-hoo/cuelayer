import { beforeEach, describe, expect, it, vi } from "vitest";

const append = vi.hoisted(() => vi.fn());
vi.mock("./trace-store.ts", () => ({ appendTraceEvents: append }));

import { traceExternalCall } from "./api-trace";

describe("external API trace boundary", () => {
  beforeEach(() => { append.mockReset(); append.mockImplementation(async (sessionId, drafts) => drafts.map((draft: object) => ({ ...draft, sessionId, schemaVersion: 1 }))); });

  it("persists start and normalized completion with usage", async () => {
    const result = await traceExternalCall({ sessionId: "session-api-trace", apiRequestId: "api-request-1", provider: "openai", model: "gpt-test", operation: "planner", requestPayload: { recentSpeech: [{ text: "exact canonical" }] }, responsePayload: (value) => value }, async () => ({ decision: { display: { kind: "QUIET" } }, usage: { inputTokens: 10, outputTokens: 2 } }));
    expect(result.usage.inputTokens).toBe(10);
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[0]?.[1]?.[0]).toMatchObject({ type: "api_call.started", correlation: { apiRequestId: "api-request-1" }, payload: { provider: "openai", model: "gpt-test", operation: "planner" } });
    expect(append.mock.calls[1]?.[1]?.[0]).toMatchObject({ type: "api_call.completed", payload: { status: "completed", response: { usage: { inputTokens: 10, outputTokens: 2 } } } });
  });

  it("persists failed and aborted calls", async () => {
    await expect(traceExternalCall({ sessionId: "session-api-trace", apiRequestId: "api-request-failure", provider: "deepseek", operation: "planner", requestPayload: {}, responsePayload: () => ({}) }, async () => { throw new Error("provider failed"); })).rejects.toThrow("provider failed");
    const controller = new AbortController();
    controller.abort("live_budget_timeout");
    await expect(traceExternalCall({ sessionId: "session-api-trace", apiRequestId: "api-request-abort", provider: "openai", operation: "planner", requestPayload: {}, signal: controller.signal, responsePayload: () => ({}) }, async () => { throw new DOMException("Aborted", "AbortError"); })).rejects.toThrow();
    expect(append.mock.calls.flatMap((call) => call[1]).map((event) => event.type)).toEqual(["api_call.started", "api_call.failed", "api_call.started", "api_call.timed_out"]);
  });

  it("does not call a provider when its start event cannot be persisted", async () => {
    append.mockRejectedValueOnce(new Error("trace-storage-not-configured"));
    const providerCall = vi.fn();
    await expect(traceExternalCall({ sessionId: "session-api-trace", provider: "openai", operation: "planner", requestPayload: {}, responsePayload: () => ({}) }, providerCall)).rejects.toThrow("trace-storage-not-configured");
    expect(providerCall).not.toHaveBeenCalled();
  });
});
