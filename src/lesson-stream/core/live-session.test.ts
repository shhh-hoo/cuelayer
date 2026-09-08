import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoreLiveInterpreter } from "../../../server/teaching/core/live-interpreter.ts";
import type { CoreProviderTransport } from "../../../server/teaching/core/openai-interpreter.ts";
import { persistedAuditDigest } from "../../trace/audit.ts";
import type { SessionTraceDraft } from "../../trace/contracts.ts";
import { CoreLiveSession, type CoreLiveOptions } from "./live-session.ts";
import { addCue, closedSpan, deferred, MemoryCoreStore, proposalFor, proposedStep } from "./live-test-fixtures.ts";
import { replayCoreEvents } from "./replay.ts";

const sessions: CoreLiveSession[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { sessions.forEach(s => s.close()); sessions.length = 0; vi.useRealTimers(); });
async function setup(extra: Partial<CoreLiveOptions> = {}) {
  const store = new MemoryCoreStore(); const traces: SessionTraceDraft[] = [];
  const session = await CoreLiveSession.open({ sessionId: "live-test", lessonDomain: "core", speechRunId: "run-1", store,
    interpreter: async binding => proposalFor(binding, true), trace: draft => traces.push(draft), ...extra });
  sessions.push(session); return { session, store, traces };
}
async function finish(session: CoreLiveSession) {
  for (let i = 0; i < 10; i++) { const attempt = session.currentAttempt; if (!attempt) return; await attempt; }
  throw new Error("test-unexpected-live-loop");
}
function wire(request: Parameters<CoreProviderTransport>[0]) {
  return proposalFor({ context: JSON.parse(request.input[1]!.content) }, true);
}

