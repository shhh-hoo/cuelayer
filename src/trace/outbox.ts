import { prepareDurableTraceEvent, type DurableTraceEvent, type DurableTraceEventDraft } from "./durable-trace";
import type { TraceCapabilities, TraceTransport } from "./trace-client";

const DATABASE = "cuelayer-trace-outbox-v1";
const EVENT_STORE = "events";
const SESSION_STORE = "sessions";
const MAX_BATCH = 50;
type StoredSession = TraceCapabilities & { sessionId: string; sourceInstanceId: string; nextSeq: number };
function openDatabase(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open(DATABASE, 1); request.onupgradeneeded = () => { request.result.createObjectStore(EVENT_STORE, { keyPath: "id" }); request.result.createObjectStore(SESSION_STORE, { keyPath: "sessionId" }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function result<T>(request: IDBRequest<T>) { return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
export class TraceOutbox {
  private constructor(private readonly db: IDBDatabase) {}
  static async open() { return new TraceOutbox(await openDatabase()); }
  async session(sessionId: string) { return result(this.db.transaction(SESSION_STORE).objectStore(SESSION_STORE).get(sessionId)) as Promise<StoredSession | undefined>; }
  async saveSession(session: StoredSession) { await result(this.db.transaction(SESSION_STORE, "readwrite").objectStore(SESSION_STORE).put(session)); }
  async enqueue(sessionId: string, drafts: DurableTraceEventDraft[], sourceInstanceId: string) {
    const current = await this.session(sessionId); let sequence = current?.nextSeq ?? 1;
    const events = drafts.map((draft) => prepareDurableTraceEvent(sessionId, { ...draft, sourceInstanceId, sourceSeq: sequence++ }));
    const transaction = this.db.transaction([EVENT_STORE, SESSION_STORE], "readwrite"); events.forEach((event) => transaction.objectStore(EVENT_STORE).put(event)); transaction.objectStore(SESSION_STORE).put({ ...(current ?? { sessionId, writeCapability: "", readCapability: "", sourceInstanceId }), nextSeq: sequence, sourceInstanceId });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); }); return events;
  }
  async flush(sessionId: string, transport: TraceTransport) {
    const session = await this.session(sessionId); if (!session?.writeCapability) return { acknowledged: [] as DurableTraceEvent[], pending: await this.pendingCount(sessionId) };
    const all = await result(this.db.transaction(EVENT_STORE).objectStore(EVENT_STORE).getAll()) as DurableTraceEvent[]; const batch = all.filter((event) => event.sessionId === sessionId).sort((a, b) => a.sourceSeq - b.sourceSeq).slice(0, MAX_BATCH);
    if (!batch.length) return { acknowledged: [], pending: 0 };
    const acknowledged = await transport.append(sessionId, session.writeCapability, batch); const transaction = this.db.transaction(EVENT_STORE, "readwrite"); acknowledged.forEach((event) => transaction.objectStore(EVENT_STORE).delete(event.id)); await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); return { acknowledged, pending: await this.pendingCount(sessionId) };
  }
  async pendingCount(sessionId: string) { const all = await result(this.db.transaction(EVENT_STORE).objectStore(EVENT_STORE).getAll()) as DurableTraceEvent[]; return all.filter((event) => event.sessionId === sessionId).length; }
}
