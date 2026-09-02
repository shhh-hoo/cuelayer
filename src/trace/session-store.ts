import { compareTraceEvents, isHumanTimelineEvent, prepareDurableTraceEvent, type DurableTraceEvent, type DurableTraceEventDraft } from "./durable-trace";

const DATABASE = "cuelayer-local-trace-v1";
const EVENTS = "events";
const SESSIONS = "sessions";
const SESSION_INDEX = "sessionId";
const SESSION_ORDER_INDEX = "sessionOrder";
const TIMELINE_ORDER_INDEX = "timelineOrder";
const RETAIN_COMPLETED = 5;
const EXPORT_CHUNK_SIZE = 64 * 1024;

export type LocalTraceSession = { sessionId: string; nextSeq: number; createdAt: string; updatedAt: string; completedAt?: string };
type StoredTraceEvent = DurableTraceEvent & { timelineEntry: 0 | 1 };

function storedEvent(event: DurableTraceEvent): StoredTraceEvent {
  return { ...event, timelineEntry: isHumanTimelineEvent(event) ? 1 : 0 };
}

function durableEvent(event: StoredTraceEvent): DurableTraceEvent {
  const { timelineEntry: _timelineEntry, ...durable } = event;
  return durable;
}

function openDatabase(): Promise<IDBDatabase> { return new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE, 2);
  request.onupgradeneeded = (event) => {
    const events = request.transaction!.objectStoreNames.contains(EVENTS)
      ? request.transaction!.objectStore(EVENTS)
      : request.result.createObjectStore(EVENTS, { keyPath: "id" });
    if (!events.indexNames.contains(SESSION_INDEX)) events.createIndex(SESSION_INDEX, "sessionId", { unique: false });
    if (!events.indexNames.contains(SESSION_ORDER_INDEX)) events.createIndex(SESSION_ORDER_INDEX, ["sessionId", "occurredAt", "sourceInstanceId", "sourceSeq", "id"], { unique: false });
    if (!events.indexNames.contains(TIMELINE_ORDER_INDEX)) events.createIndex(TIMELINE_ORDER_INDEX, ["sessionId", "timelineEntry", "occurredAt", "sourceInstanceId", "sourceSeq", "id"], { unique: false });
    const sessions = request.result.objectStoreNames.contains(SESSIONS)
      ? request.transaction!.objectStore(SESSIONS)
      : request.result.createObjectStore(SESSIONS, { keyPath: "sessionId" });
    if ((event as IDBVersionChangeEvent).oldVersion > 0) {
      const cursor = events.openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return;
        const value = current.value as DurableTraceEvent & { timelineEntry?: 0 | 1 };
        if (value.timelineEntry === undefined) current.update(storedEvent(value));
        current.continue();
      };
      const sessionCursor = sessions.openCursor();
      sessionCursor.onsuccess = () => {
        const current = sessionCursor.result;
        if (!current) return;
        const { sourceInstanceId: _legacyWriterId, ...session } = current.value as LocalTraceSession & { sourceInstanceId?: string };
        if (_legacyWriterId) current.update(session);
        current.continue();
      };
    }
  };
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
}); }
function requestResult<T>(request: IDBRequest<T>) { return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function done(transaction: IDBTransaction) { return new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); }); }
function newSession(sessionId: string): LocalTraceSession { const now = new Date().toISOString(); return { sessionId, nextSeq: 1, createdAt: now, updatedAt: now }; }

const sessionOrderRange = (sessionId: string) => IDBKeyRange.bound(
  [sessionId, "", "", 0, ""],
  [sessionId, "\uffff", "\uffff", Number.MAX_SAFE_INTEGER, "\uffff"],
);
const timelineOrderRange = (sessionId: string) => IDBKeyRange.bound(
  [sessionId, 1, "", "", 0, ""],
  [sessionId, 1, "\uffff", "\uffff", Number.MAX_SAFE_INTEGER, "\uffff"],
);
const rawOrderRange = (sessionId: string) => IDBKeyRange.bound(
  [sessionId, 0, "", "", 0, ""],
  [sessionId, 0, "\uffff", "\uffff", Number.MAX_SAFE_INTEGER, "\uffff"],
);