describe("controlled Core live pipeline", () => {
  it("orders checkpoints with one flight and bounded batches across subsequent evidence", async () => {
    const first = deferred<unknown>(); const batches: string[][] = []; let calls = 0;
    const { session, store } = await setup({ interpreter: async binding => {
      batches.push(binding.newEvidenceIds); calls++;
      return calls === 1 ? first.promise : proposalFor(binding, true);
    } });
    await session.commitClosedSpan(closedSpan("s1"));
    await session.commitClosedSpan(closedSpan("s2")); await session.commitClosedSpan(closedSpan("s3"));
    expect(calls).toBe(1); expect(session.health.pendingCount).toBe(3);
    // Reply from the same request context, with exact ordered coverage.
    first.resolve({ outcome: { kind: "PROPOSE", steps: [{ consumes: ["e0"], knowledgeOps: [], cueDelta: { action: "KEEP" }, evidenceRefs: [], readRefs: [], reads: { knowledge: false, cue: false }, warnings: [] }], verificationRequests: [] } });
    await finish(session);
    expect(calls).toBe(2); expect(batches.map(batch => batch.length)).toEqual([1, 2]);
    expect(session.health.pendingCount).toBe(0); expect(session.state.processedThroughSequence).toBe(3);
    expect(replayCoreEvents(store.events)).toEqual(session.runtime.replay);
  });
  it("uses the actual Core provider envelope/strict parser and records the whole accepted chain", async () => {
    const transport = vi.fn<CoreProviderTransport>(async request => ({ output_text: JSON.stringify(wire(request)), status: "completed", model: "fixture-actual" }));
    const { session, traces, store } = await setup({ interpreter: createCoreLiveInterpreter("fixture-model", transport) });
    await session.commitClosedSpan(closedSpan()); await finish(session);
    expect(transport).toHaveBeenCalledOnce();
    const request = transport.mock.calls[0]![0];
    expect(request.text.format.name).toBe("core_interpretation_v4");
    const types = traces.map(t => t.type);
    expect(types).toEqual(expect.arrayContaining(["core.checkpoint_committed", "core.request", "core.provider_request", "core.provider_response", "core.proposal_normalized", "core.validation", "core.accepted", "core.published"]));
    expect(types.some(t => t.startsWith("board."))).toBe(false);
    const published = traces.find(t => t.type === "core.published")!;
    if (published.type !== "core.published") throw new Error("expected-publication");
    expect(published.payload.stateDigest).toBe(persistedAuditDigest(session.state));
    expect(published.payload.eventIds).toEqual(store.events.filter(e => e.type === "core.step_accepted").map(e => e.eventId));
    const requestId = published.correlation!.coreRequestId;
    for (const trace of traces.filter(t => t.type !== "core.checkpoint_committed")) expect(trace.correlation?.coreRequestId).toBe(requestId);
    const context = traces.find(t => t.type === "core.request");
    if (context?.type !== "core.request") throw new Error("expected-context");
    expect(context.payload.diagnostics).toMatchObject({ version: "core-interpretation-context-v3", evidenceCount: 1, baseKnowledgeRevision: 0, baseCueRevision: 0 });
    expect(context.payload.diagnostics.characters).toBeLessThanOrEqual(32_000);
  });
  it.each(["transport", "json", "schema", "semantic"])("preserves evidence and last accepted state on provider %s failure", async kind => {
    let fail = false;
    const transport: CoreProviderTransport = async request => {
      if (fail && kind === "transport") throw new Error("fixture-transport-failure");
      if (fail && kind === "json") return { output_text: "{broken" };
      if (fail && kind === "schema") return { output_text: JSON.stringify({ outcome: { kind: "PROPOSE", steps: [] } }) };
      const proposal = wire(request);
      if (fail && kind === "semantic") proposedStep(proposal).consumes = ["unknown"];
      return { output_text: JSON.stringify(proposal) };
    };
    const { session, store, traces } = await setup({ interpreter: createCoreLiveInterpreter("fixture", transport) });
    await session.commitClosedSpan(closedSpan("good")); await finish(session);
    const before = structuredClone(session.state); fail = true;
    await session.commitClosedSpan(closedSpan("bad")); const eventCount = store.events.length;
    await finish(session);
    expect(session.state).toEqual(before); expect(session.health.pendingCount).toBe(1); expect(session.health.inFlight).toBe(false);
    expect(store.events).toHaveLength(eventCount);
    expect(traces.filter(t => t.type === "core.provider_response")).toHaveLength(2);
    expect(session.health.paused).toBe(kind !== "transport");
    expect(traces.filter(t => t.type === "core.request_failed").at(-1)?.payload).toMatchObject({
      category: kind === "transport" ? "provider" : "validation", stage: kind === "semantic" ? "validation" : "provider",
    });
    if (kind !== "transport") {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(traces.filter(t => t.type === "core.provider_response")).toHaveLength(2);
    }
    fail = false; session.resume(); await finish(session); expect(session.health.pendingCount).toBe(0);
  });
  it("pauses a missing current trigger as validation until explicit resume", async () => {
    let invalid = true;
    const interpreter = vi.fn<CoreLiveOptions["interpreter"]>(async binding => {
      const proposal = addCue(proposalFor(binding, true), "OBJECT");
      if (invalid) proposedStep(proposal).evidenceRefs = [];
      return proposal;
    });
    const { session, store, traces } = await setup({ interpreter });
    const before = structuredClone(session.state);
    const checkpoint = await session.commitClosedSpan(closedSpan());
    await finish(session);
    expect(interpreter).toHaveBeenCalledOnce();
    expect(session.health).toMatchObject({ paused: true, consecutiveFailures: 1, pendingCount: 1, error: "core-current-trigger-required" });
    expect(traces.filter(t => t.type === "core.request_failed").map(t => t.payload)).toEqual([
      { stage: "validation", category: "validation", reason: "core-current-trigger-required", pendingCount: 1 },
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(interpreter).toHaveBeenCalledOnce();
    expect(session.health.paused).toBe(true);
    expect(session.runtime.pending).toEqual([checkpoint]);
    expect(session.state).toEqual(before);
    expect(session.state.knowledge).toEqual(before.knowledge);
    expect(session.state.cue).toEqual(before.cue);
    expect(store.events.filter(e => e.type === "core.step_accepted")).toHaveLength(0);
    expect(traces.filter(t => t.type === "core.published")).toHaveLength(0);

    invalid = false; session.resume(); await finish(session);
    expect(interpreter).toHaveBeenCalledTimes(2);
    expect(session.health).toMatchObject({ paused: false, pendingCount: 0 });
    expect(session.runtime.pending).toEqual([]);
    expect(session.state.processedThroughSequence).toBe(checkpoint!.lessonSequence);
    expect(session.state.knowledge.revision).toBe(1);
    expect(session.state.cue.active).toBeDefined();
    expect(store.events.filter(e => e.type === "core.step_accepted")).toHaveLength(1);
    expect(traces.filter(t => t.type === "core.published")).toHaveLength(1);
  });
  it("bounds repeated transport retries and new evidence cannot bypass backoff", async () => {
    const interpreter = vi.fn(async () => { throw new Error("unavailable"); });
    const { session } = await setup({ interpreter });
    await session.commitClosedSpan(closedSpan()); await finish(session);
    await session.commitClosedSpan(closedSpan("s2")); expect(interpreter).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000); expect(interpreter).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000); expect(interpreter).toHaveBeenCalledTimes(3); expect(session.health.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000); expect(interpreter).toHaveBeenCalledTimes(3); expect(session.health.pendingCount).toBe(2);
  });
  it("hard-times out a provider that ignores abort and ignores its late result", async () => {
    const late = deferred<unknown>(); let reply: unknown;
    const { session, store } = await setup({ deadlineMs: 100, interpreter: async binding => { reply = proposalFor(binding, true); return late.promise; } });
    await session.commitClosedSpan(closedSpan()); const before = structuredClone(session.runtime.replay);
    await vi.advanceTimersByTimeAsync(100); await finish(session);
    expect(session.health.error).toBe("core-provider-timeout"); expect(session.runtime.replay).toEqual(before);
    late.resolve(reply); await Promise.resolve(); expect(store.events).toEqual(before.events); expect(session.health.pendingCount).toBe(1);
  });
  it("explicit cancel retains evidence and requires resume", async () => {
    const wait = deferred<unknown>(); let calls = 0;
    const { session } = await setup({ interpreter: async binding => ++calls === 1 ? wait.promise : proposalFor(binding) });
    await session.commitClosedSpan(closedSpan()); session.cancel(); await finish(session);
    expect(session.health).toMatchObject({ pendingCount: 1, inFlight: false, paused: true });
    await vi.advanceTimersByTimeAsync(60_000); expect(calls).toBe(1);
    session.resume(); await finish(session); expect(session.health.pendingCount).toBe(0);
    wait.reject(new Error("late failure")); await Promise.resolve();
  });
  it("stale speech run/result never accepts or consumes the old flight", async () => {
    const wait = deferred<unknown>(); let stale: unknown; let calls = 0;
    const { session } = await setup({ interpreter: async binding => {
      if (++calls === 1) { stale = proposalFor(binding, true); return wait.promise; }
      return proposalFor(binding);
    } });
    await session.commitClosedSpan(closedSpan()); session.setSpeechRun("run-2"); await finish(session);
    expect(calls).toBe(2); expect(session.state.knowledge.revision).toBe(0); expect(session.health.pendingCount).toBe(0);
    wait.resolve(stale); await Promise.resolve(); expect(session.state.knowledge.revision).toBe(0);
    await expect(session.commitClosedSpan(closedSpan("stale"), "run-1")).rejects.toThrow("stale-speech-run");
  });
  it("NEEDS_CONTEXT pauses without consuming and resume reconstructs bounded context", async () => {
    let calls = 0; const unresolved: unknown[] = [];
    const { session, store } = await setup({ interpreter: async binding => {
      unresolved.push(binding.context.unresolved);
      return ++calls === 1 ? { outcome: { kind: "NEEDS_CONTEXT", evidence: ["e0"], query: "Synthetic" } } : proposalFor(binding);
    } });
    await session.commitClosedSpan(closedSpan()); const before = structuredClone(store.events); await finish(session);
    expect(session.health).toMatchObject({ paused: true, pendingCount: 1, error: "core-needs-context" });
    expect(store.events).toEqual(before);
    await session.commitClosedSpan(closedSpan("s2")); await vi.advanceTimersByTimeAsync(60_000); expect(calls).toBe(1);
    session.resume(); await finish(session);
    expect(unresolved[1]).toEqual([{ evidence: "e0", phrase: "Synthetic" }]); expect(session.health.pendingCount).toBe(0);
  });
  it("mandatory context closure failure never starts a provider or consumes evidence", async () => {
    const interpreter = vi.fn(); const { session, traces } = await setup({ interpreter, contextOptions: () => ({ budgets: { maxCharacters: 1 } }) });
    await session.commitClosedSpan(closedSpan());
    expect(interpreter).not.toHaveBeenCalled(); expect(session.health).toMatchObject({ pendingCount: 1, paused: true });
    expect(traces.some(t => t.type === "core.context_blocked")).toBe(true);
  });
  it("store failure/abort never settles scheduler acceptance; provider timeout stops before persistence", async () => {
    const { session, store } = await setup({ deadlineMs: 100 });
    const wait = deferred(); store.beforeAppend = async events => { if (events[0]?.type === "core.step_accepted") await wait.promise; };
    await session.commitClosedSpan(closedSpan());
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);
    expect(session.health.inFlight).toBe(true); expect(session.health.pendingCount).toBe(1); expect(session.state.knowledge.revision).toBe(0);
    session.cancel(); wait.resolve(); await finish(session);
    expect(session.health.pendingCount).toBe(1); expect(session.state.knowledge.revision).toBe(0);
    store.beforeAppend = undefined; session.resume(); await finish(session); expect(session.health.pendingCount).toBe(0);
  });
  it("diagnostic listener throws cannot change semantic acceptance", async () => {
    const { session } = await setup({ trace: () => { throw new Error("trace-broken"); } });
    await session.commitClosedSpan(closedSpan()); await finish(session); expect(session.health.pendingCount).toBe(0);
  });
});

