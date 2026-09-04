import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildTeachingInterpretationRequest } from "../lesson-stream/context-projection";
import { LosslessInterpretationScheduler } from "../lesson-stream/pending-evidence";
import { createHttpTeachingInterpreter, TeachingInterpreterError, type TeachingInterpreter } from "../lesson-stream/planner";
import { LessonStreamRuntime } from "../lesson-stream/runtime";
import { createInitialTeachingState } from "../lesson-stream/teaching-state";
import type { TeachingStateSnapshot } from "../lesson-stream/contracts";
import type { AcceptedInterpretationStep } from "../lesson-stream/contracts";
import { traceDraft, type AcceptedContributionAudit, type TraceEmitter } from "../trace/contracts";
import { persistedAuditDigest } from "../trace/audit";
import type { CanonicalSpeechState, SpeechRunId, SpeechStatus } from "./speech-types";
import type { SessionStatus } from "./session-types";
import { RetryBackoff } from "./retry-backoff";

const HARD_DEADLINE_MS = 6_000;
const FINALIZATION_DRAIN_TIMEOUT_MS = 12_000;
const MODEL_NAME = "gpt-5.6-luna";

export function checkpointTraceIdentity(speechRunId: SpeechRunId, spanId: string) {
  return `${speechRunId}:${spanId}`;
}

const boardContentText = (content: import("../lesson-stream/contracts").BoardContent) => content.kind === "TEXT"
  ? content.text
  : content.kind === "FOCUS"
    ? content.target
    : content.kind === "RELATION"
      ? `${content.relation}: ${content.targets.join("; ")}`
      : `${content.from} → ${content.to}`;
function auditContribution(contribution: import("../lesson-stream/contracts").TeachingContribution<string | import("../lesson-stream/contracts").BoardContent>) {
  return {
    mode: contribution.mode,
    content: typeof contribution.content === "string" ? contribution.content : boardContentText(contribution.content),
    provenance: {
      basis: contribution.provenance.basis,
      speechRefs: (contribution.provenance.speechRefs ?? []).map((reference) => ({ checkpointId: reference.checkpointId, quote: reference.quote })),
      stateRefs: (contribution.provenance.stateRefs ?? []).map((reference) => ({ kind: reference.kind, id: reference.id })),
    },
  };
}
function acceptedContributionAudit(step: AcceptedInterpretationStep): AcceptedContributionAudit {
  const board = step.boardDelta.action === "SET_ACTIVE"
    ? { action: step.boardDelta.action, contribution: auditContribution(step.boardDelta.contribution), support: (step.boardDelta.support ?? []).map(auditContribution), invalidatesBoardItemIds: step.boardDelta.invalidatesBoardItemIds ?? [] }
    : step.boardDelta.action === "ADD_SUPPORT"
      ? { action: step.boardDelta.action, support: [auditContribution(step.boardDelta.support)], invalidatesBoardItemIds: [] }
    : { action: step.boardDelta.action, support: [], invalidatesBoardItemIds: [] };
  const cue = step.cueDelta.action === "SET"
    ? { action: step.cueDelta.action, kind: step.cueDelta.cueKind, contribution: auditContribution(step.cueDelta.contribution) }
    : step.cueDelta.action === "RESOLVE_CURRENT"
    ? { action: step.cueDelta.action, resolutionEvidence: { checkpointId: step.cueDelta.evidence.checkpointId, quote: step.cueDelta.evidence.quote } }
      : { action: step.cueDelta.action };
  return { board, cue, warnings: step.warnings.map((warning) => warning.detail ? { code: warning.code, detail: warning.detail } : { code: warning.code }) };
}