/** IndexedDB is the Alpha durable source of truth. One active plus five completed sessions are retained. */
export class LocalTraceStore {
  private constructor(private readonly db: IDBDatabase) {}
  static async open() { return new LocalTraceStore(await openDatabase()); }
  async session(sessionId: string) { return requestResult(this.db.transaction(SESSIONS).objectStore(SESSIONS).get(sessionId)) as Promise<LocalTraceSession | undefined>; }
  async ensureSession(sessionId: string) {
    const existing = await this.session(sessionId); if (existing) return existing;
    const transaction = this.db.transaction(SESSIONS, "readwrite"); const store = transaction.objectStore(SESSIONS); const now = new Date().toISOString(); const created = newSession(sessionId); store.put(created);
    await new Promise<void>((resolve, reject) => { const cursor = store.openCursor(); cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => { const active = cursor.result; if (!active) { resolve(); return; } const value = active.value as LocalTraceSession; if (value.sessionId !== sessionId && !value.completedAt) active.update({ ...value, completedAt: now, updatedAt: now }); active.continue(); }; });
    await done(transaction); await this.pruneCompleted(); return created;
  }
  async append(sessionId: string, drafts: DurableTraceEventDraft[], sourceInstanceId: string) {
    const session = await this.ensureSession(sessionId); let sequence = session.nextSeq; const prepared = drafts.map((draft) => prepareDurableTraceEvent(sessionId, { ...draft, sourceInstanceId: draft.sourceInstanceId ?? sourceInstanceId, sourceSeq: draft.sourceSeq ?? sequence++ }));
    const accepted: DurableTraceEvent[] = [];
    const lookup = this.db.transaction(EVENTS).objectStore(EVENTS);
    const existingEvents = await Promise.all(prepared.map((event) => requestResult(lookup.get(event.id)) as Promise<StoredTraceEvent | undefined>));
    for (const [index, event] of prepared.entries()) {
      const stored = existingEvents[index];
      const existing = stored ? durableEvent(stored) : undefined;
      if (!existing) accepted.push(event); else {
        const { sourceInstanceId: _existingInstance, sourceSeq: _existingSequence, ...existingFact } = existing;
        const { sourceInstanceId: _incomingInstance, sourceSeq: _incomingSequence, ...incomingFact } = event;
        if (JSON.stringify(existingFact) !== JSON.stringify(incomingFact)) throw new Error("trace-event-id-conflict");
      }
    }
    const transaction = this.db.transaction([EVENTS, SESSIONS], "readwrite"); accepted.forEach((event) => transaction.objectStore(EVENTS).put(storedEvent(event))); transaction.objectStore(SESSIONS).put({ ...session, nextSeq: sequence, updatedAt: new Date().toISOString() }); await done(transaction);
    return accepted;
  }
  async latestEvents(sessionId: string, limit: number) {
    if (limit <= 0) return [];
    const index = this.db.transaction(EVENTS).objectStore(EVENTS).index(SESSION_ORDER_INDEX); const events: DurableTraceEvent[] = [];
    await new Promise<void>((resolve, reject) => { const cursor = index.openCursor(sessionOrderRange(sessionId), "prev"); cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => { const current = cursor.result; if (!current || events.length >= limit) { resolve(); return; } events.push(durableEvent(current.value as StoredTraceEvent)); current.continue(); }; });
    return events.sort(compareTraceEvents);
  }
  async timelineEvents(sessionId: string) {
    const index = this.db.transaction(EVENTS).objectStore(EVENTS).index(TIMELINE_ORDER_INDEX); const events: DurableTraceEvent[] = [];
    await new Promise<void>((resolve, reject) => { const cursor = index.openCursor(timelineOrderRange(sessionId)); cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => { const current = cursor.result; if (!current) { resolve(); return; } events.push(durableEvent(current.value as StoredTraceEvent)); current.continue(); }; });
    return events;
  }
  async latestRawEvents(sessionId: string, limit: number) {
    if (limit <= 0) return [];
    const index = this.db.transaction(EVENTS).objectStore(EVENTS).index(TIMELINE_ORDER_INDEX); const events: DurableTraceEvent[] = [];
    await new Promise<void>((resolve, reject) => { const cursor = index.openCursor(rawOrderRange(sessionId), "prev"); cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => { const current = cursor.result; if (!current || events.length >= limit) { resolve(); return; } events.push(durableEvent(current.value as StoredTraceEvent)); current.continue(); }; });
    return events.sort(compareTraceEvents);
  }
  async humanTraceEvents(sessionId: string, rawWindow = 300) {
    const [timeline, latest] = await Promise.all([this.timelineEvents(sessionId), this.latestRawEvents(sessionId, rawWindow)]);
    return [...new Map([...timeline, ...latest].map((event) => [event.id, event])).values()].sort(compareTraceEvents);
  }
  async iterateOrderedEvents(sessionId: string, visit: (event: DurableTraceEvent) => void) {
    const index = this.db.transaction(EVENTS).objectStore(EVENTS).index(SESSION_ORDER_INDEX);
    await new Promise<void>((resolve, reject) => { const cursor = index.openCursor(sessionOrderRange(sessionId)); cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => { const current = cursor.result; if (!current) { resolve(); return; } visit(durableEvent(current.value as StoredTraceEvent)); current.continue(); }; });
  }
  async exportJsonlBlob(sessionId: string) {
    const chunks: BlobPart[] = []; let chunk = "";
    await this.iterateOrderedEvents(sessionId, (event) => { chunk += `${JSON.stringify(event)}\n`; if (chunk.length >= EXPORT_CHUNK_SIZE) { chunks.push(chunk); chunk = ""; } });
    if (chunk) chunks.push(chunk);
    return new Blob(chunks, { type: "application/x-ndjson" });
  }
  async sessions() { const all = await requestResult(this.db.transaction(SESSIONS).objectStore(SESSIONS).getAll()) as LocalTraceSession[]; return all.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)); }
  async completeSession(sessionId: string) { const session = await this.session(sessionId); if (!session) return; await requestResult(this.db.transaction(SESSIONS, "readwrite").objectStore(SESSIONS).put({ ...session, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })); await this.pruneCompleted(); }
  async clearSession(sessionId: string) { const transaction = this.db.transaction([EVENTS, SESSIONS], "readwrite"); const index = transaction.objectStore(EVENTS).index(SESSION_INDEX); await new Promise<void>((resolve, reject) => { const cursor = index.openCursor(IDBKeyRange.only(sessionId)); cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => { if (!cursor.result) { resolve(); return; } cursor.result.delete(); cursor.result.continue(); }; }); transaction.objectStore(SESSIONS).delete(sessionId); await done(transaction); }
  private async pruneCompleted() { const sessions = (await this.sessions()).filter((session) => session.completedAt).sort((left, right) => right.completedAt!.localeCompare(left.completedAt!)); await Promise.all(sessions.slice(RETAIN_COMPLETED).map((session) => this.clearSession(session.sessionId))); }
}
