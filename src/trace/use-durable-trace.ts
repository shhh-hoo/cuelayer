import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compareTraceEvents, type DurableTraceEvent, type DurableTraceEventDraft } from "./durable-trace";
import { createHttpTraceTransport, type TraceTransport } from "./trace-client";
import type { TeachingTraceState } from "../session/teaching-trace";
import { teachingTraceEventToDurable } from "../session/teaching-trace-persistence";
import packageMetadata from "../../package.json";

function merged(events: DurableTraceEvent[], appended: DurableTraceEvent[]) {
  return [...new Map([...events, ...appended].map((event) => [event.id, event])).values()].sort(compareTraceEvents);
}

export function useDurableTrace({ sessionId, isNewSession, liveTrace, transport: providedTransport }: { sessionId: string; isNewSession: boolean; liveTrace: TeachingTraceState; transport?: TraceTransport }) {
  const transport = useMemo(() => providedTransport ?? createHttpTraceTransport(), [providedTransport]);
  const pageInstanceId = useRef(`page-${crypto.randomUUID()}`);
  const seenTransientIds = useRef(new Set<string>());
  const [events, setEvents] = useState<DurableTraceEvent[]>([]);
  const [recentSessionIds, setRecentSessionIds] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>();

  const append = useCallback(async (drafts: DurableTraceEventDraft[]) => {
    if (!drafts.length) return [];
    try {
      const stored = await transport.append(sessionId, drafts);
      setEvents((current) => merged(current, stored));
      setStatus("ready");
      setError(undefined);
      return stored;
    } catch (reason) {
      setStatus("error");
      setError(reason instanceof Error ? reason.message : "trace-storage-unavailable");
      return [];
    }
  }, [sessionId, transport]);

  const reload = useCallback(async () => {
    setStatus("loading");
    try {
      const [stored, recent] = await Promise.all([transport.load(sessionId), transport.recent()]);
      setEvents((current) => merged(stored, current));
      setRecentSessionIds(recent);
      setStatus("ready");
      setError(undefined);
    } catch (reason) {
      setStatus("error");
      setError(reason instanceof Error ? reason.message : "trace-storage-unavailable");
    }
  }, [sessionId, transport]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const event: DurableTraceEventDraft = {
      id: `${pageInstanceId.current}:session-${isNewSession ? "started" : "reloaded"}`,
      timestamp: new Date().toISOString(),
      stage: "session",
      type: isNewSession ? "session.started" : "session.reloaded",
      payload: { schemaVersion: 1, appVersion: packageMetadata.version, buildVersion: import.meta.env.VITE_CUELAYER_BUILD_VERSION ?? import.meta.env.MODE, url: window.location.pathname },
      source: "browser",
    };
    void append([event]);
  }, [append, isNewSession]);

  useEffect(() => {
    const drafts = liveTrace.events.flatMap((event) => {
      if (seenTransientIds.current.has(event.id)) return [];
      seenTransientIds.current.add(event.id);
      return [teachingTraceEventToDurable(event, pageInstanceId.current)];
    });
    void append(drafts);
  }, [append, liveTrace.events]);

  return {
    sessionId,
    events,
    recentSessionIds,
    status,
    error,
    append,
    reload,
    exportUrl: `/api/trace/session?sessionId=${encodeURIComponent(sessionId)}&format=jsonl`,
    pageInstanceId: pageInstanceId.current,
  };
}
