import { describe, expect, it, vi } from "vitest";
import { buildCoreInterpretationContext } from "./interpretation-context.ts";
import { replayCoreEvents } from "./replay.ts";
import { CoreLessonStreamRuntime } from "./runtime.ts";
import { addCue, closedSpan, deferred, MemoryCoreStore, proposalFor, proposedStep } from "./live-test-fixtures.ts";

async function setup() {
  const store = new MemoryCoreStore();
  const runtime = await CoreLessonStreamRuntime.open("runtime-test", store);
  await runtime.start(); await runtime.commitClosedSpan(closedSpan(), "run-1");
  const binding = buildCoreInterpretationContext(runtime.replay, { requestId: "request-1", newEvidence: runtime.pending });
  return { store, runtime, binding };
}

describe("Core persistence/publication", () => {
  it("publishes one complete multi-operation batch only after append, and replays exactly", async () => {
    const { store, runtime, binding } = await setup();
    const wait = deferred(); store.beforeAppend = () => wait.promise;
    const states: unknown[] = []; runtime.subscribe(() => states.push(structuredClone(runtime.state)));
    const before = structuredClone(runtime.replay);
    const accepted = runtime.acceptProposal(binding, addCue(proposalFor(binding, true), "RELATION"));
    await Promise.resolve();
    expect(runtime.replay).toEqual(before); expect(states).toEqual([]);
    wait.resolve(); await accepted;
    expect(states).toHaveLength(1);
    const core = Object.values(runtime.state.knowledge.cores)[0]!;
    expect(Object.keys(core.objects)).toHaveLength(2); expect(Object.keys(core.relations)).toHaveLength(1);
    expect(runtime.pending).toEqual([]);
    expect(replayCoreEvents(store.events)).toEqual(runtime.replay);
    expect((await CoreLessonStreamRuntime.open(runtime.sessionId, store)).replay).toEqual(runtime.replay);
  });
  it.each(["failure", "abort"])("does not publish on storage %s", async kind => {
    const { store, runtime, binding } = await setup();
    await runtime.acceptProposal(binding, proposalFor(binding, true));
    await runtime.commitClosedSpan(closedSpan("second"), "run-1");
    const next = buildCoreInterpretationContext(runtime.replay, { requestId: "second", newEvidence: runtime.pending });
    const before = structuredClone(runtime.replay), controller = new AbortController();
    const wait = deferred(); store.beforeAppend = () => wait.promise;
    const accepted = runtime.acceptProposal(next, proposalFor(next, true), { signal: controller.signal });
    const rejected = expect(accepted).rejects.toBeDefined();
    await Promise.resolve();
    if (kind === "abort") { controller.abort("test-abort"); wait.resolve(); } else wait.reject(new Error("store-failure"));
    await rejected;
    expect(runtime.replay).toEqual(before); expect(store.events).toEqual(before.events);
    expect(runtime.pending).toHaveLength(1);
  });
  it("honors a durable commit when abort arrives too late to roll it back", async () => {
    const { store, runtime, binding } = await setup();
    const append = store.append.bind(store), controller = new AbortController();
    store.append = async (events, signal) => { await append(events, signal); controller.abort("after-commit"); };
    await runtime.acceptProposal(binding, proposalFor(binding, true), { signal: controller.signal });
    expect(runtime.pending).toEqual([]); expect(replayCoreEvents(store.events)).toEqual(runtime.replay);
  });
  it("does not accept stale results queued behind a write", async () => {
    const { runtime, binding } = await setup();
    const before = structuredClone(runtime.replay);
    await expect(runtime.acceptProposal(binding, proposalFor(binding), { isCurrent: () => false })).rejects.toThrow("stale-result");
    expect(runtime.replay).toEqual(before);
  });
  it("isolates throwing publication and validation observers", async () => {
    const { runtime, binding } = await setup();
    const second = vi.fn(); runtime.subscribe(() => { throw new Error("observer"); }); runtime.subscribe(second);
    await runtime.acceptProposal(binding, proposalFor(binding), { onValidated() { throw new Error("trace"); } });
    expect(runtime.pending).toEqual([]); expect(second).toHaveBeenCalledOnce();
  });
  it("NEEDS_CONTEXT creates no event or publication", async () => {
    const { runtime, binding } = await setup(); const before = structuredClone(runtime.replay);
    const result = await runtime.acceptProposal(binding, { outcome: { kind: "NEEDS_CONTEXT", evidence: ["e0"], query: "Synthetic" } });
    expect(result.kind).toBe("NEEDS_CONTEXT"); expect(runtime.replay).toEqual(before);
  });
  it("refuses lesson end while committed evidence is unprocessed", async () => {
    const { runtime } = await setup(); await expect(runtime.end()).rejects.toThrow("pending-evidence");
    expect(runtime.replay.ended).toBe(false); expect(runtime.pending).toHaveLength(1);
  });
  it("preserves immutable checkpoint/grounding and persists run identities across reload", async () => {
    const { store, runtime } = await setup();
    expect(await runtime.commitClosedSpan(closedSpan(), "run-1")).toBeUndefined();
    await expect(runtime.commitClosedSpan(closedSpan("span-1", "changed"), "run-1")).rejects.toThrow("identity-collision");
    await runtime.allocateSpeechRunId(() => "first");
    const reload = await CoreLessonStreamRuntime.open(runtime.sessionId, store);
    await expect(reload.allocateSpeechRunId(() => "first")).rejects.toThrow("identity-collision");
    expect(await reload.allocateSpeechRunId(() => "second")).toBe("speech-run-second");
  });
  it.each(["CORE", "OBJECT", "RELATION", null] as const)("persists semantic Cue reference %s and AI origin", async target => {
    const { runtime, binding, store } = await setup();
    await runtime.acceptProposal(binding, addCue(proposalFor(binding, true), target));
    expect(runtime.state.cue.active?.origin?.kind).toBe("AI");
    expect(runtime.state.cue.active?.target?.kind).toBe(target ?? undefined);
    expect(JSON.stringify(store.events)).not.toMatch(/BOARD_ITEM|targetBoardItemId/);
    expect(replayCoreEvents(store.events).state).toEqual(runtime.state);
  });
  it("preserves explicit teacher Cue origin separately from factual provenance", async () => {
    const { runtime, binding } = await setup();
    await runtime.acceptProposal(binding, addCue(proposalFor(binding), null, "TEACHER"));
    expect(runtime.state.cue.active?.origin?.kind).toBe("TEACHER");
  });
});

