import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionTraceEvent } from "./contracts";
import type { TraceArchiveSession } from "./store";
import type { SessionTraceController } from "./use-session-trace";

export type TraceViewerState = {
  events: SessionTraceEvent[];
  loading: boolean;
  error?: string;
  sessions: TraceArchiveSession[];
  selectedSessionId: string;
  viewingArchive: boolean;
  reload(): Promise<void>;
  downloadJsonl(): Promise<void>;
  selectSession(sessionId: string): void;
};

export function sameTraceEventSnapshot(left: readonly SessionTraceEvent[], right: readonly SessionTraceEvent[]) {
  return left.length === right.length && left.every((event, index) => event.eventId === right[index]?.eventId);
}

export function useTraceViewer(trace: SessionTraceController, enabled: boolean, limit = 240): TraceViewerState {
  const [events, setEvents] = useState<SessionTraceEvent[]>([]);
  const [sessions, setSessions] = useState<TraceArchiveSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState(trace.sessionId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const loadingRef = useRef(false);

  const refresh = useCallback(async (showLoading: boolean) => {
    if (!enabled || loadingRef.current) return;
    loadingRef.current = true;
    if (showLoading) setLoading(true);
    try {
      const [nextSessions, next] = await Promise.all([
        trace.listTraceSessions(),
        selectedSessionId === trace.sessionId ? trace.readRecent(limit) : trace.readTraceSession(selectedSessionId, limit),
      ]);
      setSessions(nextSessions);
      setEvents((current) => sameTraceEventSnapshot(current, next) ? current : next);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "trace-read-failed");
    } finally {
      loadingRef.current = false;
      if (showLoading) setLoading(false);
    }
  }, [enabled, limit, selectedSessionId, trace.listTraceSessions, trace.readRecent, trace.readTraceSession, trace.sessionId]);

  const reload = useCallback(async () => refresh(true), [refresh]);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      setSessions([]);
      setError(undefined);
      return;
    }
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 1_000);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  useEffect(() => setSelectedSessionId(trace.sessionId), [trace.sessionId]);

  const downloadJsonl = useCallback(async () => {
    try {
      const blob = selectedSessionId === trace.sessionId
        ? await trace.exportJsonlBlob()
        : await trace.exportTraceSessionJsonl(selectedSessionId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `cuelayer-session-${selectedSessionId}.jsonl`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "trace-export-failed");
    }
  }, [selectedSessionId, trace.exportJsonlBlob, trace.exportTraceSessionJsonl, trace.sessionId]);

  return {
    events,
    loading,
    error,
    sessions,
    selectedSessionId,
    viewingArchive: selectedSessionId !== trace.sessionId,
    reload,
    downloadJsonl,
    selectSession: (sessionId) => {
      const selected = sessions.find((session) => session.sessionId === sessionId);
      if (sessionId === trace.sessionId || (selected && selected.status !== "active")) setSelectedSessionId(sessionId);
    },
  };
}
