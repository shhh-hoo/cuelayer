import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import packageMetadata from "../../package.json";
import { compareTraceEvents, type DurableTraceEvent, type DurableTraceEventDraft } from "./durable-trace";
import { provisionBrowserTraceSession, TraceOutbox } from "./outbox";
import { createHttpTraceTransport, type TraceTransport } from "./trace-client";
import type { TeachingTraceState } from "../session/teaching-trace";
import { teachingTraceEventToDurable } from "../session/teaching-trace-persistence";

const VIEW_LIMIT = 300;
function mergeBounded(current: DurableTraceEvent[], added: DurableTraceEvent[]) { return [...new Map([...current, ...added].map((event) => [event.id, event])).values()].sort(compareTraceEvents).slice(-VIEW_LIMIT); }

export function useDurableTrace({ sessionId, isNewSession, liveTrace, transport: providedTransport }: { sessionId: string; isNewSession: boolean; liveTrace: TeachingTraceState; transport?: TraceTransport }) {
  const transport = useMemo(() => providedTransport ?? createHttpTraceTransport(), [providedTransport]);
  const pageInstanceId = useRef(`browser-${crypto.randomUUID()}`); const outboxRef = useRef<TraceOutbox | undefined>(undefined); const seenTransientIds = useRef(new Set<string>()); const pendingRef = useRef<DurableTraceEventDraft[]>([]); const retryDelayMs = useRef(500); const retryAfterMs = useRef(0);
  const [events, setEvents] = useState<DurableTraceEvent[]>([]); const [status, setStatus] = useState<"loading" | "healthy" | "degraded" | "recovering">("loading"); const [error, setError] = useState<string>(); const [readCapability, setReadCapability] = useState<string>(); const [writeCapability, setWriteCapability] = useState<string>(); const [pendingCount, setPendingCount] = useState(0); const [nextCursor, setNextCursor] = useState<string>();

  const flush = useCallback(async () => {
    const outbox = outboxRef.current; if (!outbox) return;
    if (Date.now() < retryAfterMs.current) return;
    try { const result = await outbox.flush(sessionId, transport); retryDelayMs.current = 500; retryAfterMs.current = 0; setEvents((current) => mergeBounded(current, result.acknowledged)); setPendingCount(result.pending); setStatus(result.pending ? "recovering" : "healthy"); setError(undefined); }
    catch (reason) { retryAfterMs.current = Date.now() + retryDelayMs.current; retryDelayMs.current = Math.min(5_000, retryDelayMs.current * 2); setPendingCount(await outbox.pendingCount(sessionId)); setStatus("degraded"); setError(reason instanceof Error ? reason.message : "trace-ingestion-unavailable"); }
  }, [sessionId, transport]);

  const append = useCallback(async (drafts: DurableTraceEventDraft[]) => {
    const outbox = outboxRef.current;
    if (!outbox) { pendingRef.current.push(...drafts); return []; }
    const queued = await outbox.enqueue(sessionId, drafts, pageInstanceId.current); setEvents((current) => mergeBounded(current, queued)); setPendingCount(await outbox.pendingCount(sessionId)); void flush(); return queued;
  }, [flush, sessionId]);

  const reload = useCallback(async () => {
    const outbox = outboxRef.current; if (!outbox) return; const session = await outbox.session(sessionId); if (!session?.readCapability) { setStatus("degraded"); setError("trace-read-capability-unavailable-on-this-browser"); return; }
    setReadCapability(session.readCapability); setStatus("loading");
    try { const page = await transport.load(sessionId, session.readCapability); setEvents(page.events.slice(-VIEW_LIMIT)); setNextCursor(page.nextCursor); setStatus("healthy"); setError(undefined); void flush(); }
    catch (reason) { setStatus("degraded"); setError(reason instanceof Error ? reason.message : "trace-query-unavailable"); }
  }, [flush, sessionId, transport]);

  useEffect(() => { void (async () => {
    try {
      const outbox = await TraceOutbox.open(); outboxRef.current = outbox; const session = await provisionBrowserTraceSession(outbox, sessionId, transport, { appVersion: packageMetadata.version, buildVersion: import.meta.env.VITE_CUELAYER_BUILD_VERSION ?? import.meta.env.MODE, environment: import.meta.env.MODE });
      pageInstanceId.current = session.sourceInstanceId;
      setReadCapability(session.readCapability); setWriteCapability(session.writeCapability); const initial: DurableTraceEventDraft = { id: `${pageInstanceId.current}:session-${isNewSession ? "started" : "reloaded"}`, occurredAt: new Date().toISOString(), stage: "session", type: isNewSession ? "session.started" : "session.reloaded", payload: { schemaVersion: 1, appVersion: packageMetadata.version, buildVersion: import.meta.env.VITE_CUELAYER_BUILD_VERSION ?? import.meta.env.MODE, url: window.location.pathname }, source: "browser" };
      const queued = await outbox.enqueue(sessionId, [...pendingRef.current.splice(0), initial], pageInstanceId.current); setEvents((current) => mergeBounded(current, queued)); setPendingCount(await outbox.pendingCount(sessionId)); await reload();
    } catch (reason) { setStatus("degraded"); setError(reason instanceof Error ? reason.message : "trace-outbox-unavailable"); }
  })(); }, [isNewSession, reload, sessionId, transport]);
  useEffect(() => { const drafts = liveTrace.events.flatMap((event) => seenTransientIds.current.has(event.id) ? [] : (seenTransientIds.current.add(event.id), [teachingTraceEventToDurable(event, pageInstanceId.current)])); void append(drafts); }, [append, liveTrace.events]);
  useEffect(() => { const timer = window.setInterval(() => void flush(), 500); return () => window.clearInterval(timer); }, [flush]);
  const exportJsonl = useCallback(async () => { if (!readCapability) throw new Error("trace-read-capability-unavailable"); const response = await fetch(`/api/trace/session?sessionId=${encodeURIComponent(sessionId)}&format=jsonl`, { headers: { "X-CueLayer-Trace-Read-Capability": readCapability } }); if (!response.ok) throw new Error("trace-export-failed"); const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `cuelayer-trace-${sessionId}.jsonl`; anchor.click(); URL.revokeObjectURL(url); }, [readCapability, sessionId]);
  return { sessionId, events, status, error, append, reload, pendingCount, nextCursor, readCapability, writeCapability, exportJsonl, pageInstanceId: pageInstanceId.current };
}
