import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTraceDraft } from "../../trace/contracts.ts";
import { CoreLiveSession, type CoreLiveOptions } from "./live-session.ts";
import { closedSpan, deferred, MemoryCoreStore, proposalFor, proposedStep } from "./live-test-fixtures.ts";
import { buildCoreInterpretationContext, historicalSources } from "./interpretation-context.ts";
import type { CoreInterpretationBinding } from "./interpretation-context.ts";
import { SessionIndexes } from "./session-indexes.ts";
import { replayCoreEvents } from "./replay.ts";
import type { LiveDecision, SessionTask } from "./session-processing.ts";
import { CoreLessonStreamRuntime } from "./runtime.ts";
import { acceptCoreStep } from "./accepted-steps.ts";
import { evidence, fact, foundation, stepFor } from "./test-fixtures.ts";

const sessions: CoreLiveSession[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-10T00:00:00Z")); });
afterEach(() => { sessions.forEach(s => s.close()); sessions.length = 0; vi.useRealTimers(); });
async function open(options: Partial<CoreLiveOptions> = {}) {
  const store = options.store ?? new MemoryCoreStore(), traces: SessionTraceDraft[] = [];
  const session = await CoreLiveSession.open({ sessionId: "foundation", lessonDomain: "core", speechRunId: "run", store,
    interpreter: async b => proposalFor(b), trace: t => traces.push(t), ...options });
  sessions.push(session); return { session, store: store as MemoryCoreStore, traces };
}
const fragment = (id: string, text = `fragment ${id}`) => ({ ...closedSpan(id, text), closeReason: "max_duration" as const });
async function settle(session: CoreLiveSession) { for (let i = 0; i < 20; i++) { if (!session.currentAttempt) return; await session.currentAttempt; } throw Error("unexpected work"); }
function explicit(binding: CoreInterpretationBinding, processing: Partial<LiveDecision> = {}, grow = false) {
  return { version: "session-live-result-v1", proposal: proposalFor(binding, grow), processing: { deferred: [], resolvedObligationIds: [], reviewRequired: false, ...processing } };
}

describe("bounded Live scheduling", () => {
  it("coalesces a contiguous prefix after a quiet opportunity, without one job per checkpoint", async () => {
    const calls: string[][] = [];
    const { session } = await open({ interpreter: async b => { calls.push(b.newEvidenceIds); return proposalFor(b); } });
    for (let i = 0; i < 3; i++) { await session.commitClosedSpan(fragment(`${i}`)); await vi.advanceTimersByTimeAsync(100); }
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(149); expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); await settle(session);
    expect(calls).toEqual([session.runtime.replay.checkpoints.map(c => c.checkpointId)]);
    expect(session.state.processedThroughSequence).toBe(3);
  });
  it("uses an independent max wait while continuous arrivals reset the short delay", async () => {
    const starts: number[] = [];
    const { session, traces } = await open({ scheduling: { maxCheckpoints: 16 }, interpreter: async b => { starts.push(Date.now()); return proposalFor(b); } });
    const start = Date.now();
    for (let i = 0; i < 7; i++) { await session.commitClosedSpan(fragment(`${i}`)); await vi.advanceTimersByTimeAsync(100); }
    expect(starts).toEqual([]);
    await vi.advanceTimersByTimeAsync(50);
    expect(starts).toEqual([start + 750]);
    expect(traces.some(t => t.type === "core.request" && t.payload.dispatchReason === "max_wait")).toBe(true);
  });
  it("does not add a delay for a completed canonical boundary", async () => {
    const interpreter = vi.fn(async (b: CoreInterpretationBinding) => proposalFor(b));
    const { session } = await open({ interpreter });
    await session.commitClosedSpan(fragment("a")); await session.commitClosedSpan(closedSpan("b"));
    await settle(session); expect(interpreter).toHaveBeenCalledOnce();
    expect(interpreter.mock.calls[0]![0].newEvidenceIds).toHaveLength(2);
  });
  it("accumulates immutable ordered evidence during a flight and selects the next batch after settlement", async () => {
    const wait = deferred<unknown>(), calls: CoreInterpretationBinding[] = []; let signal: AbortSignal | undefined;
    const { session } = await open({ interpreter: async (b, options) => { calls.push(b); signal = options.signal; return calls.length === 1 ? wait.promise : proposalFor(b); } });
    await session.commitClosedSpan(closedSpan("first"));
    for (let i = 0; i < 5; i++) await session.commitClosedSpan(fragment(`${i}`));
    await vi.advanceTimersByTimeAsync(900);
    expect(calls).toHaveLength(1); expect(signal?.aborted).toBe(false);
    expect(calls[0]!.newEvidenceIds).toHaveLength(1);
    wait.resolve(proposalFor(calls[0]!)); await settle(session);
    expect(calls.map(c => c.newEvidenceIds.length)).toEqual([1, 5]);
    expect(calls.flatMap(c => c.newEvidenceIds)).toEqual(session.runtime.replay.checkpoints.map(c => c.checkpointId));
  });
  it("sustained fake service coalesces faster arrivals, progresses during input and loses nothing", async () => {
    const batches: number[][] = [], started: number[] = []; let peak = 0;
    const { session, traces } = await open({ scheduling: { maxCheckpoints: 16 }, interpreter: async b => {
      batches.push(b.context.evidence.filter(e => e.consumption === "new").map(e => e.sequence)); started.push(Date.now());
      await new Promise(resolve => setTimeout(resolve, 900)); return proposalFor(b);
    } });
    for (let i = 0; i < 120; i++) {
      await session.commitClosedSpan(fragment(`${i}`)); peak = Math.max(peak, session.health.pendingCount);
      await vi.advanceTimersByTimeAsync(100);
    }
    const processedDuringInput = session.state.processedThroughSequence;
    await vi.advanceTimersByTimeAsync(3_000); await settle(session);
    expect(processedDuringInput).toBeGreaterThan(90);
    expect(batches.length).toBeLessThan(20); expect(Math.max(...batches.map(b => b.length))).toBeLessThanOrEqual(16);
    expect(batches.flat()).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
    expect(peak).toBeLessThanOrEqual(18); expect(session.health.pendingCount).toBe(0);
    expect(started.length).toBeGreaterThan(10);
    expect(traces.some(t => t.type === "core.request" && t.payload.dispatchReason === "max_wait")).toBe(true);
    // This is a deterministic scheduler workload, not a provider throughput measurement.
  });
});

