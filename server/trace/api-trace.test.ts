import { describe, expect, it, vi } from "vitest";
import { TracedExternalCallError, traceExternalCall } from "./api-trace";

describe("local API trace facts", () => {
  it("returns sanitized start and completion facts to the browser without remote persistence", async () => {
    const traced = await traceExternalCall({ sessionId: "session-api-trace", apiRequestId: "api-request-1", provider: "openai", model: "gpt-test", operation: "planner", requestPayload: { authorization: "Bearer secret", recentSpeech: [{ text: "exact canonical" }] }, responsePayload: (value) => value }, async () => ({ decision: { display: { kind: "QUIET" } }, usage: { inputTokens: 10, outputTokens: 2 } }));
    expect(traced.result.usage.inputTokens).toBe(10);
    expect(traced.traceDelivery.events).toMatchObject([{ type: "api_call.started", correlation: { apiRequestId: "api-request-1" } }, { type: "api_call.completed", payload: { status: "completed" } }]);
    expect(JSON.stringify(traced.traceDelivery.events)).not.toContain("Bearer secret");
  });

  it("keeps provider failure distinct and still returns factual trace evidence", async () => {
    const providerCall = vi.fn(async () => { throw new Error("provider failed"); }); let captured: unknown;
    try { await traceExternalCall({ sessionId: "session-api-trace", apiRequestId: "planner-failure", provider: "openai", operation: "planner", requestPayload: {}, responsePayload: () => ({}) }, providerCall); } catch (error) { captured = error; }
    expect(providerCall).toHaveBeenCalledOnce(); expect(captured).toBeInstanceOf(TracedExternalCallError);
    expect((captured as TracedExternalCallError).traceDelivery.events.map((event) => event.type)).toEqual(["api_call.started", "api_call.failed"]);
  });

  it("can return local-delivery facts when trace session metadata is absent", async () => {
    const traced = await traceExternalCall({ provider: "speechmatics", operation: "token", requestPayload: {}, responsePayload: () => ({ issued: true }) }, async () => "token");
    expect(traced.result).toBe("token");
    expect(traced.traceDelivery.events).toHaveLength(2);
  });
});
