import type { TeachingTraceEvent, TeachingTraceState } from "./teaching-trace";
import { SYNTHETIC_INTENT_KINDS, type SyntheticIntentKind } from "./dev-semantic-fixtures";
import type { SessionTraceEvent } from "../trace/contracts";

type LegacyProps = { trace: TeachingTraceState; onInject?(kind: SyntheticIntentKind): void };
type DurableProps = {
  sessionId: string;
  events: SessionTraceEvent[];
  status: string;
  pendingCount: number;
  droppedCount: number;
  error?: string;
  loading?: boolean;
  onReload(): void;
  onExport(): void;
  onInject?(kind: SyntheticIntentKind): void;
};

function clock(timestamp: number | string) {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
}

function legacyLabel(event: TeachingTraceEvent) {
  const revision = event.spanRevision === undefined ? "" : `@${event.spanRevision}`;
  const identity = event.cueId ?? (event.spanId ? `${event.spanId}${revision}` : undefined) ?? event.finalId ?? event.commitId ?? event.segmentId ?? event.traceId;
  const latency = event.latencyMs === undefined ? "" : ` · ${event.latencyMs}ms`;
  return `${clock(event.timestamp)} · ${event.stage.toUpperCase()} ${event.decision.toUpperCase()} · ${identity}${latency}`;
}

function durableLine(event: SessionTraceEvent) {
  const payload = event.payload as Record<string, unknown>;
  const transcript = typeof payload.transcript === "string" ? ` · “${payload.transcript}”` : "";
  const latency = typeof payload.latencyMs === "number" ? ` · ${payload.latencyMs}ms` : "";
  const state = typeof payload.state === "string" ? ` · ${payload.state}` : "";
  const decision = typeof payload.decision === "string" ? ` · ${payload.decision}` : "";
  const identity = event.correlation?.cueId ?? event.correlation?.plannerRequestId ?? event.correlation?.spanId ?? event.correlation?.finalId ?? event.correlation?.speechEventId;
  return `${clock(event.occurredAt)} · ${event.type}${state}${decision}${identity ? ` · ${identity}` : ""}${latency}${transcript}`;
}

function Injector({ onInject }: { onInject?(kind: SyntheticIntentKind): void }) {
  return onInject ? <div className="semantic-injector" aria-label="Synthetic semantic cue injector">
    <span>Inject downstream:</span>
    {SYNTHETIC_INTENT_KINDS.map((kind) => <button type="button" key={kind} onClick={() => onInject(kind)}>{kind}</button>)}
  </div> : null;
}

function LegacyTraceDrawer({ trace, onInject }: LegacyProps) {
  return <details className="teaching-trace-drawer" open>
    <summary>Trace · {trace.events.length}/{trace.limit} events</summary>
    <Injector onInject={onInject} />
    {trace.events.length ? <div className="teaching-trace-events">
      {[...trace.events].reverse().map((event) => <details className="teaching-trace-event" key={event.id}>
        <summary>{legacyLabel(event)}</summary>
        <pre>{JSON.stringify(event, null, 2)}</pre>
      </details>)}
    </div> : <p>No trace events yet. Inject a semantic cue above, or enable the microphone and wait for a Speechmatics final.</p>}
  </details>;
}

function DurableTraceDrawer({ sessionId, events, status, pendingCount, droppedCount, error, loading, onReload, onExport, onInject }: DurableProps) {
  return <details className="teaching-trace-drawer" open>
    <summary>Persistent trace · {events.length} loaded · {status} · {sessionId}</summary>
    <div className="semantic-injector" aria-label="Persistent trace actions">
      <button type="button" onClick={onReload} disabled={loading}>{loading ? "Loading…" : "Reload trace"}</button>
      <button type="button" onClick={onExport}>Export JSONL</button>
      <span>{pendingCount} pending · {droppedCount} dropped</span>
    </div>
    {error ? <p className="trace-error" role="status">Trace degraded: {error}</p> : null}
    <Injector onInject={onInject} />
    {events.length ? <div className="teaching-trace-events">
      {[...events].reverse().map((event) => <details className="teaching-trace-event" key={event.eventId}>
        <summary>{durableLine(event)}</summary>
        <pre>{JSON.stringify(event, null, 2)}</pre>
      </details>)}
    </div> : <p>No persisted events yet. Enable the microphone or inject a semantic cue.</p>}
  </details>;
}

export function TeachingTraceDrawer(props: LegacyProps | DurableProps) {
  return "trace" in props ? <LegacyTraceDrawer {...props} /> : <DurableTraceDrawer {...props} />;
}
