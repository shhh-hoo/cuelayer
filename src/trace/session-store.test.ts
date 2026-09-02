import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalTraceStore } from "./session-store";

const sessionId = "session-local-store-test";
const draft = (id: string, occurredAt = "2026-09-02T10:00:00.000Z") => ({ id, occurredAt, stage: "speechmatics" as const, type: "asr.partial", source: "browser" as const, payload: { transcript: id } });

describe("local durable trace store", () => {
  beforeEach(() => Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange }));

  it("persists events through a store re-instantiation and keeps deterministic order", async () => {
    const first = await LocalTraceStore.open(); const session = await first.ensureSession(sessionId);
    await first.append(sessionId, [draft("browser:event-late", "2026-09-02T10:00:02.000Z"), draft("browser:event-early", "2026-09-02T10:00:01.000Z")], session.sourceInstanceId);
    const reopened = await LocalTraceStore.open();
    expect((await reopened.events(sessionId)).map((event) => event.id)).toEqual(["browser:event-early", "browser:event-late"]);
  });

  it("makes duplicate appends idempotent and detects conflicting event identities", async () => {
    const store = await LocalTraceStore.open(); const session = await store.ensureSession(sessionId);
    await store.append(sessionId, [draft("browser:event-1")], session.sourceInstanceId);
    expect(await store.append(sessionId, [draft("browser:event-1")], session.sourceInstanceId)).toEqual([]);
    await expect(store.append(sessionId, [{ ...draft("browser:event-1"), payload: { transcript: "different" } }], session.sourceInstanceId)).rejects.toThrow("trace-event-id-conflict");
  });

  it("keeps one active session and the five most recent explicitly completed sessions", async () => {
    const store = await LocalTraceStore.open();
    for (let index = 0; index < 7; index += 1) { const id = `session-completed-${index}`; await store.ensureSession(id); await store.completeSession(id); }
    await store.ensureSession("session-active");
    const sessions = await store.sessions();
    expect(sessions.filter((session) => !session.completedAt).map((session) => session.sessionId)).toEqual(["session-active"]);
    expect(sessions.filter((session) => session.completedAt)).toHaveLength(5);
  });
});
