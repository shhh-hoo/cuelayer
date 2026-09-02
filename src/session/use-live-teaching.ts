import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validateAndNormalizeProposal } from "../lesson-stream/accepted-interpretations";
import { buildTeachingInterpretationRequest } from "../lesson-stream/context-projection";
import { LosslessInterpretationScheduler } from "../lesson-stream/pending-evidence";
import { createHttpTeachingInterpreter, type TeachingInterpreter } from "../lesson-stream/planner";
import { LessonStreamRuntime } from "../lesson-stream/runtime";
import { createInitialTeachingState } from "../lesson-stream/teaching-state";
import type { TeachingStateSnapshot } from "../lesson-stream/contracts";
import { traceDraft, type TraceEmitter } from "../trace/contracts";
import type { CanonicalSpeechState, SpeechStatus } from "./speech-types";
import type { SessionStatus } from "./session-types";

const HARD_DEADLINE_MS = 6_000;
const MODEL_NAME = "gpt-5.6-luna";

export type LiveTeachingStatus = "restoring" | "ready" | "interpreting" | "degraded";

export function useLiveTeaching({
  sessionId,
  sessionStatus,
  speechStatus,
  speechRunId,
  canonicalSpeech,
  onTrace: unsafeTrace,
  interpreter: providedInterpreter,
}: {
  sessionId: string;
  sessionStatus: SessionStatus;
  speechStatus: SpeechStatus;
  speechRunId: number;
  canonicalSpeech: CanonicalSpeechState;
  onTrace?: TraceEmitter;
  interpreter?: TeachingInterpreter;
}) {
  const interpreter = useMemo(() => providedInterpreter ?? createHttpTeachingInterpreter(), [providedInterpreter]);
  const onTrace = useCallback<TraceEmitter>((draft) => {
    try { unsafeTrace?.(draft); } catch { /* Diagnostic trace never controls lesson state. */ }
  }, [unsafeTrace]);
  const runtimeRef = useRef<LessonStreamRuntime | undefined>(undefined);
  const schedulerRef = useRef(new LosslessInterpretationScheduler());
  const pumpRef = useRef<() => void>(() => undefined);
  const activeControllerRef = useRef<AbortController | undefined>(undefined);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const consecutiveFailuresRef = useRef(0);
  const activeRunRef = useRef(speechRunId);
  const openedCheckpointTraceRef = useRef(new Set<string>());
  const [state, setState] = useState<TeachingStateSnapshot>(createInitialTeachingState);
  const [status, setStatus] = useState<LiveTeachingStatus>("restoring");
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string>();
  const [runtimeEpoch, setRuntimeEpoch] = useState(0);

  const syncRuntime = useCallback((runtime: LessonStreamRuntime) => {
    setState(runtime.state);
    setPendingCount(runtime.pending.length);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let openedRuntime: LessonStreamRuntime | undefined;
    let unsubscribe: () => void = () => undefined;
    setStatus("restoring");
    void LessonStreamRuntime.open(sessionId).then((runtime) => {
      if (cancelled) { runtime.close(); return; }
      runtimeRef.current?.close();
      runtimeRef.current = runtime;
      openedRuntime = runtime;
      schedulerRef.current.restore(runtime.pending);
      syncRuntime(runtime);
      unsubscribe = runtime.subscribe(() => syncRuntime(runtime));
      setStatus("ready");
      setError(undefined);
      setRuntimeEpoch((value) => value + 1);
      pumpRef.current();
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setStatus("degraded");
      setError(reason instanceof Error ? reason.message : "lesson-store-unavailable");
    });
    return () => {
      cancelled = true;
      unsubscribe();
      if (runtimeRef.current === openedRuntime) {
        openedRuntime?.close();
        runtimeRef.current = undefined;
      }
      activeControllerRef.current?.abort("lesson_replaced");
      if (retryTimerRef.current !== undefined) window.clearTimeout(retryTimerRef.current);
    };
  }, [sessionId, syncRuntime]);

  useEffect(() => {
    if (activeRunRef.current === speechRunId) return;
    activeRunRef.current = speechRunId;
    activeControllerRef.current?.abort("speech_run_changed");
  }, [speechRunId]);

  useEffect(() => {
    if (sessionStatus !== "active") return;
    void runtimeRef.current?.start().catch((reason: unknown) => {
      setStatus("degraded");
      setError(reason instanceof Error ? reason.message : "lesson-start-failed");
    });
  }, [runtimeEpoch, sessionStatus]);

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current !== undefined) return;
    const delay = Math.min(5_000, 500 * 2 ** Math.min(4, consecutiveFailuresRef.current));
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = undefined;
      pumpRef.current();
    }, delay);
  }, []);

  const pump = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || sessionStatus !== "active" || speechStatus !== "ready") return;
    const scheduled = schedulerRef.current.next(speechRunId);
    if (!scheduled) return;
    const { work, checkpoints } = scheduled;
    const { request, diagnostics } = buildTeachingInterpretationRequest({ requestId: work.requestId, sessionId, events: runtime.events, currentState: runtime.state, newEvidence: checkpoints });
    const committedTimes = checkpoints.flatMap((checkpoint) => {
      const event = runtime.events.find((item) => item.type === "evidence.checkpoint_committed" && item.checkpoint.checkpointId === checkpoint.checkpointId);
      return event?.type === "evidence.checkpoint_committed" ? [Date.parse(event.timestamp)] : [];
    });
    const oldestPendingAgeMs = committedTimes.length ? Math.max(0, Date.now() - Math.min(...committedTimes)) : 0;
    onTrace?.(traceDraft("context_projection.created", { requestId: work.requestId, ...diagnostics, pendingCount: schedulerRef.current.pendingCount, oldestPendingAgeMs }, { correlation: { rootId: `interpretation:${work.requestId}`, runId: speechRunId, plannerRequestId: work.requestId } }));
    onTrace?.(traceDraft("interpretation.request_started", { requestId: work.requestId, checkpointIds: work.checkpointIds, pendingCount: schedulerRef.current.pendingCount, projectedInputTokens: diagnostics.projectedInputTokens }, { correlation: { rootId: `interpretation:${work.requestId}`, runId: speechRunId, plannerRequestId: work.requestId } }));
    setStatus("interpreting");
    const controller = new AbortController();
    activeControllerRef.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort("hard_deadline"); }, HARD_DEADLINE_MS);

    void interpreter.interpret(request, { signal: controller.signal }).then(async (response) => {
      if (activeRunRef.current !== work.speechRunId || runtimeRef.current !== runtime) throw new Error("interpretation-stale-speech-run");
      const validation = validateAndNormalizeProposal({ proposal: response.proposal, request, allCheckpoints: runtime.checkpoints, state: runtime.state, model: MODEL_NAME });
      if (!validation.ok) {
        onTrace?.(traceDraft("interpretation.output_rejected", { requestId: work.requestId, reason: validation.error, pendingCount: schedulerRef.current.pendingCount }, { correlation: { rootId: `interpretation:${work.requestId}`, runId: speechRunId, plannerRequestId: work.requestId } }));
        throw new Error(validation.error);
      }
      if (validation.boardConflict) onTrace?.(traceDraft("interpretation.channel_conflict", { requestId: work.requestId, channel: "board" }, { correlation: { rootId: `interpretation:${work.requestId}`, plannerRequestId: work.requestId } }));
      if (validation.cueConflict) onTrace?.(traceDraft("interpretation.channel_conflict", { requestId: work.requestId, channel: "cue" }, { correlation: { rootId: `interpretation:${work.requestId}`, plannerRequestId: work.requestId } }));
      const stateBefore = runtime.state;
      await runtime.acceptSteps(validation.steps);
      schedulerRef.current.settleAccepted(work.requestId, validation.steps.flatMap((step) => step.consumesCheckpointIds));
      consecutiveFailuresRef.current = 0;
      setError(undefined);
      setStatus("ready");
      const latencyMs = Math.max(0, Date.now() - work.startedAtMs);
      onTrace?.(traceDraft("interpretation.request_completed", { requestId: work.requestId, latencyMs, ...(response.usage ? { inputTokens: response.usage.inputTokens, cachedInputTokens: response.usage.cachedInputTokens, outputTokens: response.usage.outputTokens } : {}), ...(response.estimatedCostUsd === undefined ? { costStatus: "rates_unconfigured" as const } : { costStatus: "estimated" as const, estimatedCostUsd: response.estimatedCostUsd }) }, { correlation: { rootId: `interpretation:${work.requestId}`, runId: speechRunId, plannerRequestId: work.requestId } }));
      validation.steps.forEach((step) => {
        const correlation = { rootId: `interpretation:${work.requestId}`, runId: speechRunId, plannerRequestId: work.requestId, interpretationId: step.interpretationId, stepIndex: step.stepIndex, boardRevision: runtime.state.board.revision, cueRevision: runtime.state.cue.revision };
        onTrace?.(traceDraft("interpretation.step_accepted", { requestId: work.requestId, interpretationId: step.interpretationId, stepIndex: step.stepIndex, checkpointIds: step.consumesCheckpointIds, boardAction: step.boardDelta.action, cueAction: step.cueDelta.action }, { correlation }));
        if (step.boardDelta.action === "KEEP") onTrace?.(traceDraft("board.keep", { reason: step.boardDelta.reason }, { correlation }));
        if (step.boardDelta.action === "SET_ACTIVE") {
          const boardItemId = `board-${step.interpretationId}-${step.stepIndex}`;
          onTrace?.(traceDraft("board.active_set", { boardItemId, continuity: step.boardDelta.continuity }, { correlation: { ...correlation, boardItemId } }));
          if (step.boardDelta.retainPrevious && stateBefore.board.active) onTrace?.(traceDraft("board.context_retained", { boardItemIds: [stateBefore.board.active.id] }, { correlation }));
          if (step.boardDelta.continuity !== "same_thread") onTrace?.(traceDraft("board.context_retired", { boardItemIds: [stateBefore.board.active, ...stateBefore.board.retained].flatMap((item) => item ? [item.id] : []) }, { correlation }));
          if (step.boardDelta.invalidatesBoardItemIds?.length) onTrace?.(traceDraft("board.content_invalidated", { boardItemIds: step.boardDelta.invalidatesBoardItemIds }, { correlation }));
        }
        if (step.boardDelta.action === "ADD_SUPPORT") onTrace?.(traceDraft("board.support_added", { boardItemId: step.boardDelta.targetBoardItemId, supportId: `support-${step.interpretationId}-${step.stepIndex}` }, { correlation: { ...correlation, boardItemId: step.boardDelta.targetBoardItemId } }));
        if (step.cueDelta.action === "KEEP") onTrace?.(traceDraft("teaching_cue.keep", {}, { correlation }));
        if (step.cueDelta.action === "SET") {
          const cueId = `cue-${step.interpretationId}-${step.stepIndex}`;
          onTrace?.(traceDraft("teaching_cue.set", { cueId, kind: step.cueDelta.cueKind }, { correlation: { ...correlation, cueId } }));
        }
        if (step.cueDelta.action === "RESOLVE_CURRENT" && stateBefore.cue.active) onTrace?.(traceDraft("teaching_cue.resolved", { cueId: stateBefore.cue.active.id, reason: step.cueDelta.reason }, { correlation: { ...correlation, cueId: stateBefore.cue.active.id } }));
      });
      queueMicrotask(() => pumpRef.current());
    }).catch((reason: unknown) => {
      schedulerRef.current.settleFailed(work.requestId);
      consecutiveFailuresRef.current += 1;
      const message = reason instanceof Error ? reason.message : "teaching-provider-unavailable";
      setError(message);
      setStatus("degraded");
      const latencyMs = Math.max(0, Date.now() - work.startedAtMs);
      if (timedOut) onTrace?.(traceDraft("interpretation.request_timeout", { requestId: work.requestId, latencyMs, pendingCount: schedulerRef.current.pendingCount }, { correlation: { rootId: `interpretation:${work.requestId}`, runId: speechRunId, plannerRequestId: work.requestId } }));
      scheduleRetry();
    }).finally(() => {
      window.clearTimeout(timeout);
      if (activeControllerRef.current === controller) activeControllerRef.current = undefined;
      setPendingCount(schedulerRef.current.pendingCount);
    });
  }, [interpreter, onTrace, scheduleRetry, sessionId, sessionStatus, speechRunId, speechStatus]);
  pumpRef.current = pump;

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || sessionStatus === "ended") return;
    for (const span of canonicalSpeech.spans) {
      if (openedCheckpointTraceRef.current.has(span.id)) continue;
      openedCheckpointTraceRef.current.add(span.id);
      onTrace?.(traceDraft("evidence.checkpoint_opened", { runId: speechRunId, spanId: span.id, spanRevision: span.revision }, { correlation: { rootId: `speech:${speechRunId}:span:${span.id}`, runId: speechRunId, spanId: span.id, spanRevision: span.revision } }));
    }
    const closed = canonicalSpeech.spans.filter((span) => span.status === "closed");
    if (!closed.length) return;
    void (async () => {
      await runtime.start();
      for (const span of closed) {
        const committed = await runtime.commitClosedSpan(span, speechRunId);
        if (!committed) continue;
        schedulerRef.current.enqueue([committed]);
        setPendingCount(schedulerRef.current.pendingCount);
        onTrace?.(traceDraft("evidence.checkpoint_committed", { runId: speechRunId, checkpointId: committed.checkpointId, lessonSequence: committed.lessonSequence, sourceFinalIds: committed.sourceFinalIds, warningCodes: committed.warnings.map((warning) => warning.code) }, { correlation: { rootId: `checkpoint:${committed.checkpointId}`, runId: speechRunId, lessonSequence: committed.lessonSequence, checkpointId: committed.checkpointId } }));
        onTrace?.(traceDraft("evidence.checkpoint_pending", { checkpointId: committed.checkpointId, pendingCount: schedulerRef.current.pendingCount, oldestPendingAgeMs: 0, estimatedTokens: Math.ceil(committed.text.length / 4) + 16 }, { correlation: { rootId: `checkpoint:${committed.checkpointId}`, runId: speechRunId, lessonSequence: committed.lessonSequence, checkpointId: committed.checkpointId } }));
      }
      pumpRef.current();
    })().catch((reason: unknown) => {
      setStatus("degraded");
      setError(reason instanceof Error ? reason.message : "checkpoint-commit-failed");
    });
  }, [canonicalSpeech.spans, onTrace, runtimeEpoch, sessionStatus, speechRunId]);

  const expireCue = useCallback(async (cueId: string) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const baseCueRevision = runtime.state.cue.revision;
    if (await runtime.expireCue(cueId, baseCueRevision)) {
      onTrace?.(traceDraft("teaching_cue.expired", { cueId }, { correlation: { rootId: `cue:${cueId}`, cueId, cueRevision: runtime.state.cue.revision } }));
    }
  }, [onTrace]);

  const endLesson = useCallback(async () => {
    activeControllerRef.current?.abort("lesson_ended");
    await runtimeRef.current?.end();
  }, []);

  return { state, status, pendingCount, error, expireCue, endLesson };
}