describe("durable processing and unresolved meaning", () => {
  it("completes a proposition across three committed fragments and reload, retaining original provenance", async () => {
    let turn = 0;
    const interpreter: CoreLiveOptions["interpreter"] = async b => {
      if (++turn < 3) return explicit(b, { deferred: b.newEvidenceIds.map(checkpointId => ({ checkpointId,
        phrase: [...b.evidence.values()].find(c => c.checkpointId === checkpointId)!.text })), reviewRequired: true });
      expect(b.context.unresolved.map(u => u.phrase)).toEqual(["Solids...", "have a fixed..."]);
      const result = explicit(b, { resolvedObligationIds: b.context.unresolved.map(u => b.evidence.get(u.evidence)!.checkpointId) });
      const step = proposedStep(result.proposal), p = { speech: b.context.evidence.map(e => e.handle), state: [], domain: null };
      step.knowledgeOps = [{ action: "CREATE_CORE", as: "solids", provenance: p },
        { action: "ADD_OBJECT", core: { created: "solids" }, as: "fact", value: { text: "Solids have a fixed shape and volume.", provenance: p } },
        { action: "SET_CURRENT_CORE", core: { created: "solids" } }];
      return result;
    };
    const first = await open({ interpreter });
    const original = await first.session.commitClosedSpan(closedSpan("1", "Solids...")); await settle(first.session);
    expect(first.session.runtime.replay.dispositions.get(original!.checkpointId)?.kind).toBe("deferred_unresolved");
    expect(first.session.health.pendingCount).toBe(0); first.session.close();
    const { session } = await open({ interpreter, store: first.store });
    expect(session.coordinator.window.unresolved).toEqual([{ checkpointId: original!.checkpointId, phrase: "Solids..." }]);
    await session.commitClosedSpan(closedSpan("2", "have a fixed...")); await settle(session);
    await session.commitClosedSpan(closedSpan("3", "shape and volume.")); await settle(session);
    const core = Object.values(session.state.knowledge.cores)[0]!;
    const object = Object.values(core.objects)[0]!;
    expect(object.value.text).toBe("Solids have a fixed shape and volume.");
    expect(object.value.provenance.speechRefs.map(r => r.checkpointId).sort()).toEqual(session.runtime.replay.checkpoints.map(c => c.checkpointId).sort());
    expect(session.runtime.replay.unresolved.size).toBe(0);
    expect(session.runtime.replay.checkpoints[0]).toEqual(original);
    expect(replayCoreEvents(first.store.events)).toEqual(session.runtime.replay);
  });
  it.each(["A complete proposition.", "Complete statement without punctuation", "Solids..."])("does not infer unresolved obligations from text: %s", async text => {
    const { session } = await open(); await session.commitClosedSpan(closedSpan("a", text)); await settle(session);
    expect([...session.runtime.replay.dispositions.values()].map(d => d.kind)).toEqual(["resolved_no_change"]);
    expect(session.runtime.replay.unresolved.size).toBe(0);
    const step = session.runtime.events.find(e => e.type === "core.step_accepted");
    expect(step?.type === "core.step_accepted" && step.step.liveProcessing?.adapter).toBe("legacy-propose");
  });
  it("keeps explicit deliberate no-change distinct from deferred processing", async () => {
    let count = 0;
    const { session } = await open({ interpreter: async b => explicit(b, ++count === 1 ? {} : { deferred: [{ checkpointId: b.newEvidenceIds[0]!, phrase: "unfinished" }] }) });
    await session.commitClosedSpan(closedSpan("1", "Already accounted for")); await settle(session);
    await session.commitClosedSpan(closedSpan("2", "unfinished")); await settle(session);
    expect([...session.runtime.replay.dispositions.values()].map(d => d.kind)).toEqual(["resolved_no_change", "deferred_unresolved"]);
  });
  it("persists consumption, deferred obligations and future review in one atomic batch before publishing", async () => {
    const wait = deferred();
    const { session, store } = await open({ interpreter: async b => explicit(b, { deferred: [{ checkpointId: b.newEvidenceIds[0]!, phrase: "unfinished" }], reviewRequired: true }) });
    store.beforeAppend = async events => { if (events[0]?.type === "core.step_accepted") {
      expect(events[0].step.liveProcessing?.dispositions[0]?.kind).toBe("deferred_unresolved"); await wait.promise;
    } };
    await session.commitClosedSpan(closedSpan("1", "unfinished")); await vi.advanceTimersByTimeAsync(0);
    expect(session.runtime.replay.unresolved.size).toBe(0); expect(session.state.processedThroughSequence).toBe(0);
    const crash = await CoreLessonStreamRuntime.open("foundation", store);
    expect(crash.pending).toHaveLength(1); crash.close();
    wait.resolve(); await settle(session);
    expect(session.state.processedThroughSequence).toBe(1); expect(session.runtime.replay.unresolved.size).toBe(1);
    expect(session.runtime.replay.reviews.size).toBe(1);
  });
  it("failed disposition persistence retains pending evidence and creates no memory-only obligation", async () => {
    const { session, store } = await open({ interpreter: async b => explicit(b, { deferred: [{ checkpointId: b.newEvidenceIds[0]!, phrase: "unfinished" }] }) });
    store.beforeAppend = async events => { if (events[0]?.type === "core.step_accepted") throw Error("disk failure"); };
    await session.commitClosedSpan(closedSpan("1", "unfinished")); await settle(session);
    expect(session.health.pendingCount).toBe(1); expect(session.runtime.replay.unresolved.size).toBe(0);
    store.beforeAppend = undefined; session.resume(); await settle(session);
    expect(session.runtime.replay.unresolved.size).toBe(1);
  });
  it("rejects ungrounded defer and unavailable resolution before any accepted write", async () => {
    const { session, store } = await open({ interpreter: async b => explicit(b, { deferred: [{ checkpointId: b.newEvidenceIds[0]!, phrase: "invented" }] }) });
    await session.commitClosedSpan(closedSpan("1", "actual")); await settle(session);
    expect(session.health.pendingCount).toBe(1); expect(session.health.paused).toBe(true); expect(store.events).toHaveLength(2);
    expect(session.state.processedThroughSequence).toBe(0);
  });
});