describe("verification outside the semantic critical path", () => {
  it.each([false, true])("accepted proposal with verification=%s leaves no semantic pending side work", async sidecar => {
    const wait = deferred(); const sink = vi.fn(() => wait.promise);
    const { session, store } = await setup({ interpreter: async binding => proposalFor(binding, true, sidecar), verificationSink: sink });
    await session.commitClosedSpan(closedSpan()); await finish(session); await vi.advanceTimersByTimeAsync(0);
    expect(session.health.pendingCount).toBe(0); expect(session.health.inFlight).toBe(false);
    expect(sink).toHaveBeenCalledTimes(sidecar ? 1 : 0);
    const before = structuredClone(store.events);
    await session.commitClosedSpan(closedSpan("next")); await finish(session);
    expect(session.state.processedThroughSequence).toBe(2);
    expect(before.some(e => e.type === "core.step_accepted")).toBe(true);
    expect(JSON.stringify(store.events)).not.toContain("Investigation lead only");
    if (sidecar) wait.reject(new Error("sink-failed")); else wait.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.state.processedThroughSequence).toBe(2); expect(session.health.pendingCount).toBe(0);
  });
  it("drops malformed/ungrounded sidecars without rolling back valid steps", async () => {
    const sink = vi.fn(async () => undefined);
    const { session, traces } = await setup({ verificationSink: sink, interpreter: async binding => {
      const proposal = proposalFor(binding, true); if (proposal.outcome.kind === "PROPOSE") proposal.outcome.verificationRequests = [{ nonsense: true }, { evidence: ["e0"], query: "not spoken", claim: "claim", candidateEvidence: "lead" }]; return proposal;
    } });
    await session.commitClosedSpan(closedSpan()); await finish(session); await vi.advanceTimersByTimeAsync(0);
    expect(session.health.pendingCount).toBe(0); expect(sink).not.toHaveBeenCalled();
    expect(traces.filter(t => t.type === "core.verification_dropped")).toHaveLength(2);
  });
  it("never enqueues verification before durable semantic persistence", async () => {
    const sink = vi.fn(async () => undefined), wait = deferred();
    const { session, store } = await setup({ verificationSink: sink, interpreter: async b => proposalFor(b, true, true) });
    store.beforeAppend = async events => { if (events[0]?.type === "core.step_accepted") await wait.promise; };
    await session.commitClosedSpan(closedSpan()); await vi.advanceTimersByTimeAsync(0);
    expect(sink).not.toHaveBeenCalled(); expect(session.health.pendingCount).toBe(1);
    wait.reject(new Error("append-failure")); await finish(session); expect(sink).not.toHaveBeenCalled();
  });
});

