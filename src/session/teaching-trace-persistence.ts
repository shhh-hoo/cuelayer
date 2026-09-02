import { scopedApiRequestId, scopedRunCorrelationId, type DurableTraceEventDraft, type DurableTraceStage } from "../trace/durable-trace";
import type { TeachingTraceEvent } from "./teaching-trace";

function durableStage(event: TeachingTraceEvent): DurableTraceStage {
  if (event.stage === "asr") return "speechmatics";
  if (event.stage === "span") return "canonical";
  if (event.stage === "compile") return "compiler";
  if (event.stage === "render") return "renderer";
  if (event.stage === "planner" && (event.decision === "structured_output_invalid" || event.decision === "validation_degraded")) return "validation";
  return event.stage;
}

export function teachingTraceEventToDurable(event: TeachingTraceEvent, pageInstanceId: string): DurableTraceEventDraft {
  const { id: transientId, timestamp, source, ...payload } = event;
  const runId = Number(/^speech-(\d+):/.exec(event.traceId)?.[1] ?? 0);
  const scoped = (kind: string, value: string | number | undefined) => value === undefined ? undefined : scopedRunCorrelationId(pageInstanceId, runId, kind, value);
  return {
    id: `${pageInstanceId}:${transientId}`,
    timestamp: new Date(timestamp).toISOString(),
    stage: durableStage(event),
    type: `${event.stage}.${event.decision}`,
    correlation: {
      speechEventId: scoped("speech-event", event.speechEventId ?? event.finalId),
      segmentId: scoped("segment", event.segmentId),
      commitId: scoped("commit", event.commitId),
      finalId: scoped("final", event.finalId),
      spanId: scoped("span", event.spanId),
      spanRevision: event.spanRevision,
      plannerRequestId: scoped("planner-request", event.requestId),
      apiRequestId: event.requestId === undefined ? undefined : scopedApiRequestId(pageInstanceId, "planner", `${runId}-${event.requestId}`),
      cueId: scoped("cue", event.cueId),
    },
    payload,
    source: source === "synthetic" ? "synthetic" : "browser",
  };
}
