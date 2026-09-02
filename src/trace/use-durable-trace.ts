import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import packageMetadata from "../../package.json";
import { compareTraceEvents, isHumanTimelineEvent, type DurableTraceEvent, type DurableTraceEventDraft } from "./durable-trace";
import { LocalTraceStore } from "./session-store";
import { TraceWriter, type TraceWriterSnapshot } from "./trace-writer";
import type { TeachingTraceState } from "../session/teaching-trace";
import { teachingTraceEventToDurable } from "../session/teaching-trace-persistence";

const RAW_VIEW_LIMIT = 300;
function mergeEvents(current: DurableTraceEvent[], added: DurableTraceEvent[]) {
  const merged = [...new Map([...current, ...added].map((event) => [event.id, event])).values()].sort(compareTraceEvents);
  const timeline = merged.filter(isHumanTimelineEvent);
  const rawWindow = merged.filter((event) => !isHumanTimelineEvent(event)).slice(-RAW_VIEW_LIMIT);
  return [...timeline, ...rawWindow].sort(compareTraceEvents);
}

export function useDurableTrace({ sessionId, isNewSession, liveTrace }: { sessionId: string; isNewSession: boolean; liveTrace: TeachingTraceState }) {
  const pageInstanceId = useMemo(() => `browser-${crypto.randomUUID()}`, [sessionId]);
  const storeRef = useRef<LocalTraceStore | undefined>(undefined);
  const writerRef = useRef<TraceWriter | undefined>(undefined);
  const completionRef = useRef<"none" | "requested" | "completing" | "done">("none");
  const seenTransientIds = useRef(new Set<string>());
  const [events, setEvents] = useState<DurableTraceEvent[]>([]);
  const [status, setStatus] = useState<"loading" | "healthy" | "recovering" | "degraded">("loading");
  const [error, setError] = useState<string>();
  const [pendingCount, setPendingCount] = useState(0);

  const applyWriterState = useCallback((snapshot: TraceWriterSnapshot) => {
    setPendingCount(snapshot.pendingCount);
    setStatus(snapshot.status);
    setError(snapshot.error);
  }, []);

  const finishCompletion = useCallback(async () => {
    const store = storeRef.current;
    if (!store || completionRef.current !== "requested") return;
    completionRef.current = "completing";
    try {
      await store.completeSession(sessionId);
      completionRef.current = "done";
    } catch (reason) {
      completionRef.current = "requested";
      setStatus("degraded");
      setError(reason instanceof Error ? reason.message : "trace-local-store-unavailable");
    }
  }, [sessionId]);

  const append = useCallback((drafts: DurableTraceEventDraft[]) => {
    writerRef.current?.enqueue(drafts);
  }, []);

  const reload = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
    try {
      setEvents(await store.humanTraceEvents(sessionId, RAW_VIEW_LIMIT));
      const snapshot = writerRef.current?.snapshot;
      if (snapshot) applyWriterState(snapshot);
    } catch (reason) {
      setStatus("degraded");
      setError(reason instanceof Error ? reason.message : "trace-local-store-unavailable");
    }
  }, [applyWriterState, sessionId]);

  useEffect(() => {
    let cancelled = false;
    seenTransientIds.current = new Set();
    completionRef.current = "none";
    storeRef.current = undefined;
    setEvents([]);
    setStatus("loading");
    setError(undefined);
    setPendingCount(0);
    const writer = new TraceWriter(
      async (drafts) => {
        const store = storeRef.current;
        if (!store) throw new Error("trace-local-store-unavailable");
        return store.append(sessionId, drafts, pageInstanceId);
      },
      {
        onAccepted: (accepted) => { if (!cancelled) setEvents((current) => mergeEvents(current, accepted)); },
        onState: (snapshot) => { if (!cancelled && storeRef.current) applyWriterState(snapshot); },
      },
    );
    writerRef.current = writer;

    void (async () => {
      try {
        const store = await LocalTraceStore.open();
        if (cancelled) return;
        storeRef.current = store;
        await store.ensureSession(sessionId);
        writer.enqueue([{
          id: `${pageInstanceId}:session-${isNewSession ? "started" : "reloaded"}`,
          occurredAt: new Date().toISOString(),
          stage: "session",
          type: isNewSession ? "session.started" : "session.reloaded",
          payload: { schemaVersion: 1, appVersion: packageMetadata.version, buildVersion: import.meta.env.VITE_CUELAYER_BUILD_VERSION ?? import.meta.env.MODE, environment: import.meta.env.MODE, url: window.location.pathname },
          source: "browser",
        }]);
        await writer.flush();
        if (!cancelled) setEvents(await store.humanTraceEvents(sessionId, RAW_VIEW_LIMIT));
      } catch (reason) {
        if (!cancelled) {
          setStatus("degraded");
          setError(reason instanceof Error ? reason.message : "trace-local-store-unavailable");
        }
      }
    })();

    return () => {
      cancelled = true;
      writer.close();
      if (writerRef.current === writer) writerRef.current = undefined;
    };
  }, [applyWriterState, isNewSession, pageInstanceId, sessionId]);

  useEffect(() => {
    const drafts = liveTrace.events.flatMap((event) => seenTransientIds.current.has(event.id) ? [] : (seenTransientIds.current.add(event.id), [teachingTraceEventToDurable(event, pageInstanceId)]));
    append(drafts);
  }, [append, liveTrace.events, pageInstanceId]);

  useEffect(() => {
    if (status === "healthy" && pendingCount === 0 && completionRef.current === "requested") void finishCompletion();
  }, [finishCompletion, pendingCount, status]);

  const complete = useCallback(async () => {
    completionRef.current = "requested";
    try {
      await writerRef.current?.flush();
      await finishCompletion();
    } catch (reason) {
      setStatus("degraded");
      setError(reason instanceof Error ? reason.message : "trace-local-store-unavailable");
    }
  }, [finishCompletion]);

  const exportJsonl = useCallback(async () => {
    const store = storeRef.current;
    if (!store) throw new Error("trace-local-store-unavailable");
    try { await writerRef.current?.flush(); } catch { /* Export the durable prefix and keep the degraded state visible. */ }
    const url = URL.createObjectURL(await store.exportJsonlBlob(sessionId));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cuelayer-session-${sessionId}.jsonl`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [sessionId]);

  return { sessionId, events, status, error, append, reload, complete, pendingCount, exportJsonl, pageInstanceId };
}