describe("Core lesson finalization and restoration", () => {
  it("ends with no pending semantic work", async () => {
    const { session } = await setup(); expect(await session.finalize()).toBe(true); expect(session.runtime.replay.ended).toBe(true);
  });
  it("drains committed evidence and a final closed speech tail before ending", async () => {
    const wait = deferred<unknown>(); let reply: unknown;
    const { session, store } = await setup({ interpreter: async binding => { if (!reply) { reply = proposalFor(binding); return wait.promise; } return proposalFor(binding); } });
    await session.commitClosedSpan(closedSpan("first")); await session.commitClosedSpan(closedSpan("pending"));
    const ended = session.finalize([closedSpan("tail")]);
    expect(session.runtime.replay.ended).toBe(false);
    await expect(session.commitClosedSpan(closedSpan("too-late"))).rejects.toThrow("not-capturing");
    wait.resolve(reply); await vi.advanceTimersByTimeAsync(25);
    expect(await ended).toBe(true); expect(session.state.processedThroughSequence).toBe(3);
    expect(store.events.at(-1)?.type).toBe("lesson.ended"); expect(replayCoreEvents(store.events)).toEqual(session.runtime.replay);
  });
  it("semantic drain failure does not write lesson.ended and reload resumes pending evidence", async () => {
    const { session, store } = await setup({ finalizationMs: 100, interpreter: async () => { throw new Error("transport"); } });
    await session.commitClosedSpan(closedSpan()); await finish(session);
    const ended = session.finalize(); await vi.advanceTimersByTimeAsync(100); expect(await ended).toBe(false);
    expect(store.events.at(-1)?.type).toBe("evidence.checkpoint_committed"); session.close();
    const restored = await CoreLiveSession.open({ sessionId: session.runtime.sessionId, lessonDomain: "core", store, speechRunId: "run-1", interpreter: async b => proposalFor(b) });
    sessions.push(restored); await finish(restored); expect(restored.state.processedThroughSequence).toBe(1); expect(await restored.finalize()).toBe(true);
  });
  it("unresolved verification cannot delay semantic finalization", async () => {
    const { session, traces } = await setup({ interpreter: async b => proposalFor(b, true, true), verificationSink: () => new Promise(() => undefined) });
    await session.commitClosedSpan(closedSpan()); await finish(session); await vi.advanceTimersByTimeAsync(0);
    expect(session.verification.pendingCount).toBe(1);
    expect(await session.finalize()).toBe(true); await vi.advanceTimersByTimeAsync(0);
    expect(traces.some(t => t.type === "core.verification" && t.payload.status === "cancelled")).toBe(true);
    expect(session.health.pendingCount).toBe(0);
  });
  it("request identities remain distinct after restoring the same speech run", async () => {
    const { session, store } = await setup(); await session.commitClosedSpan(closedSpan()); await finish(session); session.close();
    const restored = await CoreLiveSession.open({ sessionId: session.runtime.sessionId, lessonDomain: "core", store, speechRunId: "run-1", interpreter: async b => proposalFor(b, true) });
    sessions.push(restored); await restored.commitClosedSpan(closedSpan("next")); await finish(restored);
    const requests = store.events.flatMap(e => e.type === "core.step_accepted" ? [e.step.requestId] : []);
    expect(new Set(requests).size).toBe(2); expect(restored.state.processedThroughSequence).toBe(2);
  });
});

