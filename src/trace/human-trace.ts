import { compareTraceEvents, type DurableTraceEvent, type TraceCorrelation } from "./durable-trace";

export type TeachingMoment = { id: string; startedAt: string; endedAt: string; speech?: string; partialCount: number; commit?: DurableTraceEvent; planner?: DurableTraceEvent; api?: DurableTraceEvent; validation?: DurableTraceEvent; compiler?: DurableTraceEvent; renderer?: DurableTraceEvent; rawEvents: DurableTraceEvent[]; correlated: boolean };
const text = (event: DurableTraceEvent) => typeof (event.payload as { transcript?: unknown }).transcript === "string" ? (event.payload as { transcript: string }).transcript : undefined;

function correlationKeys(correlation: TraceCorrelation | undefined) {
  if (!correlation) return [];
  const keys: string[] = [];
  for (const name of ["speechEventId", "segmentId", "commitId", "finalId", "plannerRequestId", "apiRequestId", "cueId"] as const) if (correlation[name] !== undefined) keys.push(`${name}:${correlation[name]}`);
  if (correlation.spanId) keys.push(`span:${correlation.spanId}${correlation.spanRevision === undefined ? "" : `@${correlation.spanRevision}`}`);
  return keys;
}
function rootFor(events: DurableTraceEvent[]) {
  const correlations = events.map((event) => event.correlation);
  const commit = correlations.find((value) => value?.commitId)?.commitId;
  if (commit) return `commit:${commit}`;
  const span = correlations.find((value) => value?.spanId)?.spanId; const revision = correlations.find((value) => value?.spanRevision !== undefined)?.spanRevision;
  if (span) return `span:${span}${revision === undefined ? "" : `@${revision}`}`;
  const final = correlations.find((value) => value?.finalId)?.finalId;
  return final ? `final:${final}` : `uncorrelated:${events[0]?.id ?? "unknown"}`;
}

/** Builds connected components from causation and explicit provenance only. Time orders finished groups; it never assigns ownership. */
export function teachingMoments(events: DurableTraceEvent[]): TeachingMoment[] {
  const parent = events.map((_, index) => index); const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]!)); const join = (left: number, right: number) => { const a = find(left); const b = find(right); if (a !== b) parent[b] = a; };
  const owner = new Map<string, number>(); const byEventId = new Map(events.map((event, index) => [event.id, index]));
  events.forEach((event, index) => {
    if (event.causationEventId && byEventId.has(event.causationEventId)) join(index, byEventId.get(event.causationEventId)!);
    for (const key of correlationKeys(event.correlation)) { const prior = owner.get(key); if (prior === undefined) owner.set(key, index); else join(index, prior); }
  });
  const components = new Map<number, DurableTraceEvent[]>(); events.forEach((event, index) => { const key = find(index); const group = components.get(key) ?? []; group.push(event); components.set(key, group); });
  return [...components.values()].map((rawEvents) => {
    const ordered = [...rawEvents].sort(compareTraceEvents); const final = ordered.find((event) => event.type === "asr.final"); const commit = ordered.find((event) => event.type === "commit.committed");
    const correlated = ordered.some((event) => Boolean(event.causationEventId || correlationKeys(event.correlation).length));
    return { id: rootFor(ordered), startedAt: ordered[0]!.occurredAt, endedAt: ordered.at(-1)!.occurredAt, speech: text(final ?? commit ?? ordered[0]!), partialCount: ordered.filter((event) => event.type === "asr.partial").length, commit, planner: ordered.find((event) => event.type === "planner.completed" || event.type === "planner.started"), api: ordered.find((event) => event.stage === "api" && /completed|failed|aborted|timed_out/.test(event.type)), validation: ordered.find((event) => event.stage === "validation"), compiler: ordered.find((event) => event.stage === "compiler"), renderer: ordered.find((event) => event.stage === "renderer"), rawEvents: ordered, correlated };
  }).sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
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
