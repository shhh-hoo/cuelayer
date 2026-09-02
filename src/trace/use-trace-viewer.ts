import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionTraceEvent } from "./contracts";
import type { SessionTraceController } from "./use-session-trace";

export type TraceViewerState = {
  events: SessionTraceEvent[];
  loading: boolean;
  error?: string;
  reload(): Promise<void>;
  downloadJsonl(): Promise<void>;
};

export function sameTraceEventSnapshot(left: readonly SessionTraceEvent[], right: readonly SessionTraceEvent[]) {
  return left.length === right.length && left.every((event, index) => event.eventId === right[index]?.eventId);
}

export function useTraceViewer(trace: SessionTraceController, enabled: boolean, limit = 240): TraceViewerState {
  const [events, setEvents] = useState<SessionTraceEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const loadingRef = useRef(false);

  const refresh = useCallback(async (showLoading: boolean) => {
    if (!enabled || loadingRef.current) return;
    loadingRef.current = true;
    if (showLoading) setLoading(true);
    try {
      const next = await trace.readRecent(limit);
      setEvents((current) => sameTraceEventSnapshot(current, next) ? current : next);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "trace-read-failed");
    } finally {
      loadingRef.current = false;
      if (showLoading) setLoading(false);
    }
  }, [enabled, limit, trace.readRecent]);

  const reload = useCallback(async () => refresh(true), [refresh]);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      setError(undefined);
      return;
    }
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 1_000);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  const downloadJsonl = useCallback(async () => {
    try {
      const blob = await trace.exportJsonlBlob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `cuelayer-session-${trace.sessionId}.jsonl`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "trace-export-failed");
    }
  }, [trace.exportJsonlBlob, trace.sessionId]);

  return { events, loading, error, reload, downloadJsonl };
}
