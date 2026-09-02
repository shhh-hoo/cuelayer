import { useEffect, useMemo, useRef } from "react";
import { createHttpSemanticPlanner, type SemanticPlanner } from "../planner/semantic-planner";
import { plannerWindowThroughWork, SingleFlightPlanner } from "../planner/single-flight";
import type { CaptionEpisode, DisplayIntent, PlannerDebugState, PlannerInput } from "../planner/contracts";
import { duePlannerCheckpoint, LIVE_PLANNER_BUDGET_MS, SPEECH_SPAN_ASSEMBLY, type PlannerCheckpointCursor } from "./canonical-speech";
import type { CanonicalSpeechState, SpeechStatus } from "./speech-types";
import type { SessionAction, SessionStatus } from "./session-types";
import { traceDraft, type TraceEmitter } from "../trace/contracts";

type TeachingPlannerCallbacks = {
  sessionStatus: SessionStatus;
  speechStatus: SpeechStatus;
  speechRunId: number;
  canonicalSpeech: CanonicalSpeechState;
  planner: PlannerDebugState;
  tracingEnabled?: boolean;
  dispatch(action: SessionAction): void;
  semanticPlanner?: SemanticPlanner;
  onTrace?: TraceEmitter;
};

const captionContext = (episode?: CaptionEpisode): { sourceSegmentIds: string[]; displayKind: DisplayIntent["kind"] } | undefined => episode ? { sourceSegmentIds: episode.sourceSegmentIds, displayKind: episode.cue?.kind ?? "TEXT" } : undefined;
const traceRoot = (runId: number, spanId: string, spanRevision: number) => `speech:${runId}:span:${spanId}@${spanRevision}`;
const traceCorrelation = (runId: number, spanId: string, spanRevision: number, requestId?: number) => ({
  rootId: traceRoot(runId, spanId, spanRevision),
  runId,
  spanId,
  spanRevision,
  ...(requestId === undefined ? {} : { plannerRequestId: String(requestId) }),
});

