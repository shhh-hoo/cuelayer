import type { DurableTraceEvent } from "./durable-trace";

export type TeachingMoment = { id: string; startedAt: string; endedAt: string; speech?: string; partialCount: number; commit?: DurableTraceEvent; planner?: DurableTraceEvent; api?: DurableTraceEvent; validation?: DurableTraceEvent; compiler?: DurableTraceEvent; renderer?: DurableTraceEvent; rawEvents: DurableTraceEvent[] };
const text = (event: DurableTraceEvent) => typeof (event.payload as { transcript?: unknown }).transcript === "string" ? (event.payload as { transcript: string }).transcript : undefined;

/** Deterministic factual grouping: a final/commit chain starts a teaching moment; no LLM inference. */
export function teachingMoments(events: DurableTraceEvent[]): TeachingMoment[] {
  const moments: TeachingMoment[] = []; let current: TeachingMoment | undefined;
  for (const event of events) {
    const final = event.type === "asr.final"; const commit = event.type === "commit.committed";
    if (!current || (final && current.speech)) {
      current = { id: event.correlation?.commitId ?? event.correlation?.finalId ?? event.id, startedAt: event.occurredAt, endedAt: event.occurredAt, speech: final ? text(event) : undefined, partialCount: 0, rawEvents: [] };
      moments.push(current);
    }
    current.rawEvents.push(event); current.endedAt = event.occurredAt;
    if (final) current.speech = text(event);
    if (event.type === "asr.partial") current.partialCount += 1;
    if (event.type === "commit.committed") current.commit = event;
    if (event.type === "planner.started" || event.type === "planner.completed") current.planner = event;
    if (event.stage === "api" && /completed|failed|aborted|timed_out/.test(event.type)) current.api = event;
    if (event.stage === "validation") current.validation = event;
    if (event.stage === "compiler") current.compiler = event;
    if (event.stage === "renderer") current.renderer = event;
  }
  return moments;
}

export function narrativeLine(event: DurableTraceEvent) {
  const transcript = text(event);
  if (event.type === "asr.final") return `Speechmatics final: “${transcript ?? ""}”`;
  if (event.type === "commit.committed") return `CueLayer committed speech${transcript ? `: “${transcript}”` : ""}.`;
  if (event.stage === "planner_gate") return event.type.endsWith("run") ? "Planner checkpoint selected." : "Planner checkpoint skipped.";
  if (event.type === "api_call.completed") return `Model call completed${typeof (event.payload as { latencyMs?: unknown }).latencyMs === "number" ? ` in ${(event.payload as { latencyMs: number }).latencyMs}ms` : ""}.`;
  if (event.stage === "renderer") return `Renderer ${event.type.replace("render.", "").replaceAll("_", " ")}.`;
  return `${event.stage}: ${event.type}`;
}
