import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CoreVerificationJob } from "../../trace/core-contracts.ts";
import type { SessionTraceDraft } from "../../trace/contracts.ts";
import { CoreTrace } from "./trace.ts";
import { VerificationDispatcher, VERIFICATION_QUEUE_LIMITS } from "./verification-dispatcher.ts";
import { deferred } from "./live-test-fixtures.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const job: CoreVerificationJob = { sessionId: "lesson", coreRequestId: "request", verificationRequestIndex: 0,
  checkpointIds: ["cp1"], query: "Teacher phrase", claim: "Check this", candidateEvidence: "Untrusted investigation lead" };
function setup(sink?: ConstructorParameters<typeof VerificationDispatcher>[0]) {
  const traces: SessionTraceDraft[] = [];
  const dispatcher = new VerificationDispatcher(sink, new CoreTrace(draft => traces.push(draft)), 100);
  const statuses = () => traces.flatMap(t => t.type === "core.verification" ? [t.payload.status] : []);
  return { dispatcher, traces, statuses };
}
it("explicit no-op sink reports a dropped request with full correlation", () => {
  const { dispatcher, traces, statuses } = setup(); dispatcher.enqueue([job]);
  expect(statuses()).toEqual(["dropped"]); expect(dispatcher.pendingCount).toBe(0);
  expect(traces[0]?.payload).toMatchObject({ ...job, reason: "verifier_unconfigured" });
  expect(traces[0]?.correlation).toMatchObject({ coreRequestId: "request", verificationRequestIndex: 0 });
});
it("runs on a later task turn and reports completion", async () => {
  const sink = vi.fn(async () => undefined), { dispatcher, statuses } = setup(sink);
  dispatcher.enqueue([job]); expect(sink).not.toHaveBeenCalled(); expect(statuses()).toEqual(["enqueued"]);
  await vi.advanceTimersByTimeAsync(0); expect(statuses()).toEqual(["enqueued", "started", "completed"]); expect(dispatcher.pendingCount).toBe(0);
});
it.each(["throw", "reject", "timeout", "cancel"])("isolates %s and keeps no semantic state", async mode => {
  const wait = deferred();
  const { dispatcher, statuses } = setup(() => { if (mode === "throw") throw new Error("boom"); return wait.promise; });
  dispatcher.enqueue([job]); await vi.advanceTimersByTimeAsync(0);
  if (mode === "reject") wait.reject(new Error("boom"));
  if (mode === "cancel") dispatcher.close();
  await vi.advanceTimersByTimeAsync(100);
  expect(statuses().at(-1)).toBe(mode === "timeout" ? "timeout" : mode === "cancel" ? "cancelled" : "failed");
  expect(dispatcher.pendingCount).toBe(0);
  if (mode !== "reject" && mode !== "throw") { wait.resolve(); await vi.advanceTimersByTimeAsync(0); expect(statuses()).not.toContain("completed"); }
  dispatcher.close();
});
it("bounds backlog, reports pressure, and cancels queued work without waiting for the sink", async () => {
  const { dispatcher, statuses } = setup(() => new Promise(() => undefined));
  dispatcher.enqueue(Array.from({ length: 40 }, (_, index) => ({ ...job, verificationRequestIndex: index })));
  expect(dispatcher.pendingCount).toBe(VERIFICATION_QUEUE_LIMITS.pending);
  expect(statuses().filter(s => s === "dropped")).toHaveLength(8);
  await vi.advanceTimersByTimeAsync(0); dispatcher.close(); await vi.advanceTimersByTimeAsync(0);
  expect(dispatcher.pendingCount).toBe(0); expect(statuses().filter(s => s === "cancelled")).toHaveLength(32);
});
it("a throwing trace observer cannot prevent dispatch", async () => {
  const sink = vi.fn(async () => undefined), dispatcher = new VerificationDispatcher(sink, new CoreTrace(() => { throw new Error("trace"); }));
  dispatcher.enqueue([job]); await vi.advanceTimersByTimeAsync(0); expect(sink).toHaveBeenCalledOnce(); dispatcher.close();
});