describe("identity, retry and crash recovery", () => {
  it("deduplicates same-ID retransmission but preserves repeated teacher words with a new ID", async () => {
    const { session } = await open();
    const a = closedSpan("a", "Repeated wording"), b = closedSpan("b", "Repeated wording");
    await session.commitClosedSpan(a); await settle(session);
    await session.commitClosedSpan(a); await session.commitClosedSpan(b); await settle(session);
    expect(session.runtime.replay.checkpoints.map(c => c.text)).toEqual([a.text, b.text]);
    expect(session.state.processedThroughSequence).toBe(2);
  });
  it("retries the same fixed prefix and request identity without manufacturing entities", async () => {
    const calls: CoreInterpretationBinding[] = [];
    const { session } = await open({ interpreter: async b => { calls.push(b); if (calls.length === 1) throw Error("transport"); return proposalFor(b, true); } });
    await session.commitClosedSpan(closedSpan("a")); await settle(session);
    await session.commitClosedSpan(fragment("b"));
    await vi.advanceTimersByTimeAsync(1_000); await settle(session);
    expect(calls[1]!.requestId).toBe(calls[0]!.requestId);
    expect(calls[1]!.newEvidenceIds).toEqual(calls[0]!.newEvidenceIds);
    expect(session.state.processedThroughSequence).toBe(2);
    expect(Object.keys(session.state.knowledge.cores)).toHaveLength(2);
    expect(session.runtime.replay.consumedCheckpointIds.size).toBe(2);
  });
  it("resolves lost durable acknowledgement without duplicate semantic or evidence consumption", async () => {
    const { session, store } = await open({ interpreter: async b => proposalFor(b, true) });
    const append = store.append.bind(store); let lost = false;
    store.append = async (events, signal) => { await append(events, signal); if (events[0]?.type === "core.step_accepted" && !lost) { lost = true; throw Error("lost ack"); } };
    await session.commitClosedSpan(closedSpan("a")); await settle(session); session.resume(); await settle(session);
    expect(session.state.processedThroughSequence).toBe(1); expect(Object.keys(session.state.knowledge.cores)).toHaveLength(1);
    expect(store.events.filter(e => e.type === "core.step_accepted")).toHaveLength(1);
    expect(replayCoreEvents(store.events)).toEqual(session.runtime.replay);
  });
  it("rebuilds pending range from committed records without a Window snapshot or trace", async () => {
    const first = await open(); await first.session.commitClosedSpan(fragment("a")); await first.session.commitClosedSpan(fragment("b")); first.session.close();
    expect(first.store.events.map(e => e.type)).toEqual(["lesson.started", "evidence.checkpoint_committed", "evidence.checkpoint_committed"]);
    const { session } = await open({ store: first.store, trace: () => { throw Error("no trace"); } });
    expect(session.coordinator.window.pendingCheckpointIds).toEqual(session.runtime.replay.checkpoints.map(c => c.checkpointId));
    await vi.advanceTimersByTimeAsync(750); await settle(session); expect(session.state.processedThroughSequence).toBe(2);
  });
});