describe("independent Core conflict domains through the live persistence boundary", () => {
  it.each([false, true])("Cue-only proposal with old knowledge base, declares read=%s", async readsKnowledge => {
    const { runtime, binding, store } = await setup();
    await runtime.acceptProposal(binding, proposalFor(binding, true));
    await runtime.commitClosedSpan(closedSpan("span-2"), "run-1");
    const request = buildCoreInterpretationContext(runtime.replay, { requestId: "second", newEvidence: runtime.pending });
    // A stale request view, never a mutation of authoritative runtime state.
    // Knowledge cannot otherwise mutate concurrently under the one-flight host.
    request.base.state.knowledge.revision = 0;
    const proposal = addCue(proposalFor(request)); proposedStep(proposal).reads.knowledge = readsKnowledge;
    if (readsKnowledge) {
      await expect(runtime.acceptProposal(request, proposal)).rejects.toThrow("core-knowledge-conflict");
      expect(runtime.pending).toHaveLength(1);
    } else { await runtime.acceptProposal(request, proposal); expect(runtime.state.cue.active).toBeDefined(); }
    expect(replayCoreEvents(store.events)).toEqual(runtime.replay);
  });
  it.each(["none", "declared", "target"])("Cue-only knowledge dependency: %s", async dependency => {
    const { runtime, binding } = await setup(); await runtime.acceptProposal(binding, proposalFor(binding, true));
    await runtime.commitClosedSpan(closedSpan("span-2"), "run-1");
    const request = buildCoreInterpretationContext(runtime.replay, { requestId: "second", newEvidence: runtime.pending });
    request.base.state.knowledge.revision = 0;
    const proposal = addCue(proposalFor(request)), step = proposedStep(proposal);
    if (dependency === "declared") step.reads.knowledge = true;
    if (dependency === "target" && step.cueDelta.action === "SET") step.cueDelta.value.target = { existing: request.context.knowledge.current! };
    if (dependency === "none") await runtime.acceptProposal(request, proposal);
    else await expect(runtime.acceptProposal(request, proposal)).rejects.toThrow("core-knowledge-conflict");
  });
  it.each(["none", "declared", "reference"])("knowledge-only proposal after actual in-flight Cue expiry: %s", async dependency => {
    const { runtime, binding, store } = await setup(); await runtime.acceptProposal(binding, addCue(proposalFor(binding)));
    await runtime.commitClosedSpan(closedSpan("span-2"), "run-1");
    const request = buildCoreInterpretationContext(runtime.replay, { requestId: "second", newEvidence: runtime.pending });
    await runtime.expireCue(runtime.state.cue.active!.id, runtime.state.cue.revision);
    const proposal = proposalFor(request, true), step = proposedStep(proposal);
    if (dependency === "declared") step.reads.cue = true;
    if (dependency === "reference") step.readRefs = [{ existing: request.context.cue.active! }];
    if (dependency === "none") {
      await runtime.acceptProposal(request, proposal);
      expect(runtime.state.knowledge.revision).toBe(1); expect(runtime.state.cue.active).toBeUndefined();
    } else { await expect(runtime.acceptProposal(request, proposal)).rejects.toThrow("core-cue-conflict"); expect(runtime.pending).toHaveLength(1); }
    expect(replayCoreEvents(store.events)).toEqual(runtime.replay);
  });
});

it("treats verified/domain correction's Cue context as a real cross-channel dependency", async () => {
  const { runtime, binding } = await setup();
  await runtime.acceptProposal(binding, addCue(proposalFor(binding)));
  await runtime.commitClosedSpan(closedSpan("second"), "run-1");
  const request = buildCoreInterpretationContext(runtime.replay, { requestId: "second", newEvidence: runtime.pending,
    domainRules: [{ id: "verified", text: "A", basis: "Deterministic trusted fixture" }] });
  const proposal = proposalFor(request, true), op = proposedStep(proposal).knowledgeOps[1]!;
  if (!("value" in op)) throw new Error("test-fact-required");
  op.value.provenance = { speech: [], state: [], domain: { rule: "verified" } };
  await runtime.expireCue(runtime.state.cue.active!.id, runtime.state.cue.revision);
  await expect(runtime.acceptProposal(request, proposal)).rejects.toThrow("core-cue-conflict");
  expect(runtime.pending).toHaveLength(1);
});

it("reports historical Core ended-with-pending logs instead of silently stranding evidence", async () => {
  const { store, runtime } = await setup();
  store.events.push({ schemaVersion: "lesson-event-v5-core", eventId: "old-end", sessionId: runtime.sessionId,
    sequence: store.events.length + 1, type: "lesson.ended", timestamp: "2026-09-08T00:00:00.000Z" });
  const before = structuredClone(store.events);
  await expect(CoreLessonStreamRuntime.open(runtime.sessionId, store)).rejects.toThrow("core-ended-with-pending-evidence");
  expect(store.events).toEqual(before);
});
