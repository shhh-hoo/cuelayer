import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { lessonStartedEvent, speechRunAllocatedEvent } from "./events.ts";
import { CoreLessonStreamRuntime } from "./core/runtime.ts";
import { buildCoreInterpretationContext } from "./core/interpretation-context.ts";
import { closedSpan, proposalFor } from "./core/live-test-fixtures.ts";
import type { CoreEvent } from "./core/contracts.ts";
import { openLessonRuntime } from "./open-runtime.ts";
import { LessonStreamRuntime } from "./runtime.ts";
import { LocalLessonEventStore } from "./store.ts";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange); });
afterEach(() => vi.unstubAllGlobals());

it("defaults to legacy; Core is a deliberate strongly typed selection", async () => {
  const legacy = await openLessonRuntime("legacy"); const core = await openLessonRuntime("core", { domain: "core" });
  expect(legacy).toBeInstanceOf(LessonStreamRuntime); expect(core).toBeInstanceOf(CoreLessonStreamRuntime);
  await legacy.start(); await core.start();
  expect(legacy.events.every(e => e.schemaVersion === "lesson-event-v4-continuous")).toBe(true);
  expect(core.events.every(e => e.schemaVersion === "lesson-event-v5-core")).toBe(true);
  legacy.close(); core.close();
});
it.each(["legacy", "core"] as const)("locks even an empty %s session against changing domain", async domain => {
  const owner = await LocalLessonEventStore.open(domain), other = await LocalLessonEventStore.open(domain === "core" ? "legacy" : "core");
  await owner.readSession("same"); await expect(other.readSession("same")).rejects.toThrow("lesson-domain-mismatch");
  owner.close(); other.close();
});
it("concurrent domain claims cannot both win", async () => {
  const a = await LocalLessonEventStore.open(), b = await LocalLessonEventStore.open<CoreEvent>("core");
  const result = await Promise.allSettled([a.readSession("same"), b.readSession("same")]);
  expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(result.filter(r => r.status === "rejected")).toHaveLength(1); a.close(); b.close();
});
it("restores historical v3/v4 events from database v1 without conversion", async () => {
  const event = { ...lessonStartedEvent("old", 1), schemaVersion: "lesson-event-v3-learner-agency" as const };
  const later = speechRunAllocatedEvent("old", 2, "legacy-run");
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("cuelayer-lesson-stream-v1", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("lesson-events", { keyPath: "eventId" });
      store.createIndex("session-sequence", ["sessionId", "sequence", "eventId"]); store.add(event); store.add(later);
    };
    request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
  });
  const runtime = await LessonStreamRuntime.open("old"); expect(runtime.events).toEqual([event, later]); runtime.close();
  await expect(CoreLessonStreamRuntime.open("old")).rejects.toThrow("lesson-domain-mismatch");
});
it("Core session cannot append legacy accepted events, even through a mismatched generic store", async () => {
  const core = await LocalLessonEventStore.open("core");
  await expect(core.append([lessonStartedEvent("same", 1)])).rejects.toThrow("lesson-domain-mismatch"); core.close();
});
it("never overwrites event identity or sequence and exact duplicate appends remain idempotent", async () => {
  const store = await LocalLessonEventStore.open(); const event = lessonStartedEvent("lesson", 1);
  if (event.type !== "lesson.started") throw new Error("test-start-required");
  await store.append([event]); await store.append([event]);
  await expect(store.append([{ ...event, timestamp: "2026-01-01T00:00:00.000Z" }])).rejects.toThrow("identity-conflict");
  await expect(store.append([{ ...event, eventId: "other" }])).rejects.toThrow("sequence-conflict");
  expect(await store.readSession("lesson")).toEqual([event]); store.close();
});
it("rejects a competing writer without publishing its candidate state", async () => {
  const a = await CoreLessonStreamRuntime.open("core"); await a.start();
  const b = await CoreLessonStreamRuntime.open("core");
  await a.commitClosedSpan(closedSpan("a"), "run");
  await expect(b.commitClosedSpan(closedSpan("b"), "run")).rejects.toThrow();
  expect(b.pending).toHaveLength(0); a.close(); b.close();
  const reload = await CoreLessonStreamRuntime.open("core"); expect(reload.pending).toHaveLength(1); expect(reload.pending[0]?.checkpointId).toContain("-a-"); reload.close();
});
it("aborts the real IndexedDB transaction with no speculative runtime publication", async () => {
  const store = await LocalLessonEventStore.open<CoreEvent>("core");
  const runtime = await CoreLessonStreamRuntime.open("core", store); await runtime.start(); await runtime.commitClosedSpan(closedSpan(), "run");
  const binding = buildCoreInterpretationContext(runtime.replay, { requestId: "request", newEvidence: runtime.pending });
  const before = structuredClone(runtime.replay), controller = new AbortController();
  const append = store.append.bind(store);
  store.append = async (events, signal) => { const pending = append(events, signal); controller.abort("during-idb"); return pending; };
  await expect(runtime.acceptProposal(binding, proposalFor(binding, true), { signal: controller.signal })).rejects.toBeDefined();
  expect(runtime.replay).toEqual(before); expect(await store.readSession("core")).toEqual(before.events); runtime.close();
});
it("reloads persisted Core multi-op publication and pending checkpoints exactly", async () => {
  const runtime = await CoreLessonStreamRuntime.open("core"); await runtime.start(); await runtime.commitClosedSpan(closedSpan(), "run");
  const binding = buildCoreInterpretationContext(runtime.replay, { requestId: "request", newEvidence: runtime.pending });
  await runtime.acceptProposal(binding, proposalFor(binding, true)); await runtime.commitClosedSpan(closedSpan("pending"), "run");
  const before = structuredClone(runtime.replay); runtime.close();
  const reload = await CoreLessonStreamRuntime.open("core"); expect(reload.replay).toEqual(before); expect(reload.pending).toHaveLength(1); reload.close();
});