export function emitAcceptedStepTrace({
  transition,
  speechRunId,
  plannerRequestId,
  emit,
}: {
  transition: { step: AcceptedInterpretationStep; lessonEvent?: Extract<import("../lesson-stream/contracts").LessonEvent, { type: "interpretation.step_accepted" }>; lessonEventId?: string; lessonEventSequence?: number; stateBefore: TeachingStateSnapshot; stateAfter: TeachingStateSnapshot };
  speechRunId: SpeechRunId;
  plannerRequestId: string;
  emit: TraceEmitter;
}) {
  const { step, stateBefore, stateAfter, lessonEvent, lessonEventId, lessonEventSequence } = transition;
  const correlation = { rootId: `interpretation:${plannerRequestId}`, runId: speechRunId, plannerRequestId, interpretationId: step.interpretationId, ...(lessonEventId ? { lessonEventId } : {}), stepIndex: step.stepIndex, boardRevision: stateAfter.board.revision, cueRevision: stateAfter.cue.revision };
  emit(traceDraft("interpretation.step_accepted", {
    requestId: plannerRequestId,
    interpretationId: step.interpretationId,
    ...(lessonEventId ? { lessonEventId } : {}),
    ...(lessonEventSequence !== undefined ? { lessonEventSequence } : {}),
    ...(lessonEvent ? { acceptedLessonEvent: lessonEvent, acceptedLessonEventDigest: persistedAuditDigest(lessonEvent), actualModel: lessonEvent.step.model } : {}),
    stepIndex: step.stepIndex,
    checkpointIds: step.consumesCheckpointIds,
    boardAction: step.boardDelta.action,
    cueAction: step.cueDelta.action,
    ...(step.boardDelta.action === "SET_ACTIVE" ? { boardMode: step.boardDelta.contribution.mode, boardSpeechRefCount: step.boardDelta.contribution.provenance.speechRefs?.length ?? 0 } : {}),
    ...(step.cueDelta.action === "SET" ? { cueMode: step.cueDelta.contribution.mode, cueSpeechRefCount: step.cueDelta.contribution.provenance.speechRefs?.length ?? 0 } : {}),
    acceptedContribution: acceptedContributionAudit(step),
    stateBefore,
    stateBeforeDigest: persistedAuditDigest(stateBefore),
    stateAfter,
    stateAfterDigest: persistedAuditDigest(stateAfter),
  }, { correlation }));
  if (step.boardDelta.action === "KEEP") emit(traceDraft("board.keep", { reason: step.boardDelta.reason }, { correlation }));
  if (step.boardDelta.action === "SET_ACTIVE") {
    const boardItemId = `board-${step.interpretationId}-${step.stepIndex}`;
    emit(traceDraft("board.active_set", { boardItemId, continuity: step.boardDelta.continuity }, { correlation: { ...correlation, boardItemId } }));
    if (step.boardDelta.retainPrevious && stateBefore.board.active) emit(traceDraft("board.context_retained", { boardItemIds: [stateBefore.board.active.id] }, { correlation }));
    if (step.boardDelta.continuity !== "same_thread") emit(traceDraft("board.context_retired", { boardItemIds: [stateBefore.board.active, ...stateBefore.board.retained].flatMap((item) => item ? [item.id] : []) }, { correlation }));
    if (step.boardDelta.invalidatesBoardItemIds?.length) emit(traceDraft("board.content_invalidated", { boardItemIds: step.boardDelta.invalidatesBoardItemIds }, { correlation }));
  }
  if (step.boardDelta.action === "ADD_SUPPORT") emit(traceDraft("board.support_added", { boardItemId: step.boardDelta.targetBoardItemId, supportId: `support-${step.interpretationId}-${step.stepIndex}` }, { correlation: { ...correlation, boardItemId: step.boardDelta.targetBoardItemId } }));
  if (step.cueDelta.action === "KEEP") emit(traceDraft("teaching_cue.keep", {}, { correlation }));
  if (step.cueDelta.action === "SET") {
    const cueId = `cue-${step.interpretationId}-${step.stepIndex}`;
    emit(traceDraft("teaching_cue.set", { cueId, kind: step.cueDelta.cueKind }, { correlation: { ...correlation, cueId } }));
  }
  if (step.cueDelta.action === "RESOLVE_CURRENT" && stateBefore.cue.active) emit(traceDraft("teaching_cue.resolved", { cueId: stateBefore.cue.active.id, reason: step.cueDelta.reason }, { correlation: { ...correlation, cueId: stateBefore.cue.active.id } }));
}

