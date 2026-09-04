import type { SpeechRunId } from "../session/speech-types";

export const TRACE_SCHEMA_VERSION = 2 as const;

export type TracePriority = "critical" | "raw" | "aggregate";
export type TraceSource = "browser" | "synthetic";

export type TraceCorrelation = {
  rootId?: string;
  lessonSequence?: number;
  runId?: SpeechRunId;
  speechEventId?: string;
  finalId?: string;
  spanId?: string;
  spanRevision?: number;
  plannerRequestId?: string;
  checkpointId?: string;
  interpretationId?: string;
  stepIndex?: number;
  boardRevision?: number;
  cueRevision?: number;
  boardItemId?: string;
  cueId?: string;
  renderId?: string;
};

export type AcceptedContributionAudit = {
  board: {
    action: string;
    contribution?: { mode: string; content: string; provenance: { basis: string; speechRefs: Array<{ checkpointId: string; quote: string }>; stateRefs: Array<{ kind: string; id: string }> } };
    support: Array<{ mode: string; content: string; provenance: { basis: string; speechRefs: Array<{ checkpointId: string; quote: string }>; stateRefs: Array<{ kind: string; id: string }> } }>;
    invalidatesBoardItemIds: string[];
  };
  cue: {
    action: string;
    kind?: string;
    contribution?: { mode: string; content: string; provenance: { basis: string; speechRefs: Array<{ checkpointId: string; quote: string }>; stateRefs: Array<{ kind: string; id: string }> } };
    resolutionEvidence?: { checkpointId: string; quote: string };
  };
  warnings: Array<{ code: string; detail?: string }>;
};

export type SessionTracePayloads = {
  "session.started": {
    reason: "new_url" | "completed_url_replaced";
    path: string;
    appVersion: string;
    environment: string;
    replacedSessionId?: string;
  };
  "session.reloaded": {
    path: string;
    appVersion: string;
    environment: string;
  };
  "session.ended": { reason: string };
  "presentation.state_changed": { previousStatus?: string; status: string; message?: string };
  "speech.lifecycle": {
    runId: SpeechRunId;
    state:
      | "starting"
      | "browser_audio_ready"
      | "token_requested"
      | "token_received"
      | "transcription_started"
      | "capture_started"
      | "ready"
      | "paused"
      | "resumed"
      | "stopped"
      | "failed";
    sampleRate?: number;
    code?: string;
    message?: string;
  };
  "speech.partial": {
    runId: SpeechRunId;
    transcript: string;
    wordCount: number;
    coalescedRevisions?: number;
  };
  "speech.final_received": {
    runId: SpeechRunId;
    transcript: string;
    wordCount: number;
    startMs?: number;
    endMs?: number;
  };
  "speech.drain_completed": { runId: SpeechRunId };
  "speech.drain_incomplete": { runId: SpeechRunId; code: string; message: string };
  "speech.transport_window": {
    runId: SpeechRunId;
    scope: "window" | "run";
    windowStartedAt: string;
    windowEndedAt: string;
    acknowledgedChunkCount: number;
    firstSeqNo?: number;
    lastSeqNo?: number;
    missingSequenceCount: number;
    duplicateOrOutOfOrderCount: number;
    final: boolean;
  };
  "canonical.final_committed": {
    runId: SpeechRunId;
    finalId: string;
    speechEventId?: string;
    transcript: string;
    wordCount: number;
  };
  "canonical.span_changed": {
    runId: SpeechRunId;
    spanId: string;
    revision: number;
    status: "open" | "closed";
    closeReason?: string;
    transcript: string;
    sourceFinalIds: string[];
  };
  "evidence.checkpoint_opened": { runId: SpeechRunId; spanId: string; spanRevision: number };
  "evidence.checkpoint_committed": { runId: SpeechRunId; checkpointId: string; lessonSequence: number; sourceFinalIds: string[]; warningCodes: string[] };
  "evidence.checkpoint_pending": { checkpointId: string; pendingCount: number; oldestPendingAgeMs: number; estimatedTokens: number };
  "interpretation.request_started": { requestId: string; checkpointIds: string[]; pendingCount: number; projectedInputTokens: number };
  "interpretation.request_completed": { requestId: string; latencyMs: number; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; estimatedCostUsd?: number; costStatus: "estimated" | "rates_unconfigured" };
  "interpretation.request_timeout": { requestId: string; latencyMs: number; pendingCount: number };
  "interpretation.output_rejected": { requestId: string; reason: string; pendingCount: number };
  "interpretation.channel_conflict": { requestId: string; channel: "board" | "cue" };
  "interpretation.step_accepted": { requestId: string; interpretationId: string; stepIndex: number; checkpointIds: string[]; boardAction: string; cueAction: string; boardMode?: string; boardSpeechRefCount?: number; cueMode?: string; cueSpeechRefCount?: number; acceptedContribution: AcceptedContributionAudit };
  "board.keep": { reason: string };
  "board.active_set": { boardItemId: string; continuity: string };
  "board.support_added": { boardItemId: string; supportId: string };
  "board.context_retained": { boardItemIds: string[] };
  "board.context_retired": { boardItemIds: string[] };
  "board.content_invalidated": { boardItemIds: string[] };
  "teaching_cue.keep": Record<string, never>;
  "teaching_cue.set": { cueId: string; kind: string };
  "teaching_cue.resolved": { cueId: string; reason: string };
  "teaching_cue.expired": { cueId: string };
  "teaching_surface.rendered": { renderId: string; boardRevision: number; cueRevision: number; presentationMode: string };
  "teaching_surface.layout_changed": { presentationMode: string; density: string };
  "teaching_surface.render_failed": { message: string };
  "context_projection.created": {
    requestId: string;
    policyTokens: number;
    timelineTokens: number;
    stateTokens: number;
    newEvidenceTokens: number;
    projectedInputTokens: number;
    pendingCount: number;
    oldestPendingAgeMs: number;
  };
  "trace.gap": {
    reason: "queue_pressure" | "initialization_pressure";
    dropped: Record<string, number>;
  };
};

