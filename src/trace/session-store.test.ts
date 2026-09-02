import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalTraceStore } from "./session-store";

const sessionId = "session-local-store-test";
const writerId = "browser-page-test";
const draft = (id: string, occurredAt = "2026-09-02T10:00:00.000Z") => ({ id, occurredAt, stage: "speechmatics" as const, type: "asr.partial", source: "browser" as const, payload: { transcript: id } });
async function allEvents(store: LocalTraceStore, id: string) { const events: Awaited<ReturnType<LocalTraceStore["latestEvents"]>> = []; await store.iterateOrderedEvents(id, (event) => events.push(event)); return events; }

describe("local durable trace store", () => {
  beforeEach(() => Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange }));

  it("persists events through a store re-instantiation and keeps deterministic order", async () => {
    const first = await LocalTraceStore.open(); await first.ensureSession(sessionId);
    await first.append(sessionId, [draft("browser:event-late", "2026-09-02T10:00:02.000Z"), draft("browser:event-early", "2026-09-02T10:00:01.000Z")], writerId);
    const reopened = await LocalTraceStore.open();
    expect((await allEvents(reopened, sessionId)).map((event) => event.id)).toEqual(["browser:event-early", "browser:event-late"]);
  });

  it("migrates v1 events for ordered/timeline cursors and removes the legacy session-level writer identity", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("cuelayer-local-trace-v1", 1);
      request.onupgradeneeded = () => {
        const events = request.result.createObjectStore("events", { keyPath: "id" });
        events.createIndex("sessionId", "sessionId", { unique: false });
        request.result.createObjectStore("sessions", { keyPath: "sessionId" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction(["events", "sessions"], "readwrite");
        transaction.objectStore("sessions").put({ sessionId, sourceInstanceId: "legacy-session-writer", nextSeq: 2, createdAt: "2026-09-02T10:00:00.000Z", updatedAt: "2026-09-02T10:00:00.000Z" });
        transaction.objectStore("events").put({ id: "legacy-final", schemaVersion: 1, sessionId, occurredAt: "2026-09-02T10:00:00.000Z", stage: "speechmatics", type: "asr.final", payload: {}, source: "browser", sourceInstanceId: "legacy-session-writer", sourceSeq: 1 });
        transaction.oncomplete = () => { request.result.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const store = await LocalTraceStore.open();
    expect(await store.timelineEvents(sessionId)).toMatchObject([{ id: "legacy-final" }]);
    expect(await store.session(sessionId)).not.toHaveProperty("sourceInstanceId");
  });

  it("makes duplicate appends idempotent and detects conflicting event identities", async () => {
    const store = await LocalTraceStore.open(); await store.ensureSession(sessionId);
    await store.append(sessionId, [draft("browser:event-1")], writerId);
    expect(await store.append(sessionId, [draft("browser:event-1")], writerId)).toEqual([]);
    await expect(store.append(sessionId, [{ ...draft("browser:event-1"), payload: { transcript: "different" } }], writerId)).rejects.toThrow("trace-event-id-conflict");
  });

  it("keeps one active session and the five most recent explicitly completed sessions", async () => {
    const store = await LocalTraceStore.open();
    for (let index = 0; index < 7; index += 1) { const id = `session-completed-${index}`; await store.ensureSession(id); await store.completeSession(id); }
    await store.ensureSession("session-active");
    const sessions = await store.sessions();
    expect(sessions.filter((session) => !session.completedAt).map((session) => session.sessionId)).toEqual(["session-active"]);
    expect(sessions.filter((session) => session.completedAt)).toHaveLength(5);
    expect((await store.session("session-active"))?.completedAt).toBeUndefined();
  });

  it("marks an ended product session complete", async () => {
    const store = await LocalTraceStore.open(); await store.ensureSession(sessionId); await store.completeSession(sessionId);
    expect((await store.session(sessionId))?.completedAt).toMatch(/^2026-|^20/);
  });

  it("accepts two reloads of the same session because each page load owns a fresh writer identity", async () => {
    const store = await LocalTraceStore.open(); await store.ensureSession(sessionId);
    await store.append(sessionId, [{ ...draft("browser-page-a:session-reloaded"), type: "session.reloaded" }], "browser-page-a");
    await store.append(sessionId, [{ ...draft("browser-page-b:session-reloaded"), type: "session.reloaded" }], "browser-page-b");
    expect((await allEvents(store, sessionId)).map((event) => event.id)).toEqual(["browser-page-a:session-reloaded", "browser-page-b:session-reloaded"]);
  });

  it("reads only the requested recent raw window while retaining the full semantic timeline", async () => {
    const store = await LocalTraceStore.open(); await store.ensureSession(sessionId);
    const noise = Array.from({ length: 10_000 }, (_, index) => ({ ...draft(`raw-${String(index).padStart(5, "0")}`, new Date(Date.UTC(2026, 8, 2, 10, 0, 0, index)).toISOString()), type: "speechmatics.raw_message" }));
    await store.append(sessionId, [{ ...draft("semantic-final", "2026-09-02T09:59:59.000Z"), type: "asr.final" }, ...noise], writerId);
    const recent = await store.latestEvents(sessionId, 300);
    expect(recent).toHaveLength(300);
    expect(recent[0]?.id).toBe("raw-09700");
    const human = await store.humanTraceEvents(sessionId, 300);
    expect(human).toHaveLength(301);
    expect(human[0]?.id).toBe("semantic-final");
  }, 15_000);

  it("exports ordered JSONL by cursor without calling the full-array events path", async () => {
    const store = await LocalTraceStore.open(); await store.ensureSession(sessionId);
    await store.append(sessionId, [draft("later", "2026-09-02T10:00:02.000Z"), draft("earlier", "2026-09-02T10:00:01.000Z")], writerId);
    const lines = (await (await store.exportJsonlBlob(sessionId)).text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((event) => event.id)).toEqual(["earlier", "later"]);
  });
});