it("classifies an in-flight Cue read after expiry as a retryable channel conflict", async () => {
  const wait = deferred<unknown>(); let reply: unknown; let calls = 0;
  const { session, traces } = await setup({ interpreter: async binding => {
    calls++;
    if (calls === 1) return addCue(proposalFor(binding));
    const proposal = proposalFor(binding, true);
    if (calls === 2) {
      proposedStep(proposal).readRefs = [{ existing: binding.context.cue.active! }]; reply = proposal; return wait.promise;
    }
    return proposal;
  } });
  await session.commitClosedSpan(closedSpan()); await finish(session);
  await session.commitClosedSpan(closedSpan("second"));
  await session.runtime.expireCue(session.state.cue.active!.id, session.state.cue.revision);
  wait.resolve(reply); await finish(session);
  expect(traces.some(t => t.type === "core.request_failed" && t.payload.category === "conflict" && t.payload.reason === "core-cue-conflict")).toBe(true);
  expect(session.health.pendingCount).toBe(1); expect(session.health.paused).toBe(false);
  await vi.advanceTimersByTimeAsync(0); await finish(session);
  expect(session.health.pendingCount).toBe(0); expect(session.state.cue.active).toBeUndefined();
});

it("reconciles a stale result with another durable Core acceptance without reopening evidence", async () => {
  const wait = deferred<unknown>(); let binding: Parameters<NonNullable<CoreLiveOptions["interpreter"]>>[0] | undefined;
  const { session } = await setup({ interpreter: async request => { binding = request; return wait.promise; } });
  await session.commitClosedSpan(closedSpan());
  for (let i = 0; i < 10 && !binding; i++) await Promise.resolve();
  await session.runtime.acceptProposal({ ...binding!, requestId: "other-authorized-core-writer" }, proposalFor(binding!, true));
  const before = structuredClone(session.state);
  wait.resolve(proposalFor(binding!, true)); await finish(session);
  expect(session.state).toEqual(before); expect(session.health.pendingCount).toBe(0);
});

