import { useCallback, useEffect, useRef, useState } from "react";
import { defaultTracePriority, traceDraft, type SessionTraceDraft, type SessionTraceEvent, type TraceEmitter } from "./contracts";
import { replaceTraceSessionId, resolveTraceSessionIdentity } from "./session-identity";
import { SessionTraceRuntime, type SessionTraceRuntimeSnapshot } from "./runtime";

const INITIAL_PENDING_LIMIT = 256;

export type SessionTraceController = {
  sessionId: string;
  snapshot: SessionTraceRuntimeSnapshot | { status: "initializing" | "degraded"; pendingCount: number; droppedCount: number; consecutiveFailures: number; completed: false; sourceInstanceId?: string; error?: string };
  emit: TraceEmitter;
  flush(): Promise<void>;
  complete(reason: string): Promise<void>;
  readRecent(limit?: number): Promise<SessionTraceEvent[]>;
  exportJsonlBlob(): Promise<Blob>;
};

type PendingState = { drafts: SessionTraceDraft[]; dropped: Map<string, number> };

function initialSnapshot() {
  return { status: "initializing" as const, pendingCount: 0, droppedCount: 0, consecutiveFailures: 0, completed: false as const };
}

function queueBeforeRuntime(pending: PendingState, draft: SessionTraceDraft) {
  if (pending.drafts.length >= INITIAL_PENDING_LIMIT) {
    const rawIndex = pending.drafts.findIndex((item) => (item.priority ?? defaultTracePriority(item.type)) === "raw");
    const aggregateIndex = pending.drafts.findIndex((item) => (item.priority ?? defaultTracePriority(item.type)) === "aggregate");
    const index = rawIndex >= 0 ? rawIndex : aggregateIndex >= 0 ? aggregateIndex : 0;
    const [removed] = pending.drafts.splice(index, 1);
    if (removed) pending.dropped.set(removed.type, (pending.dropped.get(removed.type) ?? 0) + 1);
  }
  pending.drafts.push(draft);
}

export function useSessionTrace(): SessionTraceController {
  const [requestedIdentity] = useState(() => resolveTraceSessionIdentity(window.location, window.history));
  const [sessionId, setSessionId] = useState(requestedIdentity.sessionId);
  const runtimeRef = useRef<SessionTraceRuntime | undefined>(undefined);
  const pendingRef = useRef<PendingState>({ drafts: [], dropped: new Map() });
  const [snapshot, setSnapshot] = useState<SessionTraceController["snapshot"]>(initialSnapshot);

  const emit = useCallback<TraceEmitter>((draft) => {
    const runtime = runtimeRef.current;
    if (runtime) runtime.emit(draft);
    else queueBeforeRuntime(pendingRef.current, draft);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let statusTimer: number | undefined;
    const flushOnHide = () => { void runtimeRef.current?.flush().catch(() => undefined); };
    const onVisibilityChange = () => { if (document.visibilityState === "hidden") flushOnHide(); };

    void SessionTraceRuntime.open({
      requestedSessionId: requestedIdentity.sessionId,
      path: window.location.pathname,
      environment: import.meta.env.MODE,
    }).then((runtime) => {
      if (cancelled) {
        runtime.close();
        return;
      }
      runtimeRef.current = runtime;
      if (runtime.sessionId !== requestedIdentity.sessionId) {
        replaceTraceSessionId(window.location, window.history, runtime.sessionId);
        setSessionId(runtime.sessionId);
      }
      const pending = pendingRef.current;
      if (pending.dropped.size) {
        runtime.emit(traceDraft("trace.gap", { reason: "initialization_pressure", dropped: Object.fromEntries(pending.dropped) }, { priority: "critical" }));
      }
      for (const draft of pending.drafts) runtime.emit(draft);
      pendingRef.current = { drafts: [], dropped: new Map() };
      setSnapshot(runtime.snapshot);
      statusTimer = window.setInterval(() => setSnapshot(runtime.snapshot), 500);
      window.addEventListener("pagehide", flushOnHide);
      document.addEventListener("visibilitychange", onVisibilityChange);
    }).catch((reason) => {
      if (cancelled) return;
      const message = reason instanceof Error ? reason.message : "trace-local-store-unavailable";
      setSnapshot({ status: "degraded", pendingCount: pendingRef.current.drafts.length, droppedCount: [...pendingRef.current.dropped.values()].reduce((sum, count) => sum + count, 0), consecutiveFailures: 1, completed: false, error: message });
    });

    return () => {
      cancelled = true;
      if (statusTimer !== undefined) window.clearInterval(statusTimer);
      window.removeEventListener("pagehide", flushOnHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const runtime = runtimeRef.current;
      runtimeRef.current = undefined;
      if (runtime) void runtime.flush().catch(() => undefined).finally(() => runtime.close());
    };
  }, [requestedIdentity]);

  const flush = useCallback(async () => {
    await runtimeRef.current?.flush();
    if (runtimeRef.current) setSnapshot(runtimeRef.current.snapshot);
  }, []);

  const complete = useCallback(async (reason: string) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    try {
      await runtime.complete(reason);
      setSnapshot(runtime.snapshot);
    } catch (error) {
      const current = runtime.snapshot;
      setSnapshot({ ...current, status: "degraded", error: error instanceof Error ? error.message : "trace-completion-failed" });
    }
  }, []);

  const readRecent = useCallback(async (limit = 240) => runtimeRef.current?.readRecent(limit) ?? [], []);
  const exportJsonlBlob = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error("trace-not-ready");
    return runtime.exportJsonlBlob();
  }, []);

  return { sessionId, snapshot, emit, flush, complete, readRecent, exportJsonlBlob };
}
