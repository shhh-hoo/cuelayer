import { prepareDurableTraceEvent, type DurableTraceEvent, type DurableTraceEventDraft } from "./durable-trace";
import type { TraceCapabilities, TraceTransport } from "./trace-client";

const DATABASE = "cuelayer-trace-outbox-v1";
const EVENT_STORE = "events";
const SESSION_STORE = "sessions";
const SESSION_INDEX = "sessionId";
const SESSION_SEQUENCE_INDEX = "session_sourceSeq";
const MAX_BATCH = 50;
export type StoredSession = TraceCapabilities & { sessionId: string; sourceInstanceId: string; nextSeq: number };

function base64Url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function randomCapability() { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return base64Url(bytes); }
export function createBrowserTraceSession(sessionId: string): StoredSession { return { sessionId, writeCapability: randomCapability(), readCapability: randomCapability(), sourceInstanceId: `browser-${crypto.randomUUID()}`, nextSeq: 1 }; }

function openDatabase(): Promise<IDBDatabase> { return new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE, 2);
  request.onupgradeneeded = () => {
    const events = request.result.objectStoreNames.contains(EVENT_STORE) ? request.transaction!.objectStore(EVENT_STORE) : request.result.createObjectStore(EVENT_STORE, { keyPath: "id" });
    if (!events.indexNames.contains(SESSION_INDEX)) events.createIndex(SESSION_INDEX, "sessionId", { unique: false });
    if (!events.indexNames.contains(SESSION_SEQUENCE_INDEX)) events.createIndex(SESSION_SEQUENCE_INDEX, ["sessionId", "sourceSeq"], { unique: false });
    if (!request.result.objectStoreNames.contains(SESSION_STORE)) request.result.createObjectStore(SESSION_STORE, { keyPath: "sessionId" });
  };
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
}); }
function result<T>(request: IDBRequest<T>) { return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function complete(transaction: IDBTransaction) { return new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); }); }

export class TraceOutbox {
  private static readonly flights = new Map<string, Promise<{ acknowledged: DurableTraceEvent[]; pending: number }>>();
  private constructor(private readonly db: IDBDatabase) {}
  static async open() { return new TraceOutbox(await openDatabase()); }
  async session(sessionId: string) { return result(this.db.transaction(SESSION_STORE).objectStore(SESSION_STORE).get(sessionId)) as Promise<StoredSession | undefined>; }
  async saveSession(session: StoredSession) { await result(this.db.transaction(SESSION_STORE, "readwrite").objectStore(SESSION_STORE).put(session)); }
  async ensureLocalSession(sessionId: string) { const existing = await this.session(sessionId); if (existing) return existing; const created = createBrowserTraceSession(sessionId); await this.saveSession(created); return created; }
  async enqueue(sessionId: string, drafts: DurableTraceEventDraft[], sourceInstanceId: string) {
    const current = await this.session(sessionId); let sequence = current?.nextSeq ?? 1;
    const events = drafts.map((draft) => prepareDurableTraceEvent(sessionId, { ...draft, sourceInstanceId, sourceSeq: sequence++ }));
    const transaction = this.db.transaction([EVENT_STORE, SESSION_STORE], "readwrite"); const eventStore = transaction.objectStore(EVENT_STORE);
    events.forEach((event) => eventStore.put(event)); transaction.objectStore(SESSION_STORE).put({ ...(current ?? createBrowserTraceSession(sessionId)), nextSeq: sequence, sourceInstanceId });
    await complete(transaction); return events;
  }
  private async nextBatch(sessionId: string) {
    const transaction = this.db.transaction(EVENT_STORE); const index = transaction.objectStore(EVENT_STORE).index(SESSION_SEQUENCE_INDEX); const range = IDBKeyRange.lowerBound([sessionId, 0]); const events: DurableTraceEvent[] = [];
    await new Promise<void>((resolve, reject) => { const request = index.openCursor(range); request.onerror = () => reject(request.error); request.onsuccess = () => { const cursor = request.result; if (!cursor || (cursor.key as [string, number])[0] !== sessionId || events.length >= MAX_BATCH) { resolve(); return; } events.push(cursor.value as DurableTraceEvent); cursor.continue(); }; });
    return events;
  }
  async flush(sessionId: string, transport: TraceTransport) {
    const active = TraceOutbox.flights.get(sessionId); if (active) return active;
    const flight = this.flushOnce(sessionId, transport).finally(() => { if (TraceOutbox.flights.get(sessionId) === flight) TraceOutbox.flights.delete(sessionId); });
    TraceOutbox.flights.set(sessionId, flight); return flight;
  }
  private async flushOnce(sessionId: string, transport: TraceTransport) {
    const session = await this.session(sessionId); if (!session?.writeCapability) return { acknowledged: [] as DurableTraceEvent[], pending: await this.pendingCount(sessionId) };
    const batch = await this.nextBatch(sessionId); if (!batch.length) return { acknowledged: [], pending: 0 };
    const acknowledged = await transport.append(sessionId, session.writeCapability, batch); const transaction = this.db.transaction(EVENT_STORE, "readwrite"); acknowledged.forEach((event) => transaction.objectStore(EVENT_STORE).delete(event.id)); await complete(transaction);
    return { acknowledged, pending: await this.pendingCount(sessionId) };
  }
  async pendingCount(sessionId: string) { return result(this.db.transaction(EVENT_STORE).objectStore(EVENT_STORE).index(SESSION_INDEX).count(sessionId)); }
}

/** Local credentials are committed before the idempotent remote provision request. */
export async function provisionBrowserTraceSession(outbox: TraceOutbox, sessionId: string, transport: TraceTransport, metadata: unknown) {
  const session = await outbox.ensureLocalSession(sessionId);
  await transport.createSession(sessionId, session, metadata);
  return session;
}