it("parks earlier knowledge and refocuses the same Core through subsequent live context", async () => {
  let turn = 0;
  const { session, store } = await setup({ interpreter: async binding => {
    const proposal = proposalFor(binding, ++turn < 3), step = proposedStep(proposal);
    if (turn < 3) {
      const op = step.knowledgeOps[1]!;
      if ("value" in op) op.value.text = turn === 1 ? "Activation energy barrier" : "Entropy distribution";
    } else {
      const candidate = binding.context.candidates[0];
      expect(candidate).toBeDefined();
      step.knowledgeOps = [{ action: "SET_CURRENT_CORE", core: { existing: candidate! } },
        { action: "ADD_OBJECT", core: { existing: candidate! }, as: "extension", value: { text: "Continue the activation barrier mainline", provenance: { speech: ["e0"], state: [], domain: null } } }];
    }
    return proposal;
  } });
  await session.commitClosedSpan(closedSpan("first", "Activation energy barrier")); await finish(session);
  const firstId = session.state.knowledge.currentCoreId!;
  await session.commitClosedSpan(closedSpan("second", "Entropy distribution")); await finish(session);
  expect(session.state.knowledge.currentCoreId).not.toBe(firstId); expect(session.state.knowledge.cores[firstId]).toBeDefined();
  await session.commitClosedSpan(closedSpan("third", "Return to activation energy barrier")); await finish(session);
  expect(session.state.knowledge.currentCoreId).toBe(firstId); expect(Object.keys(session.state.knowledge.cores)).toHaveLength(2);
  expect(Object.keys(session.state.knowledge.cores[firstId]!.objects)).toHaveLength(3);
  expect(replayCoreEvents(store.events).state).toEqual(session.state);
});
