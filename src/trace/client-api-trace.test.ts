import { describe, expect, it, vi } from "vitest";
import { clientApiTraceEvent, deliverTraceWithoutBlocking } from "./client-api-trace";

describe("browser API facts", () => {
  it("records a local timeout/abort fact even when the server response cannot return", () => {
    const fact = clientApiTraceEvent({ pageInstanceId: "page-a", apiRequestId: "api-a", plannerRequestId: "planner-a", outcome: "timed_out", reason: "live_budget_timeout" });
    expect(fact).toMatchObject({ id: "api-a:browser-timed_out", type: "api_call.timed_out", source: "browser", correlation: { apiRequestId: "api-a", plannerRequestId: "planner-a" }, payload: { reason: "live_budget_timeout" } });
  });

  it("swallows synchronous and asynchronous trace delivery failures", async () => {
    expect(() => deliverTraceWithoutBlocking(() => { throw new Error("unavailable"); }, [clientApiTraceEvent({ pageInstanceId: "page", apiRequestId: "api", outcome: "failed" })])).not.toThrow();
    const rejection = vi.fn(() => Promise.reject(new Error("slow store failed")));
    deliverTraceWithoutBlocking(rejection, [clientApiTraceEvent({ pageInstanceId: "page", apiRequestId: "api", outcome: "failed" })]);
    await Promise.resolve();
    expect(rejection).toHaveBeenCalledOnce();
  });
});
