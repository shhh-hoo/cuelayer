import { compareTraceEvents, prepareDurableTraceEvent, type DurableTraceEvent, type DurableTraceEventDraft } from "./durable-trace";

const DATABASE = "cuelayer-local-trace-v1";
const EVENTS = "events";
const SESSIONS = "sessions";
const SESSION_INDEX = "sessionId";
const RETAIN_COMPLETED = 5;

export type LocalTraceSession = { sessionId: string; sourceInstanceId: string; nextSeq: number; createdAt: string; updatedAt: string; completedAt?: string };

function openDatabase(): Promise<IDBDatabase> { return new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    const events = request.result.createObjectStore(EVENTS, { keyPath: "id" });
    events.createIndex(SESSION_INDEX, "sessionId", { unique: false });
    request.result.createObjectStore(SESSIONS, { keyPath: "sessionId" });
  };
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
}); }
function requestResult<T>(request: IDBRequest<T>) { return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function done(transaction: IDBTransaction) { return new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); }); }
function newSession(sessionId: string): LocalTraceSession { const now = new Date().toISOString(); return { sessionId, sourceInstanceId: `browser-${crypto.randomUUID()}`, nextSeq: 1, createdAt: now, updatedAt: now }; }

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
    for (const event of prepared) {
      const existing = await requestResult(this.db.transaction(EVENTS).objectStore(EVENTS).get(event.id)) as DurableTraceEvent | undefined;
      if (!existing) accepted.push(event); else {
        const { sourceInstanceId: _existingInstance, sourceSeq: _existingSequence, ...existingFact } = existing;
        const { sourceInstanceId: _incomingInstance, sourceSeq: _incomingSequence, ...incomingFact } = event;
        if (JSON.stringify(existingFact) !== JSON.stringify(incomingFact)) throw new Error("trace-event-id-conflict");
      }
    }
    const transaction = this.db.transaction([EVENTS, SESSIONS], "readwrite"); accepted.forEach((event) => transaction.objectStore(EVENTS).put(event)); transaction.objectStore(SESSIONS).put({ ...session, nextSeq: sequence, sourceInstanceId, updatedAt: new Date().toISOString() }); await done(transaction);
    return accepted;
  }
  async events(sessionId: string) {
    const transaction = this.db.transaction(EVENTS); const index = transaction.objectStore(EVENTS).index(SESSION_INDEX); const events: DurableTraceEvent[] = [];
    await new Promise<void>((resolve, reject) => { const cursor = index.openCursor(IDBKeyRange.only(sessionId)); cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => { if (!cursor.result) { resolve(); return; } events.push(cursor.result.value as DurableTraceEvent); cursor.result.continue(); }; });
    return events.sort(compareTraceEvents);
  }
  async sessions() { const all = await requestResult(this.db.transaction(SESSIONS).objectStore(SESSIONS).getAll()) as LocalTraceSession[]; return all.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)); }
  async completeSession(sessionId: string) { const session = await this.session(sessionId); if (!session) return; await requestResult(this.db.transaction(SESSIONS, "readwrite").objectStore(SESSIONS).put({ ...session, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })); await this.pruneCompleted(); }
  async clearSession(sessionId: string) { const transaction = this.db.transaction([EVENTS, SESSIONS], "readwrite"); const index = transaction.objectStore(EVENTS).index(SESSION_INDEX); await new Promise<void>((resolve, reject) => { const cursor = index.openCursor(IDBKeyRange.only(sessionId)); cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => { if (!cursor.result) { resolve(); return; } cursor.result.delete(); cursor.result.continue(); }; }); transaction.objectStore(SESSIONS).delete(sessionId); await done(transaction); }
  private async pruneCompleted() { const sessions = (await this.sessions()).filter((session) => session.completedAt).sort((left, right) => right.completedAt!.localeCompare(left.completedAt!)); await Promise.all(sessions.slice(RETAIN_COMPLETED).map((session) => this.clearSession(session.sessionId))); }
}