export type LiveTeachingStatus = "restoring" | "ready" | "interpreting" | "degraded";
export type TeachingRenderOrigin = { requestId: string; interpretationId: string; lessonEventId: string; stepIndex: number };

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
  speechRunId: SpeechRunId;
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
  const finalizingRef = useRef(false);
  const retryBackoffRef = useRef(new RetryBackoff());
  const activeRunRef = useRef(speechRunId);
  const openedCheckpointTraceRef = useRef(new Set<string>());
  const [state, setState] = useState<TeachingStateSnapshot>(createInitialTeachingState);
  const [status, setStatus] = useState<LiveTeachingStatus>("restoring");
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string>();
  const [runtimeEpoch, setRuntimeEpoch] = useState(0);
  const [renderOrigin, setRenderOrigin] = useState<TeachingRenderOrigin>();

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
      retryBackoffRef.current.clear();
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
    retryBackoffRef.current.fail(() => pumpRef.current());
  }, []);

  const pump = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || sessionStatus !== "active" || (speechStatus !== "ready" && !finalizingRef.current)) return;
    if (retryBackoffRef.current.active) return;
    const scheduled = schedulerRef.current.next(speechRunId);
    if (!scheduled) return;
    const { work, checkpoints } = scheduled;
    const { request, diagnostics } = buildTeachingInterpretationRequest({ requestId: work.requestId, sessionId, events: runtime.events, currentState: runtime.state, newEvidence: checkpoints });
    const committedTimes = checkpoints.flatMap((checkpoint) => {
      const event = runtime.events.find((item) => item.type === "evidence.checkpoint_committed" && item.checkpoint.checkpointId === checkpoint.checkpointId);
      return event?.type === "evidence.checkpoint_committed" ? [Date.parse(event.timestamp)] : [];
    });
    const oldestPendingAgeMs = committedTimes.length ? Math.max(0, Date.now() - Math.min(...committedTimes)) : 0;
    const traceCorrelation = { rootId: `interpretation:${work.requestId}`, runId: speechRunId, plannerRequestId: work.requestId };
    onTrace?.(traceDraft("interpretation.request_snapshot", {
      requestId: work.requestId,
      sessionId,
      policyVersion: request.policyVersion,
      semanticProfileId: request.semanticProfileId,
      request,
      requestDigest: persistedAuditDigest(request),
      requestBaseState: request.currentState,
      requestBaseStateDigest: persistedAuditDigest(request.currentState),
      checkpointIds: request.newEvidence.map((item) => item.checkpointId),
      baseBoardRevision: request.currentState.board.revision,
      baseCueRevision: request.currentState.cue.revision,
    }, { correlation: traceCorrelation }));
    onTrace?.(traceDraft("context_projection.created", { requestId: work.requestId, ...diagnostics, pendingCount: schedulerRef.current.pendingCount, oldestPendingAgeMs }, { correlation: { rootId: `interpretation:${work.requestId}`, runId: speechRunId, plannerRequestId: work.requestId } }));
    onTrace?.(traceDraft("interpretation.request_started", { requestId: work.requestId, checkpointIds: work.checkpointIds, pendingCount: schedulerRef.current.pendingCount, projectedInputTokens: diagnostics.projectedInputTokens }, { correlation: { rootId: `interpretation:${work.requestId}`, runId: speechRunId, plannerRequestId: work.requestId } }));
    setStatus("interpreting");
    const controller = new AbortController();
    activeControllerRef.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort("hard_deadline"); }, HARD_DEADLINE_MS);

    void interpreter.interpret(request, { signal: controller.signal }).then(async (response) => {
      if (response.audit) {
        const audit = response.audit;
        onTrace?.(traceDraft("provider.contract_snapshot", {
          contractDigest: audit.providerContract.providerContractDigest,
          requestedModel: audit.providerContract.requestedModel,
          ...(audit.providerContract.serviceTier ? { serviceTier: audit.providerContract.serviceTier } : {}),
          temperature: audit.providerContract.temperature,
          reasoningEffort: audit.providerContract.reasoningEffort,
          maxOutputTokens: audit.providerContract.maxOutputTokens,
          policyVersion: audit.providerContract.policyVersion,
          semanticProfileId: audit.providerContract.semanticProfileId,
          systemPolicy: audit.providerContract.systemPolicy,
          systemPolicyDigest: audit.providerContract.systemPolicyDigest,
          structuredOutputSchema: audit.providerContract.structuredOutputSchema,
          structuredOutputSchemaDigest: audit.providerContract.structuredOutputSchemaDigest,
          providerContract: audit.providerContract,
        }, { correlation: traceCorrelation }));
        onTrace?.(traceDraft("provider.request_snapshot", { requestId: work.requestId, providerRequest: audit.providerRequest, providerRequestDigest: audit.providerRequestDigest, providerContractDigest: audit.providerContract.providerContractDigest, domainRequestDigest: audit.domainRequestDigest }, { correlation: traceCorrelation }));
        onTrace?.(traceDraft("provider.response_snapshot", { requestId: work.requestId, providerResponse: audit.providerResponse, providerResponseDigest: audit.providerResponse.providerResponseDigest }, { correlation: traceCorrelation }));
        if (audit.providerResponse.rawStructuredOutputDigest) onTrace?.(traceDraft("interpretation.proposal_normalized", { requestId: work.requestId, rawStructuredOutputDigest: audit.providerResponse.rawStructuredOutputDigest, normalizedProposal: response.proposal, normalizedProposalDigest: audit.normalizedProposalDigest }, { correlation: traceCorrelation }));
      }
      const acceptance = await runtime.acceptProposal({
        proposal: response.proposal,
        request,
        model: response.audit?.providerResponse.providerModel ?? response.audit?.providerContract.requestedModel ?? MODEL_NAME,
        isCurrent: () => activeRunRef.current === work.speechRunId && runtimeRef.current === runtime,
      });
      if (!acceptance.ok) {
        onTrace?.(traceDraft("interpretation.validation_result", {
          requestId: work.requestId,
          status: "rejected",
          reason: acceptance.error,
          normalizedProposal: response.proposal,
          normalizedProposalDigest: response.audit?.normalizedProposalDigest ?? persistedAuditDigest(response.proposal),
          requestBaseState: request.currentState,
          validationState: acceptance.validationState,
          currentBoardRevision: request.currentState.board.revision,
          currentCueRevision: request.currentState.cue.revision,
          validationDigest: persistedAuditDigest({ requestId: work.requestId, status: "rejected", reason: acceptance.error, normalizedProposal: response.proposal, normalizedProposalDigest: response.audit?.normalizedProposalDigest ?? persistedAuditDigest(response.proposal), requestBaseState: request.currentState, validationState: acceptance.validationState, currentBoardRevision: request.currentState.board.revision, currentCueRevision: request.currentState.cue.revision }),
        }, { correlation: traceCorrelation }));
        onTrace?.(traceDraft("interpretation.output_rejected", { requestId: work.requestId, reason: acceptance.error, pendingCount: schedulerRef.current.pendingCount }, { correlation: { rootId: `interpretation:${work.requestId}`, runId: speechRunId, plannerRequestId: work.requestId } }));
        throw Object.assign(new Error(acceptance.error), { validationClassified: true });
      }
      onTrace?.(traceDraft("interpretation.validation_result", {
        requestId: work.requestId,
        status: "accepted",
        normalizedProposal: response.proposal,
        normalizedProposalDigest: response.audit?.normalizedProposalDigest ?? persistedAuditDigest(response.proposal),
        boardConflict: acceptance.boardConflict,
        cueConflict: acceptance.cueConflict,
        acceptedStepCount: acceptance.steps.length,
        requestBaseState: request.currentState,
        validationState: acceptance.stateBefore,
        currentBoardRevision: acceptance.stateBefore.board.revision,
        currentCueRevision: acceptance.stateBefore.cue.revision,
        validationDigest: persistedAuditDigest({ requestId: work.requestId, status: "accepted", normalizedProposal: response.proposal, normalizedProposalDigest: response.audit?.normalizedProposalDigest ?? persistedAuditDigest(response.proposal), boardConflict: acceptance.boardConflict, cueConflict: acceptance.cueConflict, acceptedStepCount: acceptance.steps.length, requestBaseState: request.currentState, validationState: acceptance.stateBefore, currentBoardRevision: acceptance.stateBefore.board.revision, currentCueRevision: acceptance.stateBefore.cue.revision }),
      }, { correlation: traceCorrelation }));
      if (acceptance.boardConflict) onTrace?.(traceDraft("interpretation.channel_conflict", { requestId: work.requestId, channel: "board" }, { correlation: { rootId: `interpretation:${work.requestId}`, plannerRequestId: work.requestId } }));
      if (acceptance.cueConflict) onTrace?.(traceDraft("interpretation.channel_conflict", { requestId: work.requestId, channel: "cue" }, { correlation: { rootId: `interpretation:${work.requestId}`, plannerRequestId: work.requestId } }));
      schedulerRef.current.settleAccepted(work.requestId, acceptance.steps.flatMap((step) => step.consumesCheckpointIds));
      retryBackoffRef.current.accept();
      setError(undefined);
      setStatus("ready");
      const latencyMs = Math.max(0, Date.now() - work.startedAtMs);
      onTrace?.(traceDraft("interpretation.request_completed", { requestId: work.requestId, latencyMs, ...(response.usage ? { inputTokens: response.usage.inputTokens, cachedInputTokens: response.usage.cachedInputTokens, outputTokens: response.usage.outputTokens } : {}), ...(response.estimatedCostUsd === undefined ? { costStatus: "rates_unconfigured" as const } : { costStatus: "estimated" as const, estimatedCostUsd: response.estimatedCostUsd }) }, { correlation: { rootId: `interpretation:${work.requestId}`, runId: speechRunId, plannerRequestId: work.requestId } }));
      acceptance.transitions.forEach((transition) => emitAcceptedStepTrace({ transition, speechRunId, plannerRequestId: work.requestId, emit: onTrace }));
      const finalTransition = acceptance.transitions.at(-1);
      if (finalTransition) setRenderOrigin({ requestId: work.requestId, interpretationId: finalTransition.step.interpretationId, lessonEventId: finalTransition.lessonEventId, stepIndex: finalTransition.step.stepIndex });
      queueMicrotask(() => pumpRef.current());
    }).catch((reason: unknown) => {
      const validationAlreadyClassified = reason instanceof Error && (reason as Error & { validationClassified?: boolean }).validationClassified === true;
      const failureAudit = reason instanceof TeachingInterpreterError ? reason.audit : undefined;
      if (failureAudit) {
        const contract = failureAudit.providerContract;
        onTrace?.(traceDraft("provider.contract_snapshot", {
          contractDigest: contract.providerContractDigest, requestedModel: contract.requestedModel, ...(contract.serviceTier ? { serviceTier: contract.serviceTier } : {}), temperature: contract.temperature, reasoningEffort: contract.reasoningEffort, maxOutputTokens: contract.maxOutputTokens, policyVersion: contract.policyVersion, semanticProfileId: contract.semanticProfileId, systemPolicy: contract.systemPolicy, systemPolicyDigest: contract.systemPolicyDigest, structuredOutputSchema: contract.structuredOutputSchema, structuredOutputSchemaDigest: contract.structuredOutputSchemaDigest, providerContract: contract,
        }, { correlation: traceCorrelation }));
        onTrace?.(traceDraft("provider.request_snapshot", { requestId: work.requestId, providerRequest: failureAudit.providerRequest, providerRequestDigest: failureAudit.providerRequestDigest, providerContractDigest: contract.providerContractDigest, domainRequestDigest: failureAudit.domainRequestDigest, providerSnapshotUnavailable: controller.signal.aborted ? "client_abort" : "provider_error" }, { correlation: traceCorrelation }));
        if (failureAudit.providerResponse) onTrace?.(traceDraft("provider.response_snapshot", { requestId: work.requestId, providerResponse: failureAudit.providerResponse, providerResponseDigest: failureAudit.providerResponse.providerResponseDigest }, { correlation: traceCorrelation }));
      } else if (!validationAlreadyClassified) {
        onTrace?.(traceDraft("audit.unavailable", { requestId: work.requestId, stage: "provider_contract", reason: controller.signal.aborted ? "client_abort" : "network_error" }, { correlation: traceCorrelation }));
      }
      if (!validationAlreadyClassified) {
        const validationState = runtime.state;
        const stage = failureAudit?.failureStage ?? "provider_error";
        const message = reason instanceof Error ? reason.message : "teaching-provider-unavailable";
        onTrace?.(traceDraft("interpretation.validation_result", {
          requestId: work.requestId, status: stage, reason: message, requestBaseState: request.currentState, validationState,
          currentBoardRevision: validationState.board.revision, currentCueRevision: validationState.cue.revision,
          validationDigest: persistedAuditDigest({ requestId: work.requestId, status: stage, reason: message, requestBaseState: request.currentState, validationState, currentBoardRevision: validationState.board.revision, currentCueRevision: validationState.cue.revision }),
        }, { correlation: traceCorrelation }));
      }
      schedulerRef.current.settleFailed(work.requestId);
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
      const traceIdentity = checkpointTraceIdentity(speechRunId, span.id);
      if (openedCheckpointTraceRef.current.has(traceIdentity)) continue;
      openedCheckpointTraceRef.current.add(traceIdentity);
      onTrace?.(traceDraft("evidence.checkpoint_opened", { runId: speechRunId, spanId: span.id, spanRevision: span.revision }, { correlation: { rootId: `speech:${speechRunId}:span:${span.id}`, runId: speechRunId, spanId: span.id, spanRevision: span.revision } }));
    }
    const closed = canonicalSpeech.spans.filter((span) => span.status === "closed");
    if (!closed.length) return;
    void (async () => {
      await runtime.start();
      let committedAny = false;
      for (const span of closed) {
        const committed = await runtime.commitClosedSpan(span, speechRunId);
        if (!committed) continue;
        schedulerRef.current.enqueue([committed]);
        committedAny = true;
        setPendingCount(schedulerRef.current.pendingCount);
        onTrace?.(traceDraft("evidence.checkpoint_committed", { runId: speechRunId, checkpointId: committed.checkpointId, lessonSequence: committed.lessonSequence, sourceFinalIds: committed.sourceFinalIds, warningCodes: committed.warnings.map((warning) => warning.code) }, { correlation: { rootId: `checkpoint:${committed.checkpointId}`, runId: speechRunId, lessonSequence: committed.lessonSequence, checkpointId: committed.checkpointId } }));
        onTrace?.(traceDraft("evidence.checkpoint_pending", { checkpointId: committed.checkpointId, pendingCount: schedulerRef.current.pendingCount, oldestPendingAgeMs: 0, estimatedTokens: Math.ceil(committed.text.length / 4) + 16 }, { correlation: { rootId: `checkpoint:${committed.checkpointId}`, runId: speechRunId, lessonSequence: committed.lessonSequence, checkpointId: committed.checkpointId } }));
      }
      if (committedAny) pumpRef.current();
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

  const allocateSpeechRunId = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error("lesson-runtime-not-ready");
    return runtime.allocateSpeechRunId();
  }, []);

  const endLesson = useCallback(async ({ canonicalSpeech, speechRunId }: { canonicalSpeech?: CanonicalSpeechState; speechRunId?: SpeechRunId } = {}) => {
    const runtime = runtimeRef.current;
    if (!runtime) return false;
    finalizingRef.current = true;
    await runtime.start();
    try {
      if (canonicalSpeech && speechRunId !== undefined) {
        for (const span of canonicalSpeech.spans.filter((item) => item.status === "closed")) {
          const committed = await runtime.commitClosedSpan(span, speechRunId);
          if (!committed) continue;
          schedulerRef.current.enqueue([committed]);
          setPendingCount(schedulerRef.current.pendingCount);
          onTrace?.(traceDraft("evidence.checkpoint_committed", { runId: speechRunId, checkpointId: committed.checkpointId, lessonSequence: committed.lessonSequence, sourceFinalIds: committed.sourceFinalIds, warningCodes: committed.warnings.map((warning) => warning.code) }, { correlation: { rootId: `checkpoint:${committed.checkpointId}`, runId: speechRunId, lessonSequence: committed.lessonSequence, checkpointId: committed.checkpointId } }));
          onTrace?.(traceDraft("evidence.checkpoint_pending", { checkpointId: committed.checkpointId, pendingCount: schedulerRef.current.pendingCount, oldestPendingAgeMs: 0, estimatedTokens: Math.ceil(committed.text.length / 4) + 16 }, { correlation: { rootId: `checkpoint:${committed.checkpointId}`, runId: speechRunId, lessonSequence: committed.lessonSequence, checkpointId: committed.checkpointId } }));
        }
      }
      pumpRef.current();
      const deadline = Date.now() + FINALIZATION_DRAIN_TIMEOUT_MS;
      while (schedulerRef.current.currentWork || schedulerRef.current.pendingCount) {
        if (Date.now() >= deadline) {
          const message = "lesson-finalization-incomplete";
          setStatus("degraded");
          setError(message);
          setPendingCount(schedulerRef.current.pendingCount);
          return false;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
        pumpRef.current();
      }
      await runtime.end();
      setPendingCount(0);
      return true;
    } finally {
      finalizingRef.current = false;
    }
  }, [onTrace]);

  return { state, renderOrigin, status, pendingCount, error, expireCue, allocateSpeechRunId, endLesson };
}
