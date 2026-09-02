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

export function useTraceViewer(trace: SessionTraceController, enabled: boolean, limit = 240): TraceViewerState {
  const [events, setEvents] = useState<SessionTraceEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const loadingRef = useRef(false);

  const reload = useCallback(async () => {
    if (!enabled || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      setEvents(await trace.readRecent(limit));
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "trace-read-failed");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [enabled, limit, trace.readRecent]);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      setError(undefined);
      return;
    }
    void reload();
    const timer = window.setInterval(() => void reload(), 1_000);
    return () => window.clearInterval(timer);
  }, [enabled, reload]);

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
