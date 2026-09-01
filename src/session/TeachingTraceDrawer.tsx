import type { DurableTraceEvent } from "../trace/durable-trace";
import { SYNTHETIC_INTENT_KINDS, type SyntheticIntentKind } from "./dev-semantic-fixtures";
import { narrativeLine, teachingMoments } from "../trace/human-trace";

function clock(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
}

function label(event: DurableTraceEvent) {
  const revision = event.correlation?.spanRevision === undefined ? "" : `@${event.correlation.spanRevision}`;
  const identity = event.correlation?.cueId ?? (event.correlation?.spanId ? `${event.correlation.spanId}${revision}` : undefined) ?? event.correlation?.apiRequestId ?? event.correlation?.commitId ?? event.correlation?.segmentId ?? event.id;
  return `${clock(event.occurredAt)} · ${event.stage.toUpperCase()} · ${event.type.toUpperCase()} · ${identity}`;
}

export function TeachingTraceDrawer({ sessionId, events, status, error, pendingCount, onReload, onExport, onInject }: { sessionId: string; events: DurableTraceEvent[]; status: "loading" | "healthy" | "degraded" | "recovering"; error?: string; pendingCount: number; onReload(): void; onExport(): void; onInject?(kind: SyntheticIntentKind): void }) {
  const moments = teachingMoments(events);
  return <details className="teaching-trace-drawer" open>
    <summary>Persistent trace · {events.length} events · {sessionId}</summary>
    <div className="trace-actions">
      <button type="button" onClick={onReload} disabled={status === "loading"}>{status === "loading" ? "Loading…" : "Reload trace"}</button>
      <button type="button" onClick={onExport}>Export JSONL</button>
    </div>
    {status !== "healthy" ? <p className="trace-error" role="status">Trace {status}{pendingCount ? ` · ${pendingCount} pending in this browser` : ""}{error ? `: ${error}` : ""}</p> : null}
    {onInject ? <div className="semantic-injector" aria-label="Synthetic semantic cue injector">
      <span>Inject downstream:</span>
      {SYNTHETIC_INTENT_KINDS.map((kind) => <button type="button" key={kind} onClick={() => onInject(kind)}>{kind}</button>)}
    </div> : null}
    <section className="teaching-trace-narrative" aria-label="Teaching narrative trace">
      <h2>Teaching narrative</h2>
      {moments.map((moment, index) => <details key={moment.id} open={index === moments.length - 1}><summary>Teaching moment {index + 1} · {moment.partialCount} ASR revisions{moment.speech ? ` → “${moment.speech}”` : ""}</summary><ol>{moment.rawEvents.filter((event) => event.type !== "asr.partial").map((event) => <li key={event.id}>{clock(event.occurredAt)} · {narrativeLine(event)}</li>)}</ol>{moment.partialCount ? <details><summary>Show {moment.partialCount} raw revisions</summary>{moment.rawEvents.filter((event) => event.type === "asr.partial").map((event) => <p key={event.id}>{clock(event.occurredAt)} · {String((event.payload as { transcript?: unknown }).transcript ?? "")}</p>)}</details> : null}</details>)}
    </section>
    {events.length ? <div className="teaching-trace-events">
      {events.map((event) => <details className="teaching-trace-event" key={event.id}>
        <summary>{label(event)}</summary>
        <pre>{JSON.stringify(event, null, 2)}</pre>
      </details>)}
    </div> : <p>No persisted events yet. Inject a semantic cue above, or enable the microphone and wait for a Speechmatics transcript event.</p>}
  </details>;
}
