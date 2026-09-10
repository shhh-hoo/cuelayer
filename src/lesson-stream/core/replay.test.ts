import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptCoreStep } from "./accepted-steps.ts";
import { CORE_EVENT_SCHEMA_VERSION } from "./contracts.ts";
import { coreEntityId } from "./events.ts";
import { appendCoreEvent, pendingCoreEvidence, replayCoreEvents } from "./replay.ts";
import { envelope, evidence, expire, fact, foundation, speechRef, start, stepFor } from "./test-fixtures.ts";

afterEach(() => vi.restoreAllMocks());
describe("deterministic Core replay", () => {
  it("replays growth, correction, supersession, invalidation, Cue resolution and no-op identically without external inputs", () => {
    const f = foundation(); let base = evidence(f.replay), next = stepFor(base), cp = next.consumesCheckpointIds[0]!;
    const replacement = coreEntityId(base.state.sessionId, next, "OBJECT", 1);
    next.knowledgeOps = [
      { action: "REVISE_OBJECT", coreId: f.coreId, id: f.b, value: fact(cp, "Revised B"), correctionEvidence: speechRef(cp) },
      { action: "ADD_OBJECT", coreId: f.coreId, id: replacement, value: fact(cp, "New A") },
      { action: "SUPERSEDE", target: { kind: "OBJECT", coreId: f.coreId, id: f.a }, replacement: { kind: "OBJECT", coreId: f.coreId, id: replacement }, correctionEvidence: speechRef(cp) },
      { action: "INVALIDATE", target: { kind: "SUPPORT", coreId: f.coreId, id: f.supportId }, correctionEvidence: speechRef(cp) },
    ];
    next.cueDelta = { action: "RESOLVE", targetCueId: f.cueId, evidence: speechRef(cp) };
    base = evidence(acceptCoreStep(base, next).replay);
    base = acceptCoreStep(base, stepFor(base)).replay;
    base = evidence(base); // Unconsumed evidence must survive reload too.
    const serialized = JSON.stringify(base.events);
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw Error("provider-called"); });
    const now = vi.spyOn(Date, "now").mockImplementation(() => { throw Error("clock-called"); });
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw Error("random-called"); });
    const uuid = vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => { throw Error("uuid-called"); });
    for (const events of [base.events, JSON.parse(serialized), [...base.events].reverse()]) {
      const replay = replayCoreEvents(events);
      expect(replay).toEqual(base);
      expect(pendingCoreEvidence(replay)).toEqual(base.checkpoints.slice(-1));
      expect(JSON.stringify(replay.state)).toBe(JSON.stringify(base.state));
    }
    for (const spy of [fetch, now, random, uuid]) expect(spy).not.toHaveBeenCalled();
    const first = replayCoreEvents(base.events.slice(0, 3));
    expect(first.state.knowledge.cores[f.coreId]!.objects[f.a]!.value.text).toBe("A definition");
  });

  it("is idempotent for exact persisted event duplicates, including after lesson end", () => {
    const f = foundation();
    const ended = appendCoreEvent(f.replay, { ...envelope(f.replay), type: "lesson.ended" });
    expect(replayCoreEvents([...ended.events, ...ended.events])).toEqual(ended);
    expect(appendCoreEvent(ended, ended.events[2])).toEqual(ended);
    expect(() => appendCoreEvent(ended, { ...envelope(ended), type: "lesson.ended" })).toThrow("core-lesson-ended");
  });

  it.each(["event-id", "sequence", "session", "step-key", "checkpoint-id", "checkpoint-sequence", "grounding", "unknown-schema", "legacy-hidden-duplicate", "foreign-fields", "missing-start", "second-start"])("rejects %s corruption", corruption => {
    const f = foundation(); const events = structuredClone(f.replay.events);
    const committed = events[1]!;
    if (committed.type !== "evidence.checkpoint_committed") throw Error("fixture");
    if (corruption === "event-id") events.push({ ...events[0]!, timestamp: "2026-09-08T00:00:00.000Z" } as typeof events[0]);
    if (corruption === "sequence") events[2]!.sequence = 8;
    if (corruption === "session") events[2]!.sessionId = "another-lesson";
    if (corruption === "step-key") events.push({ ...events[2]!, eventId: "another-event", sequence: 4 });
    if (corruption === "checkpoint-id") events.push({ ...committed, eventId: "another-checkpoint-event", sequence: 4 });
    if (corruption === "checkpoint-sequence") committed.checkpoint.lessonSequence = 2;
    if (corruption === "grounding") committed.grounding.checkpointId = "other";
    if (corruption === "unknown-schema") (events[1] as unknown as { schemaVersion: string }).schemaVersion = "future-generation";
    if (corruption === "legacy-hidden-duplicate") events.push({ ...events[0]!, schemaVersion: "lesson-event-v4-continuous" } as unknown as typeof events[0]);
    if (corruption === "foreign-fields") Object.assign(events[2]!, { boardDelta: { action: "SET_ACTIVE" } });
    if (corruption === "missing-start") events.shift();
    if (corruption === "second-start") events.push({ ...events[0]!, eventId: "restart", sequence: 4 });
    expect(() => replayCoreEvents(events)).toThrow();
  });

  it("applies only explicit NOTE expiry and ignores stale expiry after revision/replacement", () => {
    let base = evidence(start()), next = stepFor(base);
    const id = coreEntityId(base.state.sessionId, next, "CUE", 0);
    next.cueDelta = { action: "SET", id, value: { ...fact("checkpoint-1"), kind: "NOTE" } };
    base = acceptCoreStep(base, next).replay;
    const original = base;
    expect(replayCoreEvents(base.events).state.cue.active!.id).toBe(id);
    base = evidence(base); next = stepFor(base);
    next.cueDelta = { action: "REVISE", targetCueId: id, value: { ...fact("checkpoint-2", "Updated note"), kind: "NOTE" } };
    base = acceptCoreStep(base, next).replay;
    base = appendCoreEvent(base, expire(base, id, 1));
    expect(base.state.cue.active!.text).toBe("Updated note");
    const expired = appendCoreEvent(base, expire(base));
    expect(expired.state.cue).toEqual({ revision: 3 });
    expect(expired.state.knowledge).toEqual(base.state.knowledge);
    expect(replayCoreEvents(expired.events)).toEqual(expired);
    base = evidence(original); next = stepFor(base);
    next.cueDelta = { action: "REPLACE", targetCueId: id, id: coreEntityId(base.state.sessionId, next, "CUE", 0), evidence: speechRef("checkpoint-2"), value: { ...fact("checkpoint-2"), kind: "TASK" } };
    base = acceptCoreStep(base, next).replay;
    expect(appendCoreEvent(base, expire(base, id, 1)).state.cue).toEqual(base.state.cue);
    expect(() => appendCoreEvent(base, expire(base))).toThrow("core-only-note-can-expire");
  });

  it("requires explicit lesson identity for an empty Core replay", () => {
    expect(() => replayCoreEvents([])).toThrow("core-session-id-required");
    expect(replayCoreEvents([], "empty").state.sessionId).toBe("empty");
    expect(start().events[0]!.schemaVersion).toBe(CORE_EVENT_SCHEMA_VERSION);
  });
});
