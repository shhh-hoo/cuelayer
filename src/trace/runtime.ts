import packageMetadata from "../../package.json";
import { traceDraft, type SessionTraceDraft, type SessionTraceEvent } from "./contracts";
import { createTraceSessionId } from "./session-identity";
import { LocalTraceStore, type TraceSessionMetadata } from "./store";
import { TraceWriter, type TraceWriterSnapshot } from "./writer";

export type SessionTraceRuntimeOptions = {
  requestedSessionId: string;
  path: string;
  environment: string;
  sourceInstanceId?: string;
};

export type SessionTraceRuntimeSnapshot = TraceWriterSnapshot & {
  sessionId: string;
  sourceInstanceId: string;
  completed: boolean;
};

function sourceInstanceId() {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `browser-${suffix}`;
}

export class SessionTraceRuntime {
  readonly sessionId: string;
  readonly sourceInstanceId: string;
  readonly replacedSessionId?: string;
  private completed = false;
  private closed = false;

  private constructor(
    sessionId: string,
    sourceId: string,
    private readonly store: LocalTraceStore,
    private readonly writer: TraceWriter,
    replacedSessionId?: string,
  ) {
    this.sessionId = sessionId;
    this.sourceInstanceId = sourceId;
    this.replacedSessionId = replacedSessionId;
  }

  static async open(options: SessionTraceRuntimeOptions) {
    const store = await LocalTraceStore.open();
    const metadata: TraceSessionMetadata = {
      appVersion: packageMetadata.version,
      environment: options.environment,
      path: options.path,
    };
    let sessionId = options.requestedSessionId;
    let existing = await store.getSession(sessionId);
    let replacedSessionId: string | undefined;
    if (existing?.status === "completed") {
      replacedSessionId = sessionId;
      sessionId = createTraceSessionId();
      existing = undefined;
    }
    let ensured = await store.ensureActiveSession(sessionId, metadata);
    if (ensured.record.status === "completed") {
      replacedSessionId ??= sessionId;
      sessionId = createTraceSessionId();
      ensured = await store.ensureActiveSession(sessionId, metadata);
    }
    const sourceId = options.sourceInstanceId ?? sourceInstanceId();
    const writer = new TraceWriter(sessionId, sourceId, (events) => store.appendBatch(sessionId, events));
    const runtime = new SessionTraceRuntime(sessionId, sourceId, store, writer, replacedSessionId);
    if (ensured.created) {
      runtime.emit(traceDraft("session.started", {
        reason: replacedSessionId ? "completed_url_replaced" : "new_url",
        path: options.path,
        appVersion: packageMetadata.version,
        environment: options.environment,
        ...(replacedSessionId ? { replacedSessionId } : {}),
      }));
    } else {
      runtime.emit(traceDraft("session.reloaded", {
        path: options.path,
        appVersion: packageMetadata.version,
        environment: options.environment,
      }));
    }
    return runtime;
  }

  get snapshot(): SessionTraceRuntimeSnapshot {
    return {
      ...this.writer.snapshot,
      sessionId: this.sessionId,
      sourceInstanceId: this.sourceInstanceId,
      completed: this.completed,
    };
  }

  emit(draft: SessionTraceDraft) {
    if (this.closed || this.completed) return;
    this.writer.emit(draft);
  }

  async flush() {
    if (this.closed) return;
    await this.writer.flush();
  }

  async readRecent(limit = 240): Promise<SessionTraceEvent[]> {
    // The viewer reads the latest durable prefix. It never forces the live
    // writer to flush outside its normal batching schedule.
    return this.store.readRecent(this.sessionId, limit);
  }

  async exportJsonlBlob() {
    try { await this.writer.flush(); } catch { /* Export the durable prefix and keep degradation visible. */ }
    return this.store.exportJsonlBlob(this.sessionId);
  }

  async complete(reason: string) {
    if (this.closed || this.completed) return;
    this.writer.emit(traceDraft("session.ended", { reason }, { priority: "critical" }));
    await this.writer.flush();
    await this.store.completeSession(this.sessionId);
    this.completed = true;
    // Completion seals writes but deliberately keeps IndexedDB readable so the
    // ended session can still be inspected and exported until the page closes.
    this.writer.close();
    await this.store.pruneCompleted();
  }

  close() {
    if (this.closed) return;
    this.writer.close();
    this.store.close();
    this.closed = true;
  }
}