export type SessionTraceEventType = keyof SessionTracePayloads;

export type SessionTraceDraft<T extends SessionTraceEventType = SessionTraceEventType> = {
  [K in T]: {
    type: K;
    payload: SessionTracePayloads[K];
    occurredAt?: string | number;
    priority?: TracePriority;
    source?: TraceSource;
    correlation?: TraceCorrelation;
  }
}[T];

export type SessionTraceEvent<T extends SessionTraceEventType = SessionTraceEventType> = {
  [K in T]: {
    schemaVersion: typeof TRACE_SCHEMA_VERSION;
    eventId: string;
    sessionId: string;
    sourceInstanceId: string;
    sourceSeq: number;
    occurredAt: string;
    type: K;
    payload: SessionTracePayloads[K];
    priority: TracePriority;
    source: TraceSource;
    correlation?: TraceCorrelation;
  }
}[T];

export type TraceEmitter = (draft: SessionTraceDraft) => void;

const RAW_EVENT_TYPES = new Set<SessionTraceEventType>(["speech.partial"]);
const AGGREGATE_EVENT_TYPES = new Set<SessionTraceEventType>(["speech.transport_window"]);

export function defaultTracePriority(type: SessionTraceEventType): TracePriority {
  if (RAW_EVENT_TYPES.has(type)) return "raw";
  if (AGGREGATE_EVENT_TYPES.has(type)) return "aggregate";
  return "critical";
}

export type TraceDraftOptions = {
  occurredAt?: string | number;
  priority?: TracePriority;
  source?: TraceSource;
  correlation?: TraceCorrelation;
};

export function traceDraft<T extends SessionTraceEventType>(
  type: T,
  payload: SessionTracePayloads[T],
  options: TraceDraftOptions = {},
): SessionTraceDraft<T> {
  return { type, payload, ...options } as SessionTraceDraft<T>;
}

export function prepareTraceEvent(
  sessionId: string,
  sourceInstanceId: string,
  sourceSeq: number,
  draft: SessionTraceDraft,
): SessionTraceEvent {
  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    eventId: `${sourceInstanceId}:${sourceSeq}`,
    sessionId,
    sourceInstanceId,
    sourceSeq,
    occurredAt: new Date(draft.occurredAt ?? Date.now()).toISOString(),
    type: draft.type,
    payload: draft.payload,
    priority: draft.priority ?? defaultTracePriority(draft.type),
    source: draft.source ?? "browser",
    ...(draft.correlation ? { correlation: draft.correlation } : {}),
  } as SessionTraceEvent;
}

const SECRET_KEY = /^(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|jwt|cookie|credentials?|password|secret)$/i;
const AUDIO_KEY = /^(?:audio(?:data|frames?|blob|buffer)?|pcm(?:data|frames?|buffer)?|microphone(?:data|frames?)?|recording|waveform|binary|blob|buffer)$/i;
const SECRET_TEXT = /(?:bearer\s+[a-z0-9._~+/=-]+|sk-[a-z0-9_-]{8,}|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)/gi;

function isBinary(value: unknown): boolean {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value) || (typeof Blob !== "undefined" && value instanceof Blob);
}

export function sanitizeTraceValue(value: unknown, key = "payload", depth = 0, seen = new WeakSet<object>()): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED_SECRET]";
  if (AUDIO_KEY.test(key) || isBinary(value)) return "[OMITTED_NON_TEXT_MEDIA]";
  if (typeof value === "string") return value.slice(0, 65_536).replace(SECRET_TEXT, "[REDACTED_SECRET]");
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "undefined") return undefined;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return "[OMITTED_UNSERIALIZABLE]";
  if (depth >= 8) return "[OMITTED_MAX_DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeTraceValue(item, key, depth + 1, seen));
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[OMITTED_CIRCULAR_REFERENCE]";
  seen.add(value);
  const sanitized: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
    const child = sanitizeTraceValue(childValue, childKey, depth + 1, seen);
    if (child !== undefined) sanitized[childKey] = child;
  }
  seen.delete(value);
  return sanitized;
}

export function sanitizeTraceEvent(event: SessionTraceEvent): SessionTraceEvent {
  return { ...event, payload: sanitizeTraceValue(event.payload) as SessionTraceEvent["payload"] } as SessionTraceEvent;
}

export function compareTraceEvents(left: SessionTraceEvent, right: SessionTraceEvent): number {
  return left.occurredAt.localeCompare(right.occurredAt)
    || left.sourceInstanceId.localeCompare(right.sourceInstanceId)
    || left.sourceSeq - right.sourceSeq
    || left.eventId.localeCompare(right.eventId);
}
