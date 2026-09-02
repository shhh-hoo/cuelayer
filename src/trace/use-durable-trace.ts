import { useCallback, useEffect, useRef, useState } from "react";
import packageMetadata from "../../package.json";
import { compareTraceEvents, traceEventsToJsonl, type DurableTraceEvent, type DurableTraceEventDraft } from "./durable-trace";
import { LocalTraceStore } from "./session-store";
import type { TeachingTraceState } from "../session/teaching-trace";
import { teachingTraceEventToDurable } from "../session/teaching-trace-persistence";

const VIEW_LIMIT = 300;
function mergeBounded(current: DurableTraceEvent[], added: DurableTraceEvent[]) { return [...new Map([...current, ...added].map((event) => [event.id, event])).values()].sort(compareTraceEvents).slice(-VIEW_LIMIT); }

export function useDurableTrace({ sessionId, isNewSession, liveTrace }: { sessionId: string; isNewSession: boolean; liveTrace: TeachingTraceState }) {
  const pageInstanceId = useRef(`browser-${crypto.randomUUID()}`); const storeRef = useRef<LocalTraceStore | undefined>(undefined); const seenTransientIds = useRef(new Set<string>()); const pendingRef = useRef<DurableTraceEventDraft[]>([]);
  const [events, setEvents] = useState<DurableTraceEvent[]>([]); const [status, setStatus] = useState<"loading" | "healthy" | "degraded">("loading"); const [error, setError] = useState<string>(); const [pendingCount, setPendingCount] = useState(0);

  const append = useCallback(async (drafts: DurableTraceEventDraft[]) => {
    const store = storeRef.current;
    if (!store) { pendingRef.current.push(...drafts); return []; }
    try { const queued = await store.append(sessionId, drafts, pageInstanceId.current); setEvents((current) => mergeBounded(current, queued)); setPendingCount(0); setStatus("healthy"); return queued; }
    catch (reason) { pendingRef.current.push(...drafts); setStatus("degraded"); setError(reason instanceof Error ? reason.message : "trace-local-store-unavailable"); return []; }
  }, [sessionId]);

  const reload = useCallback(async () => {
    const store = storeRef.current; if (!store) return; setStatus("loading");
    try { setEvents((await store.events(sessionId)).slice(-VIEW_LIMIT)); setStatus("healthy"); setError(undefined); }
    catch (reason) { setStatus("degraded"); setError(reason instanceof Error ? reason.message : "trace-local-store-unavailable"); }
  }, [sessionId]);

  useEffect(() => { void (async () => {
    try {
      const store = await LocalTraceStore.open(); storeRef.current = store; const session = await store.ensureSession(sessionId);
      pageInstanceId.current = session.sourceInstanceId;
      const initial: DurableTraceEventDraft = { id: `${pageInstanceId.current}:session-${isNewSession ? "started" : "reloaded"}`, occurredAt: new Date().toISOString(), stage: "session", type: isNewSession ? "session.started" : "session.reloaded", payload: { schemaVersion: 1, appVersion: packageMetadata.version, buildVersion: import.meta.env.VITE_CUELAYER_BUILD_VERSION ?? import.meta.env.MODE, environment: import.meta.env.MODE, url: window.location.pathname }, source: "browser" };
      const queued = await store.append(sessionId, [...pendingRef.current.splice(0), initial], pageInstanceId.current); setEvents((current) => mergeBounded(current, queued)); setPendingCount(0); await reload();
    } catch (reason) {
      setStatus("degraded"); setError(reason instanceof Error ? reason.message : "trace-local-store-unavailable");
    }
  })(); }, [isNewSession, reload, sessionId]);
  useEffect(() => { const drafts = liveTrace.events.flatMap((event) => seenTransientIds.current.has(event.id) ? [] : (seenTransientIds.current.add(event.id), [teachingTraceEventToDurable(event, pageInstanceId.current)])); void append(drafts); }, [append, liveTrace.events]);
  const exportJsonl = useCallback(async () => { const store = storeRef.current; if (!store) throw new Error("trace-local-store-unavailable"); const url = URL.createObjectURL(new Blob([traceEventsToJsonl(await store.events(sessionId))], { type: "application/x-ndjson" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `cuelayer-session-${sessionId}.jsonl`; anchor.click(); URL.revokeObjectURL(url); }, [sessionId]);
  return { sessionId, events, status, error, append, reload, pendingCount, exportJsonl, pageInstanceId: pageInstanceId.current };
}