/** Coalesces Speechmatics finals into one bounded planner request at a time. */
export function useTeachingPlanner({ sessionStatus, speechStatus, speechRunId, canonicalSpeech, planner, tracingEnabled = false, dispatch, semanticPlanner, onTrace }: TeachingPlannerCallbacks) {
  const defaultPlanner = useMemo(() => createHttpSemanticPlanner(), []);
  const scheduler = useRef(new SingleFlightPlanner());
  const observed = useRef({ runId: -1, checkpoints: new Map<string, PlannerCheckpointCursor>() });
  const activeRequest = useRef<{ requestId: number; abort(reason: "live_budget_timeout" | "superseded_by_newer_checkpoint" | "session_stopped"): void } | undefined>(undefined);
  const plannerClient = semanticPlanner ?? defaultPlanner;

  const openSpan = canonicalSpeech.spans.at(-1)?.status === "open" ? canonicalSpeech.spans.at(-1) : undefined;
  useEffect(() => {
    if (!openSpan) return;
    const remaining = Math.max(0, SPEECH_SPAN_ASSEMBLY.idleCloseMs - (Date.now() - openSpan.updatedAtMs));
    const timeout = window.setTimeout(() => dispatch({ type: "close-speech-span", runId: speechRunId, spanId: openSpan.id, spanRevision: openSpan.revision, reason: "meaningful_pause", now: Date.now() }), remaining);
    return () => window.clearTimeout(timeout);
  }, [dispatch, openSpan, speechRunId]);

  useEffect(() => {
    if (observed.current.runId !== speechRunId) {
      activeRequest.current?.abort("session_stopped");
      scheduler.current.reset();
      observed.current = { runId: speechRunId, checkpoints: new Map() };
    }
    const checkpoints = canonicalSpeech.spans.flatMap((span) => {
      const checkpoint = duePlannerCheckpoint(span, observed.current.checkpoints.get(span.id));
      if (!checkpoint) return [];
      observed.current.checkpoints.set(span.id, checkpoint.cursor);
      return [checkpoint];
    });
    if (checkpoints.length) scheduler.current.enqueue(checkpoints.map(({ spanId, spanRevision }) => ({ spanId, spanRevision, closed: canonicalSpeech.spans.find((span) => span.id === spanId)?.status === "closed" })));
    scheduler.current.coalescePending(canonicalSpeech.spans.map((span) => ({ spanId: span.id, spanRevision: span.revision, closed: span.status === "closed" })));
    if (sessionStatus !== "active" || speechStatus !== "ready") {
      const reason = sessionStatus !== "active" ? "session_not_active" : "speech_not_ready";
      checkpoints.forEach((checkpoint) => {
        if (tracingEnabled) dispatch({ type: "planner-gate", runId: speechRunId, spanId: checkpoint.spanId, spanRevision: checkpoint.spanRevision, segmentIds: [checkpoint.spanId], decision: "skip", reason, now: Date.now() });
        onTrace?.(traceDraft("planner.gate", { runId: speechRunId, spanId: checkpoint.spanId, spanRevision: checkpoint.spanRevision, decision: "skip", reason }, { priority: "critical", correlation: traceCorrelation(speechRunId, checkpoint.spanId, checkpoint.spanRevision) }));
      });
      return;
    }
    const inFlight = scheduler.current.currentWork;
    if (inFlight && scheduler.current.pendingCount && Date.now() - inFlight.startedAtMs >= LIVE_PLANNER_BUDGET_MS) {
      activeRequest.current?.abort("superseded_by_newer_checkpoint");
      return;
    }
    const work = scheduler.current.next(speechRunId, Date.now());
    if (!work) {
      checkpoints.forEach((checkpoint) => {
        const reason = "planner_in_flight_queued_latest_revision";
        if (tracingEnabled) dispatch({ type: "planner-gate", runId: speechRunId, spanId: checkpoint.spanId, spanRevision: checkpoint.spanRevision, segmentIds: [checkpoint.spanId], decision: "skip", reason, now: Date.now() });
        onTrace?.(traceDraft("planner.gate", { runId: speechRunId, spanId: checkpoint.spanId, spanRevision: checkpoint.spanRevision, decision: "skip", reason }, { priority: "critical", correlation: traceCorrelation(speechRunId, checkpoint.spanId, checkpoint.spanRevision) }));
      });
      return;
    }
    const input: PlannerInput = {
      recentSpeech: plannerWindowThroughWork(canonicalSpeech.spans, work),
      activeCaption: captionContext(planner.runtime.current),
      lockedCaption: captionContext(planner.runtime.locked),
    };
    const startedAt = work.startedAtMs;
    if (tracingEnabled) dispatch({ type: "planner-gate", runId: speechRunId, spanId: work.spanId, spanRevision: work.spanRevision, segmentIds: work.segmentIds, decision: "run", reason: "canonical_span_checkpoint", requestId: work.requestId, input, now: startedAt });
    onTrace?.(traceDraft("planner.gate", { runId: speechRunId, spanId: work.spanId, spanRevision: work.spanRevision, decision: "run", reason: "canonical_span_checkpoint", requestId: work.requestId }, { priority: "critical", correlation: traceCorrelation(speechRunId, work.spanId, work.spanRevision, work.requestId) }));
    dispatch({ type: "planner-requested", requestId: work.requestId, runId: speechRunId, spanId: work.spanId, spanRevision: work.spanRevision, input, segmentIds: work.segmentIds, now: startedAt });
    onTrace?.(traceDraft("planner.started", { runId: speechRunId, requestId: work.requestId, spanId: work.spanId, spanRevision: work.spanRevision, input }, { priority: "critical", correlation: traceCorrelation(speechRunId, work.spanId, work.spanRevision, work.requestId) }));
    const controller = new AbortController();
    let settled = false;
    let timeout: number | undefined;
    const abort = (reason: "live_budget_timeout" | "superseded_by_newer_checkpoint" | "session_stopped") => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
      scheduler.current.cancel(work.requestId, speechRunId);
      controller.abort(reason);
      if (activeRequest.current?.requestId === work.requestId) activeRequest.current = undefined;
      const now = Date.now();
      onTrace?.(traceDraft("planner.aborted", { runId: speechRunId, requestId: work.requestId, spanId: work.spanId, spanRevision: work.spanRevision, latencyMs: Math.max(0, now - startedAt), reason }, { priority: "critical", correlation: traceCorrelation(speechRunId, work.spanId, work.spanRevision, work.requestId) }));
      dispatch({ type: "planner-aborted", requestId: work.requestId, runId: speechRunId, spanId: work.spanId, spanRevision: work.spanRevision, input, reason, now, startedAt, segmentIds: work.segmentIds });
    };
    activeRequest.current = { requestId: work.requestId, abort };
    timeout = window.setTimeout(() => abort("live_budget_timeout"), LIVE_PLANNER_BUDGET_MS);
    void plannerClient.decide(input, { signal: controller.signal }).then(
      (decision) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) window.clearTimeout(timeout);
        scheduler.current.complete(work.requestId, speechRunId);
        if (activeRequest.current?.requestId === work.requestId) activeRequest.current = undefined;
        const now = Date.now();
        onTrace?.(traceDraft("planner.completed", { runId: speechRunId, requestId: work.requestId, spanId: work.spanId, spanRevision: work.spanRevision, latencyMs: Math.max(0, now - startedAt), decision }, { priority: "critical", correlation: traceCorrelation(speechRunId, work.spanId, work.spanRevision, work.requestId) }));
        dispatch({ type: "planner-decision", requestId: work.requestId, runId: speechRunId, spanId: work.spanId, spanRevision: work.spanRevision, input, decision, now, startedAt, segmentIds: work.segmentIds });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) window.clearTimeout(timeout);
        scheduler.current.complete(work.requestId, speechRunId);
        if (activeRequest.current?.requestId === work.requestId) activeRequest.current = undefined;
        const now = Date.now();
        const message = error instanceof Error ? error.message : "Planner is temporarily unavailable.";
        onTrace?.(traceDraft("planner.failed", { runId: speechRunId, requestId: work.requestId, spanId: work.spanId, spanRevision: work.spanRevision, latencyMs: Math.max(0, now - startedAt), message }, { priority: "critical", correlation: traceCorrelation(speechRunId, work.spanId, work.spanRevision, work.requestId) }));
        dispatch({ type: "planner-failed", requestId: work.requestId, runId: speechRunId, spanId: work.spanId, spanRevision: work.spanRevision, input, message, now, startedAt, segmentIds: work.segmentIds });
      },
    );
  }, [canonicalSpeech.spans, dispatch, onTrace, planner.runtime, planner.status, plannerClient, sessionStatus, speechRunId, speechStatus, tracingEnabled]);
}
