import type { DurableTraceEvent } from "../trace/durable-trace";
import { SYNTHETIC_INTENT_KINDS, type SyntheticIntentKind } from "./dev-semantic-fixtures";

function clock(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
}

function label(event: DurableTraceEvent) {
  const revision = event.correlation?.spanRevision === undefined ? "" : `@${event.correlation.spanRevision}`;
  const identity = event.correlation?.cueId ?? (event.correlation?.spanId ? `${event.correlation.spanId}${revision}` : undefined) ?? event.correlation?.apiRequestId ?? event.correlation?.commitId ?? event.correlation?.segmentId ?? event.id;
  return `${clock(event.timestamp)} · ${event.stage.toUpperCase()} · ${event.type.toUpperCase()} · ${identity}`;
}

export function TeachingTraceDrawer({ sessionId, events, status, error, recentSessionIds, exportUrl, onReload, onInject }: { sessionId: string; events: DurableTraceEvent[]; status: "loading" | "ready" | "error"; error?: string; recentSessionIds: string[]; exportUrl: string; onReload(): void; onInject?(kind: SyntheticIntentKind): void }) {
  return <details className="teaching-trace-drawer" open>
    <summary>Persistent trace · {events.length} events · {sessionId}</summary>
    <div className="trace-actions">
      <button type="button" onClick={onReload} disabled={status === "loading"}>{status === "loading" ? "Loading…" : "Reload trace"}</button>
      <a href={exportUrl} download>Export JSONL</a>
    </div>
    {recentSessionIds.filter((id) => id !== sessionId).length ? <p className="recent-traces">Recent: {recentSessionIds.filter((id) => id !== sessionId).slice(0, 5).map((id) => <a key={id} href={`/session?debug=speech&sessionId=${encodeURIComponent(id)}`}>{id}</a>)}</p> : null}
    {error ? <p className="trace-error" role="alert">Persistent trace unavailable: {error}</p> : null}
    {onInject ? <div className="semantic-injector" aria-label="Synthetic semantic cue injector">
      <span>Inject downstream:</span>
      {SYNTHETIC_INTENT_KINDS.map((kind) => <button type="button" key={kind} onClick={() => onInject(kind)}>{kind}</button>)}
    </div> : null}
    {events.length ? <div className="teaching-trace-events">
      {events.map((event) => <details className="teaching-trace-event" key={event.id}>
        <summary>{label(event)}</summary>
        <pre>{JSON.stringify(event, null, 2)}</pre>
      </details>)}
    </div> : <p>No persisted events yet. Inject a semantic cue above, or enable the microphone and wait for a Speechmatics transcript event.</p>}
  </details>;
}
