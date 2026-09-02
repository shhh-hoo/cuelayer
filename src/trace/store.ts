import { compareTraceEvents, sanitizeTraceEvent, type SessionTraceEvent } from "./contracts";

const DATABASE_NAME = "cuelayer-local-trace-v2";
const DATABASE_VERSION = 1;
const EVENTS_STORE = "events";
const SESSIONS_STORE = "sessions";
const SESSION_ORDER_INDEX = "sessionOrder";
const SESSION_ID_INDEX = "sessionId";
const EXPORT_CHUNK_SIZE = 64 * 1024;
const RETAIN_COMPLETED = 5;

export type TraceSessionStatus = "active" | "completed" | "abandoned";

export type TraceSessionRecord = {
  sessionId: string;
  status: TraceSessionStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  appVersion: string;
  environment: string;
  path: string;
};

export type TraceSessionMetadata = Pick<TraceSessionRecord, "appVersion" | "environment" | "path">;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("trace-indexeddb-request-failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("trace-indexeddb-transaction-failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("trace-indexeddb-transaction-aborted"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("trace-indexeddb-unavailable"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const events = database.objectStoreNames.contains(EVENTS_STORE)
        ? request.transaction!.objectStore(EVENTS_STORE)
        : database.createObjectStore(EVENTS_STORE, { keyPath: "eventId" });
      if (!events.indexNames.contains(SESSION_ID_INDEX)) events.createIndex(SESSION_ID_INDEX, "sessionId", { unique: false });
      if (!events.indexNames.contains(SESSION_ORDER_INDEX)) {
        events.createIndex(SESSION_ORDER_INDEX, ["sessionId", "occurredAt", "sourceInstanceId", "sourceSeq", "eventId"], { unique: false });
      }
      if (!database.objectStoreNames.contains(SESSIONS_STORE)) database.createObjectStore(SESSIONS_STORE, { keyPath: "sessionId" });
    };
    request.onblocked = () => reject(new Error("trace-indexeddb-upgrade-blocked"));
    request.onerror = () => reject(request.error ?? new Error("trace-indexeddb-open-failed"));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function sessionOrderRange(sessionId: string) {
  return IDBKeyRange.bound(
    [sessionId, "", "", 0, ""],
    [sessionId, "\uffff", "\uffff", Number.MAX_SAFE_INTEGER, "\uffff"],
  );
}

function newSession(sessionId: string, metadata: TraceSessionMetadata): TraceSessionRecord {
  const now = new Date().toISOString();
  return { sessionId, status: "active", createdAt: now, updatedAt: now, ...metadata };
}

export class LocalTraceStore {
  private constructor(private readonly database: IDBDatabase) {}

  static async open() {
    return new LocalTraceStore(await openDatabase());
  }

  close() {
    this.database.close();
  }

  async getSession(sessionId: string) {
    return requestResult(this.database.transaction(SESSIONS_STORE).objectStore(SESSIONS_STORE).get(sessionId)) as Promise<TraceSessionRecord | undefined>;
  }

  async ensureActiveSession(sessionId: string, metadata: TraceSessionMetadata) {
    const existing = await this.getSession(sessionId);
    if (existing) return { record: existing, created: false };
    const record = newSession(sessionId, metadata);
    const transaction = this.database.transaction(SESSIONS_STORE, "readwrite");
    transaction.objectStore(SESSIONS_STORE).put(record);
    await transactionDone(transaction);
    return { record, created: true };
  }

  async appendBatch(sessionId: string, events: readonly SessionTraceEvent[]) {
    if (!events.length) return;
    const sanitized = events.map(sanitizeTraceEvent);
    const latestOccurredAt = sanitized.reduce((latest, event) => event.occurredAt > latest ? event.occurredAt : latest, "");
    let explicitError: Error | undefined;
    const transaction = this.database.transaction([EVENTS_STORE, SESSIONS_STORE], "readwrite");
    const eventStore = transaction.objectStore(EVENTS_STORE);
    const sessionStore = transaction.objectStore(SESSIONS_STORE);
    const sessionRequest = sessionStore.get(sessionId);
    sessionRequest.onsuccess = () => {
      const session = sessionRequest.result as TraceSessionRecord | undefined;
      if (!session) {
        explicitError = new Error("trace-session-missing");
        transaction.abort();
        return;
      }
      if (session.status === "completed") {
        explicitError = new Error("trace-session-completed");
        transaction.abort();
        return;
      }
      for (const event of sanitized) eventStore.put(event);
      sessionStore.put({ ...session, updatedAt: latestOccurredAt || new Date().toISOString() });
    };
    sessionRequest.onerror = () => {
      explicitError = sessionRequest.error ?? new Error("trace-session-read-failed");
      transaction.abort();
    };
    try {
      await transactionDone(transaction);
    } catch (error) {
      throw explicitError ?? error;
    }
  }

  async completeSession(sessionId: string) {
    let explicitError: Error | undefined;
    const transaction = this.database.transaction(SESSIONS_STORE, "readwrite");
    const store = transaction.objectStore(SESSIONS_STORE);
    const request = store.get(sessionId);
    request.onsuccess = () => {
      const session = request.result as TraceSessionRecord | undefined;
      if (!session || session.status === "completed") return;
      const now = new Date().toISOString();
      store.put({ ...session, status: "completed", completedAt: now, updatedAt: now });
    };
    request.onerror = () => {
      explicitError = request.error ?? new Error("trace-session-read-failed");
      transaction.abort();
    };
    try {
      await transactionDone(transaction);
    } catch (error) {
      throw explicitError ?? error;
    }
  }

  async readRecent(sessionId: string, limit: number) {
    if (limit <= 0) return [];
    const index = this.database.transaction(EVENTS_STORE).objectStore(EVENTS_STORE).index(SESSION_ORDER_INDEX);
    const events: SessionTraceEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      const cursor = index.openCursor(sessionOrderRange(sessionId), "prev");
      cursor.onerror = () => reject(cursor.error ?? new Error("trace-indexeddb-cursor-failed"));
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current || events.length >= limit) {
          resolve();
          return;
        }
        events.push(current.value as SessionTraceEvent);
        current.continue();
      };
    });
    return events.sort(compareTraceEvents);
  }

  async exportJsonlBlob(sessionId: string) {
    const index = this.database.transaction(EVENTS_STORE).objectStore(EVENTS_STORE).index(SESSION_ORDER_INDEX);
    const chunks: BlobPart[] = [];
    let chunk = "";
    await new Promise<void>((resolve, reject) => {
      const cursor = index.openCursor(sessionOrderRange(sessionId));
      cursor.onerror = () => reject(cursor.error ?? new Error("trace-indexeddb-cursor-failed"));
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) {
          if (chunk) chunks.push(chunk);
          resolve();
          return;
        }
        chunk += `${JSON.stringify(current.value)}\n`;
        if (chunk.length >= EXPORT_CHUNK_SIZE) {
          chunks.push(chunk);
          chunk = "";
        }
        current.continue();
      };
    });
    return new Blob(chunks, { type: "application/x-ndjson" });
  }

  async listSessions() {
    const sessions = await requestResult(this.database.transaction(SESSIONS_STORE).objectStore(SESSIONS_STORE).getAll()) as TraceSessionRecord[];
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async pruneCompleted(retain = RETAIN_COMPLETED) {
    const completed = (await this.listSessions())
      .filter((session) => session.status === "completed")
      .sort((left, right) => (right.completedAt ?? right.updatedAt).localeCompare(left.completedAt ?? left.updatedAt));
    for (const session of completed.slice(Math.max(0, retain))) await this.deleteSession(session.sessionId);
  }

  async deleteSession(sessionId: string) {
    const transaction = this.database.transaction([EVENTS_STORE, SESSIONS_STORE], "readwrite");
    const events = transaction.objectStore(EVENTS_STORE).index(SESSION_ID_INDEX);
    transaction.objectStore(SESSIONS_STORE).delete(sessionId);
    await new Promise<void>((resolve, reject) => {
      const cursor = events.openCursor(IDBKeyRange.only(sessionId));
      cursor.onerror = () => reject(cursor.error ?? new Error("trace-indexeddb-cursor-failed"));
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) {
          resolve();
          return;
        }
        current.delete();
        current.continue();
      };
    });
    await transactionDone(transaction);
  }
}