describe("finalization", () => {
  it("records the complete tail, terminal Live dispositions and incomplete review before sealing, preserving unresolved debt", async () => {
    const { session, store } = await open({ interpreter: async b => explicit(b, { deferred: b.newEvidenceIds.map(checkpointId => ({ checkpointId,
      phrase: [...b.evidence.values()].find(c => c.checkpointId === checkpointId)!.text })), reviewRequired: true }) });
    await session.commitClosedSpan(fragment("first", "Solids"));
    const closing = session.finalize([fragment("tail-1", "have a fixed"), fragment("tail-2", "shape")]);
    await vi.advanceTimersByTimeAsync(25); expect(await closing).toBe(true);
    expect(session.state.processedThroughSequence).toBe(3); expect(session.runtime.replay.unresolved.size).toBe(3);
    expect([...session.runtime.replay.reviews.values()].every(r => r.status === "incomplete")).toBe(true);
    expect(session.runtime.replay.reviews.size).toBeGreaterThan(0);
    expect(store.events.at(-1)?.type).toBe("lesson.ended");
    const replay = replayCoreEvents(store.events); expect(replay).toEqual(session.runtime.replay);
    session.close(); const { session: restored } = await open({ store });
    expect(restored.coordinator.window.unresolved).toHaveLength(3); expect(restored.coordinator.window.sealed).toBe(true);
    await expect(restored.commitClosedSpan(closedSpan("late"))).rejects.toThrow();
    const late = buildCoreInterpretationContext({ ...replay, state: { ...replay.state, processedThroughSequence: 0 } }, { requestId: "late", newEvidence: replay.checkpoints });
    await expect(restored.runtime.acceptProposal(late, proposalFor(late))).rejects.toThrow("core-lesson-ended");
    const stage: SessionTask = { lane: "STAGE", taskId: "future", reviewSnapshot: { eventId: store.events.at(-1)!.eventId,
      throughSequence: 3, knowledgeRevision: 0, cueRevision: 0 }, obligationIds: [...replay.reviews.keys()] };
    expect("checkpointIds" in stage).toBe(false); // Fixed review snapshot is not new evidence consumption.
  });
});

