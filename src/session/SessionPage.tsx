import { lazy, Suspense, useEffect, useState } from "react";
import { LocalLessonEventStore } from "../lesson-stream/store";
import type { LessonDomain } from "../lesson-stream/session-domain";
import { useSessionTrace, type SessionTraceController } from "../trace/use-session-trace";
import { traceDraft } from "../trace/contracts";

const CoreSession = lazy(() => import("./CoreSession"));
const LegacySession = lazy(() => import("./LegacySession"));

export function speechDebugEnabled(search: string) {
  return new URLSearchParams(search).getAll("debug").includes("speech");
}
export function developmentSpeechDebugEnabled(isDevelopment: boolean, search: string) {
  return isDevelopment && speechDebugEnabled(search);
}
export function SessionPage() {
  const trace = useSessionTrace({ observeStatus: speechDebugEnabled(window.location.search), preserveSessionIdentity: true });
  return <SessionDomain key={trace.sessionId} trace={trace} />;
}
function SessionDomain({ trace }: { trace: SessionTraceController }) {
  const [domain, setDomain] = useState<LessonDomain>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    void LocalLessonEventStore.resolveDomain(trace.sessionId, { create: trace.created }).then(domain => {
      if (cancelled) return;
      trace.emit(traceDraft("session.domain", { domain, source: "lesson-domains" }, { priority: "critical" }));
      setDomain(domain);
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "lesson-store-unavailable"); });
    return () => { cancelled = true; };
  }, [trace.sessionId, trace.created, trace.emit]);
  if (error) return <main className="session-shell"><p role="alert">Session could not be restored: {error}</p><a href="/session">Start a new session</a></main>;
  const loading = <main className="session-shell"><p role="status">Restoring lesson…</p></main>;
  return <Suspense fallback={loading}>{domain === "core" ? <CoreSession trace={trace} /> : domain === "legacy" ? <LegacySession trace={trace} /> : loading}</Suspense>;
}
