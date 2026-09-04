import { useState } from "react";
import type { SessionTraceEvent } from "../trace/contracts";
import type { TraceArchiveSession } from "../trace/store";

type TeachingTraceDrawerProps = {
  sessionId: string;
  events: SessionTraceEvent[];
  status: string;
  pendingCount: number;
  droppedCount: number;
  error?: string;
  loading?: boolean;
  sessions: TraceArchiveSession[];
  selectedSessionId: string;
  viewingArchive: boolean;
  onReload(): void;
  onExport(): void;
  onSelectSession(sessionId: string): void;
};

function clock(timestamp: number | string) {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
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

function DurableEventDetails({ event }: { event: SessionTraceEvent }) {
  const [open, setOpen] = useState(false);
  return <details className="teaching-trace-event" onToggle={(toggleEvent) => setOpen(toggleEvent.currentTarget.open)}>
    <summary>{durableLine(event)}</summary>
    {open ? <pre>{JSON.stringify(event, null, 2)}</pre> : null}
  </details>;
}

function sessionOptionLabel(session: TraceArchiveSession) {
  if (!session.createdAt) return `${session.sessionId} · current active`;
  const completedAt = session.completedAt ? ` · completed ${clock(session.completedAt)}` : "";
  return `${session.sessionId} · ${session.status} · created ${clock(session.createdAt)}${completedAt} · ${session.path}`;
}

export function TeachingTraceDrawer({ sessionId, events, status, pendingCount, droppedCount, error, loading, sessions, selectedSessionId, viewingArchive, onReload, onExport, onSelectSession }: TeachingTraceDrawerProps) {
  const currentSession = sessions.find((session) => session.sessionId === sessionId)
    ?? { sessionId, status: "active" as const, createdAt: "", updatedAt: "", appVersion: "", environment: "", path: "" };
  const selectableSessions = [currentSession, ...sessions.filter((session) => session.sessionId !== sessionId && session.status !== "active")];
  return <details className="teaching-trace-drawer" open>
    <summary>Persistent trace · {events.length} loaded · {viewingArchive ? "archived read-only" : status} · {selectedSessionId}</summary>
    <div className="trace-actions" aria-label="Persistent trace actions">
      <label>Trace session: <select value={selectedSessionId} onChange={(event) => onSelectSession(event.target.value)}>
        {selectableSessions.map((session) => <option key={session.sessionId} value={session.sessionId}>{sessionOptionLabel(session)}</option>)}
      </select></label>
      <button type="button" onClick={onReload} disabled={loading}>{loading ? "Loading…" : "Reload trace"}</button>
      <button type="button" onClick={onExport}>Export JSONL</button>
      {viewingArchive ? <span>Archived trace · read-only</span> : <span>{pendingCount} pending · {droppedCount} dropped</span>}
    </div>
    {error ? <p className="trace-error" role="status">Trace degraded: {error}</p> : null}
    {events.length ? <div className="teaching-trace-events">
      {[...events].reverse().map((event) => <DurableEventDetails event={event} key={event.eventId} />)}
    </div> : <p>No persisted events yet. Enable the microphone and wait for a Speechmatics final.</p>}
  </details>;
}
