import type { DurableTraceEventDraft, DurableTraceStage } from "../trace/durable-trace";
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
  return {
    id: `${pageInstanceId}:${transientId}`,
    timestamp: new Date(timestamp).toISOString(),
    stage: durableStage(event),
    type: `${event.stage}.${event.decision}`,
    correlation: {
      speechEventId: event.speechEventId ?? event.finalId,
      segmentId: event.segmentId,
      commitId: event.commitId,
      finalId: event.finalId,
      spanId: event.spanId,
      spanRevision: event.spanRevision,
      plannerRequestId: event.requestId === undefined ? undefined : String(event.requestId),
      cueId: event.cueId,
    },
    payload,
    source: source === "synthetic" ? "synthetic" : "browser",
  };
}