describe("disposable historical indexes", () => {
  it("preserves old same-ID provenance values and matches a full rebuild", () => {
    const f = foundation(), old = f.replay, indexes = new SessionIndexes().sync(old);
    let revised = evidence(old), step = stepFor(revised);
    step.knowledgeOps = [{ action: "REVISE_OBJECT", coreId: f.coreId, id: f.a, value: fact(step.consumesCheckpointIds[0]!, "Changed definition") }];
    revised = acceptCoreStep(revised, step).replay; indexes.sync(revised);
    const sources = historicalSources(revised, indexes), ref = { kind: "OBJECT" as const, coreId: f.coreId, id: f.a };
    expect(sources.resolve(ref, old.state.knowledge.revision)).toEqual(old.state.knowledge.cores[f.coreId]!.objects[f.a]);
    expect(sources.resolve(ref, revised.state.knowledge.revision)).not.toEqual(sources.resolve(ref, old.state.knowledge.revision));
    const rebuilt = new SessionIndexes().sync(replayCoreEvents(revised.events));
    expect(rebuilt.knowledge).toEqual(indexes.knowledge); expect(rebuilt.cue).toEqual(indexes.cue); expect(rebuilt.checkpoints).toEqual(indexes.checkpoints);
  });
  it("visits only appended events across repeated context previews as history grows", async () => {
    const { session } = await open();
    for (let i = 0; i < 60; i++) { await session.commitClosedSpan(closedSpan(`${i}`)); await settle(session); }
    await session.commitClosedSpan(fragment("pending"));
    const indexes = session.runtime.indexes, visits = indexes.eventsVisited;
    for (let i = 0; i < 20; i++) buildCoreInterpretationContext(session.runtime.replay, { requestId: `${i}`, newEvidence: session.runtime.pending, indexes });
    expect(indexes.eventsVisited).toBe(visits); expect(visits).toBe(session.runtime.events.length); expect(indexes.rebuilds).toBe(1);
    const replay = replayCoreEvents(session.runtime.events);
    const rebuilt = buildCoreInterpretationContext(replay, { requestId: "same", newEvidence: session.runtime.pending });
    const incremental = buildCoreInterpretationContext(session.runtime.replay, { requestId: "same", newEvidence: session.runtime.pending, indexes });
    expect(incremental.context).toEqual(rebuilt.context); expect(incremental.entities).toEqual(rebuilt.entities);
  });
});

it("labels an accepted operation with no actual revision change as resolved no-change", () => {
  const f = foundation(), base = evidence(f.replay), step = stepFor(base);
  step.knowledgeOps = [{ action: "SET_CURRENT_CORE", coreId: f.coreId }];
  step.liveProcessing = { version: "session-live-processing-v1", adapter: "explicit", resolvedObligationIds: [],
    dispositions: step.consumesCheckpointIds.map(checkpointId => ({ checkpointId, kind: "resolved_no_change" })) };
  const accepted = acceptCoreStep(base, step).replay;
  expect(accepted.state.knowledge.revision).toBe(base.state.knowledge.revision);
  expect(accepted.dispositions.get(step.consumesCheckpointIds[0]!)?.kind).toBe("resolved_no_change");
});

