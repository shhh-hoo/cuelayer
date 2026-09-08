import type { LessonEvent } from "./contracts.ts";
import { assertLessonDomain, type LessonDomain } from "./session-domain.ts";

export type StoredLessonEvent = { schemaVersion: string; eventId: string; sessionId: string; sequence: number };

const DATABASE_NAME = "cuelayer-lesson-stream-v1";
const DATABASE_VERSION = 2;
const DOMAINS_STORE = "lesson-domains";
const EVENTS_STORE = "lesson-events";
const SESSION_SEQUENCE_INDEX = "session-sequence";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("lesson-store-request-failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("lesson-store-transaction-failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("lesson-store-transaction-aborted"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("lesson-indexeddb-unavailable"));
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DOMAINS_STORE)) request.result.createObjectStore(DOMAINS_STORE, { keyPath: "sessionId" });
      const store = request.result.objectStoreNames.contains(EVENTS_STORE)
        ? request.transaction!.objectStore(EVENTS_STORE)
        : request.result.createObjectStore(EVENTS_STORE, { keyPath: "eventId" });
      if (!store.indexNames.contains(SESSION_SEQUENCE_INDEX)) store.createIndex(SESSION_SEQUENCE_INDEX, ["sessionId", "sequence", "eventId"], { unique: false });
    };
    request.onblocked = () => reject(new Error("lesson-indexeddb-upgrade-blocked"));
    request.onerror = () => reject(request.error ?? new Error("lesson-indexeddb-open-failed"));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

/** One database/claim namespace for both domains; event bodies remain strongly typed. */
export class LocalLessonEventStore<E extends StoredLessonEvent = LessonEvent> {
  private readonly database: IDBDatabase;
  readonly domain: LessonDomain;
  private constructor(database: IDBDatabase, domain: LessonDomain) { this.database = database; this.domain = domain; }

  static async open<E extends StoredLessonEvent = LessonEvent>(domain: LessonDomain = "legacy") {
    return new LocalLessonEventStore<E>(await openDatabase(), domain);
  }
  close() { this.database.close(); }

  private async session(transaction: IDBTransaction, sessionId: string) {
    const domains = transaction.objectStore(DOMAINS_STORE);
    const claim = await requestResult(domains.get(sessionId)) as { domain: LessonDomain } | undefined;
    if (claim && claim.domain !== this.domain) throw new Error("lesson-domain-mismatch");
    const index = transaction.objectStore(EVENTS_STORE).index(SESSION_SEQUENCE_INDEX);
    const range = IDBKeyRange.bound([sessionId, 0, ""], [sessionId, Number.MAX_SAFE_INTEGER, "\uffff"]);
    const events = await requestResult(index.getAll(range)) as E[];
    // Historical envelopes must match before establishing the claim. Later
    // reads/writes validate against that fixed domain, never select another one.
    assertLessonDomain(events, this.domain);
    if (!claim) domains.add({ sessionId, domain: this.domain });
    return events;
  }

  async append(events: readonly E[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!events.length) return;
    const sessionId = events[0]!.sessionId;
    if (events.some(e => e.sessionId !== sessionId)) throw new Error("lesson-store-session-mismatch");
    assertLessonDomain(events, this.domain);
    const transaction = this.database.transaction([EVENTS_STORE, DOMAINS_STORE], "readwrite");
    const done = transactionDone(transaction);
    void done.catch(() => undefined);
    const abort = () => { try { transaction.abort(); } catch { /* Commit has already won. */ } };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const claim = await requestResult(transaction.objectStore(DOMAINS_STORE).get(sessionId)) as { domain: LessonDomain } | undefined;
      if (claim && claim.domain !== this.domain) throw new Error("lesson-domain-mismatch");
      if (!claim) await this.session(transaction, sessionId);
      signal?.throwIfAborted();
      const store = transaction.objectStore(EVENTS_STORE);
      const range = IDBKeyRange.bound([sessionId, 0, ""], [sessionId, Number.MAX_SAFE_INTEGER, "\uffff"]);
      // Once claimed, appends read only the tail and this batch's identities,
      // not the entire unbounded lesson history on the publication path.
      const tail = await requestResult(store.index(SESSION_SEQUENCE_INDEX).openCursor(range, "prev"));
      let sequence = (tail?.value as E | undefined)?.sequence ?? 0;
      const known = new Map<string, E>();
      for (const event of events) {
        const duplicate = known.get(event.eventId) ?? await requestResult(store.get(event.eventId)) as E | undefined;
        if (duplicate) {
          if (JSON.stringify(duplicate) !== JSON.stringify(event)) throw new Error("lesson-store-identity-conflict");
          continue;
        }
        if (event.sequence !== sequence + 1) throw new Error("lesson-store-sequence-conflict");
        store.add(event); // Append-only: a competing writer cannot replace accepted evidence.
        known.set(event.eventId, event);
        sequence = event.sequence;
      }
      // Resolution means committed, even if cancellation arrives just after it.
      await done;
    } catch (error) { abort(); await done.catch(() => undefined); throw error; }
    finally { signal?.removeEventListener("abort", abort); }
  }

  async readSession(sessionId: string): Promise<E[]> {
    const transaction = this.database.transaction([EVENTS_STORE, DOMAINS_STORE], "readwrite");
    const done = transactionDone(transaction);
    void done.catch(() => undefined);
    try {
      const events = await this.session(transaction, sessionId);
      await done;
      return events;
    } catch (error) {
      try { transaction.abort(); } catch { /* Finished. */ }
      await done.catch(() => undefined);
      throw error;
    }
  }
}
