import type { TeachingTraceEvent, TeachingTraceState } from "./teaching-trace";
import { SYNTHETIC_INTENT_KINDS, type SyntheticIntentKind } from "./dev-semantic-fixtures";

function clock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
}

function label(event: TeachingTraceEvent) {
  const revision = event.spanRevision === undefined ? "" : `@${event.spanRevision}`;
  const identity = event.cueId ?? (event.spanId ? `${event.spanId}${revision}` : undefined) ?? event.finalId ?? event.commitId ?? event.segmentId ?? event.traceId;
  const latency = event.latencyMs === undefined ? "" : ` · ${event.latencyMs}ms`;
  return `${clock(event.timestamp)} · ${event.stage.toUpperCase()} ${event.decision.toUpperCase()} · ${identity}${latency}`;
}

export function TeachingTraceDrawer({ trace, onInject }: { trace: TeachingTraceState; onInject?(kind: SyntheticIntentKind): void }) {
  return <details className="teaching-trace-drawer" open>
    <summary>Trace · {trace.events.length}/{trace.limit} events</summary>
    {onInject ? <div className="semantic-injector" aria-label="Synthetic semantic cue injector">
      <span>Inject downstream:</span>
      {SYNTHETIC_INTENT_KINDS.map((kind) => <button type="button" key={kind} onClick={() => onInject(kind)}>{kind}</button>)}
    </div> : null}
    {trace.events.length ? <div className="teaching-trace-events">
      {[...trace.events].reverse().map((event) => <details className="teaching-trace-event" key={event.id}>
        <summary>{label(event)}</summary>
        <pre>{JSON.stringify(event, null, 2)}</pre>
      </details>)}
    </div> : <p>No trace events yet. Inject a semantic cue above, or enable the microphone and wait for a Speechmatics final.</p>}
  </details>;
}