it("reload resolves a committed result even when both its acknowledgement and recovery read are unavailable", async () => {
  const { session, store } = await open({ interpreter: async b => explicit(b, { deferred: [{ checkpointId: b.newEvidenceIds[0]!, phrase: "unfinished" }] }, true) });
  const append = store.append.bind(store), read = store.readSession.bind(store);
  store.append = async (events, signal) => {
    await append(events, signal);
    if (events[0]?.type === "core.step_accepted") {
      store.readSession = async () => { throw Error("temporarily unavailable"); };
      throw Error("ack lost");
    }
  };
  await session.commitClosedSpan(closedSpan("a", "unfinished")); await settle(session);
  expect(session.health.pendingCount).toBe(1); session.close();
  store.readSession = read;
  const interpreter = vi.fn(async (b: CoreInterpretationBinding) => proposalFor(b, true));
  const restored = await open({ store, interpreter });
  expect(interpreter).not.toHaveBeenCalled(); expect(restored.session.health.pendingCount).toBe(0);
  expect(restored.session.runtime.replay.unresolved.size).toBe(1);
  expect(Object.keys(restored.session.state.knowledge.cores)).toHaveLength(1);
  expect(store.events.filter(e => e.type === "core.step_accepted")).toHaveLength(1);
});

it("keeps an old unresolved obligation addressable beyond the recent-evidence window", async () => {
  let turn = 0, oldId = "";
  const { session } = await open({ interpreter: async b => {
    if (++turn === 1) { oldId = b.newEvidenceIds[0]!; return explicit(b, { deferred: [{ checkpointId: oldId, phrase: "unfinished" }] }); }
    if (turn < 12) return proposalFor(b);
    expect(b.context.unresolved).toHaveLength(1);
    expect(b.evidence.get(b.context.unresolved[0]!.evidence)?.checkpointId).toBe(oldId);
    expect(b.context.evidence.find(e => e.handle === b.context.unresolved[0]!.evidence)?.consumption).toBe("history");
    return explicit(b, { resolvedObligationIds: [oldId] });
  } });
  await session.commitClosedSpan(closedSpan("0", "unfinished")); await settle(session);
  for (let i = 1; i <= 11; i++) { await session.commitClosedSpan(closedSpan(`${i}`, "Deliberately no new meaning")); await settle(session); }
  expect(session.runtime.replay.unresolved.size).toBe(0);
  expect(session.runtime.replay.dispositions.get(oldId)?.kind).toBe("deferred_unresolved");
  expect(session.runtime.replay.consumedCheckpointIds.size).toBe(12);
});

it("restores bounded coalescing if an incomplete close returns to capture", async () => {
  let calls = 0;
  const { session } = await open({ finalizationMs: 50, interpreter: async b => {
    if (++calls === 1) throw Error("transport"); return proposalFor(b);
  } });
  await session.commitClosedSpan(closedSpan("first")); await settle(session);
  const end = session.finalize(); await vi.advanceTimersByTimeAsync(50); expect(await end).toBe(false);
  session.resume(); await settle(session); expect(calls).toBe(2);
  await session.commitClosedSpan(fragment("next")); await vi.advanceTimersByTimeAsync(249); expect(calls).toBe(2);
  await vi.advanceTimersByTimeAsync(1); await settle(session); expect(calls).toBe(3);
});

it("keeps the context preview and dispatched prefix identical when the token cap shortens a batch", async () => {
  const calls: string[][] = [];
  const { session } = await open({ interpreter: async b => { calls.push(b.newEvidenceIds); return proposalFor(b); } });
  const first = await session.commitClosedSpan(fragment("large-1", "A ".repeat(4_000)));
  const second = await session.commitClosedSpan(fragment("large-2", "B ".repeat(4_000)));
  await vi.advanceTimersByTimeAsync(250); await settle(session);
  expect(calls).toEqual([[first!.checkpointId], [second!.checkpointId]]);
  expect(session.state.processedThroughSequence).toBe(2);
});
