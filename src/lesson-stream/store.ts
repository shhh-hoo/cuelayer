import type { LessonEvent } from "./contracts";

const DATABASE_NAME = "cuelayer-lesson-stream-v1";
const DATABASE_VERSION = 1;
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

export class LocalLessonEventStore {
  private constructor(private readonly database: IDBDatabase) {}

  static async open() { return new LocalLessonEventStore(await openDatabase()); }
  close() { this.database.close(); }

  async append(events: readonly LessonEvent[]) {
    if (!events.length) return;
    const transaction = this.database.transaction(EVENTS_STORE, "readwrite");
    const store = transaction.objectStore(EVENTS_STORE);
    for (const event of events) store.put(event);
    await transactionDone(transaction);
  }

  async readSession(sessionId: string) {
    const index = this.database.transaction(EVENTS_STORE).objectStore(EVENTS_STORE).index(SESSION_SEQUENCE_INDEX);
    const range = IDBKeyRange.bound([sessionId, 0, ""], [sessionId, Number.MAX_SAFE_INTEGER, "\uffff"]);
    return requestResult(index.getAll(range)) as Promise<LessonEvent[]>;
  }
}
