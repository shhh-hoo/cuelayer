import { ZodError } from "zod";
import type { CanonicalSpeechSpan, SpeechRunId } from "../../session/speech-types.ts";
import { RetryBackoff } from "../../session/retry-backoff.ts";
import { persistedAuditDigest } from "../../trace/audit.ts";
import { sanitizeTraceValue, type TraceEmitter } from "../../trace/contracts.ts";
import { abortable } from "../abortable.ts";
import { SessionCoordinator, type SessionLivePolicy, type DispatchReason } from "./session-coordinator.ts";
import { liveResultSchema } from "./session-processing.ts";
import { interpretationDeadlines, type InterpretationFailure } from "../runtime-policy.ts";
import { buildCoreInterpretationContext, type ContextOptions, type CoreInterpretationBinding } from "./interpretation-context.ts";
import { CORE_PROPOSAL_LIMITS, coreProposalSchema } from "./interpretation-proposal.ts";
import type { CoreReplay } from "./replay.ts";
import { CoreLessonStreamRuntime, type CoreEventStore } from "./runtime.ts";
import { CoreTrace, coreContextDiagnostics, coreProviderResponseAudit } from "./trace.ts";
import { VerificationDispatcher, type VerificationSink } from "./verification-dispatcher.ts";

export type CoreProviderDiagnostic =
  | { stage: "request"; request: unknown; identity: { contract: string; policy: string }; requestedModel: string }
  | { stage: "response"; response?: unknown; transportError?: string; elapsedMs: number };
export type CoreLiveInterpreter = (binding: CoreInterpretationBinding, options: {
  signal: AbortSignal; observe: (diagnostic: CoreProviderDiagnostic) => void;
}) => Promise<unknown>;
export type CoreLiveOptions = {
  sessionId: string; lessonDomain: "core"; interpreter: CoreLiveInterpreter; store?: CoreEventStore;
  speechRunId: SpeechRunId; trace?: TraceEmitter; verificationSink?: VerificationSink;
  contextOptions?: (base: CoreReplay) => Omit<ContextOptions, "requestId" | "newEvidence" | "unresolved">;
  /** Injected timing for deterministic tests; production defaults match the existing chassis. */
  scheduling?: Partial<SessionLivePolicy>;
  deadlineMs?: number; finalizationMs?: number; verificationTimeoutMs?: number;
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 2_048);
type RequestStage = "provider" | "normalization" | "validation" | "persistence";
function failureCategory(error: unknown, stage: RequestStage, signal?: AbortSignal): InterpretationFailure {
  const reason = message(error);
  if (signal?.reason === "core-provider-timeout") return "timeout";
  if (signal?.aborted || reason === "core-stale-result") return "cancelled";
  if (/core-(knowledge|cue)-conflict/.test(reason) || reason.includes("pending-prefix")) return "conflict";
  if (reason.includes("budget")) return "budget";
  // The provider adapter can parse JSON/schema before the outer stage advances.
  if (error instanceof ZodError || error instanceof SyntaxError) return "validation";
  if (stage === "normalization" || stage === "validation") return "validation";
  return "provider";
}

/** Shared live controller for production and injected hosts. It owns one semantic flight. */
export class CoreLiveSession {
  readonly coordinator: SessionCoordinator;
  private get scheduler() { return this.coordinator; }
  private dispatchTimer?: ReturnType<typeof setTimeout>;
  readonly verification: VerificationDispatcher;
  private retry = new RetryBackoff();
  private trace: CoreTrace;
  private runId: SpeechRunId;
  private generation = 0;
  private running = true;
  private closed = false;
  private finishing = false;
  private error?: string;
  private flight?: { controller: AbortController; done: Promise<void> };
  private committing = new Set<Promise<unknown>>();
  private unresolved: NonNullable<ContextOptions["unresolved"]> = [];

  private constructor(readonly runtime: CoreLessonStreamRuntime, private options: CoreLiveOptions) {
    this.runId = options.speechRunId;
    this.trace = new CoreTrace(options.trace);
    this.verification = new VerificationDispatcher(options.verificationSink, this.trace, options.verificationTimeoutMs);
    this.coordinator = new SessionCoordinator(runtime, options.scheduling);
    this.windowTrace("restored");
  }
  static async open(options: CoreLiveOptions) {
    if (options.lessonDomain !== "core") throw new Error("lesson-domain-mismatch");
    const runtime = await CoreLessonStreamRuntime.open(options.sessionId, options.store);
    try {
      await runtime.start();
      const session = new CoreLiveSession(runtime, options);
      session.pump();
      return session;
    } catch (error) { runtime.close(); throw error; }
  }
  get state() { return this.runtime.state; }
  get currentAttempt() { return this.flight?.done; }
  get health() { return { pendingCount: this.scheduler.pendingCount, inFlight: !!this.flight,
    oldestPendingAgeMs: this.coordinator.oldestPendingAgeMs, paused: !this.running || this.retry.isPaused, consecutiveFailures: this.retry.consecutiveFailures, error: this.error }; }

  async commitClosedSpan(span: CanonicalSpeechSpan, speechRunId = this.runId) {
    if (this.closed || this.finishing) throw new Error("core-session-not-capturing");
    if (speechRunId !== this.runId) throw new Error("core-stale-speech-run");
    const commit = this.commit(span, speechRunId);
    this.committing.add(commit);
    try { return await commit; } finally { this.committing.delete(commit); }
  }
  private async commit(span: CanonicalSpeechSpan, speechRunId: SpeechRunId) {
    const checkpoint = await this.runtime.commitClosedSpan(span, speechRunId);
    if (checkpoint) {
      this.scheduler.enqueue([checkpoint]);
      // Existing canonical closure is a scheduling signal only, never semantic resolution.
      if (span.closeReason && ["terminal_punctuation", "meaningful_pause", "timing_gap", "explicit_stop"].includes(span.closeReason)) this.coordinator.markBoundary(checkpoint.checkpointId);
      this.trace.record("core.checkpoint_committed", () => ({ checkpointId: checkpoint.checkpointId,
        lessonSequence: checkpoint.lessonSequence, eventId: this.runtime.indexes.commits.get(checkpoint.checkpointId)!.eventId }),
      { runId: speechRunId, checkpointId: checkpoint.checkpointId });
      this.windowTrace("committed");
      this.pump();
    }
    return checkpoint;
  }
  async allocateSpeechRunId() { if (this.closed || this.finishing) throw new Error("core-session-not-capturing"); const runId = await this.runtime.allocateSpeechRunId(); this.setSpeechRun(runId); return runId; }
  setSpeechRun(runId: SpeechRunId) {
    if (runId === this.runId) return;
    if (this.closed || this.finishing) throw new Error("core-session-not-capturing");
    this.generation++;
    this.runId = runId;
    this.flight?.controller.abort("core-stale-speech-run");
    this.retry.accept(); this.running = true; this.error = undefined;
    // Keep the old flight occupied until its write has actually settled.
    this.pump();
  }
  cancel() { clearTimeout(this.dispatchTimer); this.running = false; this.retry.clear(); this.flight?.controller.abort("core-cancelled"); }
  resume() { if (this.closed) return; this.running = true; this.retry.accept(); this.error = undefined; this.pump(); }
  close() { this.closed = true; this.cancel(); this.verification.close(); this.runtime.close(); }

  private pump() {
    if (this.closed || !this.running || this.flight || this.retry.active || this.runtime.replay.ended) return;
    clearTimeout(this.dispatchTimer);
    const eligibility = this.coordinator.eligibility();
    if (!eligibility) return;
    if (eligibility.waitMs > 0) {
      this.dispatchTimer = setTimeout(() => this.pump(), eligibility.waitMs);
      return;
    }
    let blocked: unknown;
    let preview: CoreInterpretationBinding | undefined;
    const scheduled = this.scheduler.next(this.runId, 3_500, Date.now(), batch => {
      try {
        preview = buildCoreInterpretationContext(this.runtime.replay, {
          ...this.options.contextOptions?.(this.runtime.replay), requestId: "core-budget-preview", newEvidence: batch, unresolved: [...this.runtime.replay.unresolved.values(), ...this.unresolved], indexes: this.runtime.indexes,
        });
        return true;
      } catch (error) { blocked = error; return false; }
    });
    if (!scheduled || !preview) {
      if (this.scheduler.isBudgetBlocked) {
        this.error = message(blocked);
        this.retry.fail(() => undefined, "budget");
        this.trace.record("core.context_blocked", () => ({ checkpointIds: this.runtime.pending.slice(0, 1).map(c => c.checkpointId),
          reason: this.error!, mandatoryClosureFailed: this.error!.includes("required") }));
      }
      return;
    }
    const binding = { ...preview, requestId: JSON.stringify([this.runtime.sessionId, "LIVE", preview.newEvidenceIds,
      preview.base.state.knowledge.revision, preview.base.state.cue.revision]) };
    this.coordinator.task = { lane: "LIVE", taskId: binding.requestId, checkpointIds: binding.newEvidenceIds,
      knowledgeRevision: binding.base.state.knowledge.revision, cueRevision: binding.base.state.cue.revision };
    const generation = this.generation;
    const controller = new AbortController();
    const flight = { controller, done: Promise.resolve() };
    this.flight = flight;
    flight.done = this.perform(binding, scheduled.work.requestId, generation, controller, eligibility.reason).finally(() => {
      if (this.flight === flight) this.flight = undefined;
      if (!this.closed && (generation !== this.generation || !this.error)) this.pump();
    });
  }

  private async perform(binding: CoreInterpretationBinding, schedulerRequestId: string, generation: number, controller: AbortController, dispatchReason: DispatchReason) {
    const scheduledAt = new Date(this.scheduler.currentWork!.startedAtMs).toISOString(), started = performance.now();
    let outcome: "accepted" | "needs_context" | "failure" = "failure";
    const correlation = { coreRequestId: binding.requestId, runId: this.runId };
    const current = () => !this.closed && generation === this.generation && this.scheduler.currentWork?.requestId === schedulerRequestId;
    const deadline = setTimeout(() => controller.abort("core-provider-timeout"), this.options.deadlineMs ?? interpretationDeadlines().clientMs);
    let validated = false;
    let stage: RequestStage = "provider";
    try {
      this.trace.record("core.request", () => ({ requestId: binding.requestId, checkpointIds: binding.newEvidenceIds,
        scheduledAt, queuedAt: this.runtime.indexes.commits.get(binding.newEvidenceIds[0]!)?.timestamp,
        queue: this.queuePressure(binding.newEvidenceIds.length), task: this.coordinator.task, dispatchReason,
        diagnostics: coreContextDiagnostics(binding), context: binding.context,
        entities: [...binding.entities].map(([handle, entity]) => ({ handle, ...entity })) }), correlation);
      const raw = await abortable(() => this.options.interpreter(binding, { signal: controller.signal, observe: diagnostic => {
        if (!current() || controller.signal.aborted) return;
        if (diagnostic.stage === "request") this.trace.record("core.provider_request", () => ({ ...diagnostic, requestDigest: persistedAuditDigest(diagnostic.request) }), correlation);
        else this.trace.record("core.provider_response", () => {
          const audit = coreProviderResponseAudit(diagnostic.response);
          return { ...audit, elapsedMs: diagnostic.elapsedMs, transportError: diagnostic.transportError?.slice(0, 2_048), responseDigest: persistedAuditDigest(audit.response) };
        }, correlation);
      } }), controller.signal);
      clearTimeout(deadline); // A provider deadline must never abort an ongoing store transaction.
      controller.signal.throwIfAborted();
      if (!current()) throw new Error("core-stale-result");
      stage = "normalization";
      const envelope = raw && typeof raw === "object" && "version" in raw ? liveResultSchema.parse(raw) : undefined;
      const proposal = coreProposalSchema.parse(envelope ? envelope.proposal : raw);
      this.trace.record("core.proposal_normalized", () => {
        const safeProposal = proposal.outcome.kind === "PROPOSE" ? { outcome: { ...proposal.outcome,
          verificationRequests: sanitizeTraceValue(Array.isArray(proposal.outcome.verificationRequests)
            ? proposal.outcome.verificationRequests.slice(0, CORE_PROPOSAL_LIMITS.verificationRequests) : proposal.outcome.verificationRequests),
        } } : proposal;
        return { proposal: safeProposal, proposalDigest: persistedAuditDigest(safeProposal) };
      }, correlation);
      stage = "validation";
      const accepted = await this.runtime.acceptProposal(binding, proposal, { processing: envelope?.processing, signal: controller.signal, isCurrent: current,
        onValidated: result => {
          validated = true;
          if (result.kind === "PROPOSE") stage = "persistence";
          this.trace.record("core.validation", () => ({ status: result.kind === "PROPOSE" ? "accepted" : "needs_context",
            knowledgeRevision: this.state.knowledge.revision, cueRevision: this.state.cue.revision, stepCount: result.steps.length }), correlation);
        },
      });
      if (accepted.kind === "NEEDS_CONTEXT") {
        outcome = "needs_context";
        // Explicit pause. Host resume reprojects with the grounded retrieval phrase;
        // newly arriving evidence cannot bypass this gate or cause an infinite loop.
        this.unresolved = accepted.checkpointIds.map(checkpointId => ({ checkpointId, phrase: accepted.query }));
        this.scheduler.settleFailed(schedulerRequestId);
        this.error = "core-needs-context";
        this.retry.fail(() => undefined, "budget");
        return;
      }
      this.scheduler.settleAccepted(schedulerRequestId, accepted.steps.flatMap(step => step.consumesCheckpointIds));
      this.retry.accept(); this.error = undefined; this.unresolved = []; outcome = "accepted";
      this.trace.record("core.accepted", () => ({ steps: accepted.steps, events: accepted.events,
        eventIds: accepted.events.map(e => e.eventId), eventsDigest: persistedAuditDigest(accepted.events) }), correlation);
      this.trace.record("core.published", () => ({ eventIds: accepted.events.map(e => e.eventId),
        knowledgeRevision: accepted.replay.state.knowledge.revision, cueRevision: accepted.replay.state.cue.revision,
        stateDigest: persistedAuditDigest(accepted.replay.state), processedThroughSequence: accepted.replay.state.processedThroughSequence,
        origin: "core-authority", compatibilityProjection: "none" }), correlation);
      // Diagnostics/sidecars run only after durable acceptance and scheduler settlement.
      try {
        if (proposal.outcome.kind === "PROPOSE" && Array.isArray(proposal.outcome.verificationRequests)) {
          const kept = new Set(accepted.verificationRequests.map(request => request.requestIndex));
          proposal.outcome.verificationRequests.slice(0, CORE_PROPOSAL_LIMITS.verificationRequests).forEach((_, index) => {
            if (!kept.has(index)) this.trace.record("core.verification_dropped", () => ({ verificationRequestIndex: index, reason: "malformed_or_ungrounded" }), { ...correlation, verificationRequestIndex: index });
          });
        }
        this.verification.enqueue(accepted.verificationRequests.map(request => ({ sessionId: this.runtime.sessionId,
          coreRequestId: binding.requestId, verificationRequestIndex: request.requestIndex, checkpointIds: request.checkpointIds,
          query: request.query, claim: request.claim, candidateEvidence: request.candidateEvidence })));
      } catch { /* A side-path failure cannot turn a committed acceptance into a failure. */ }
    } catch (error) {
      this.scheduler.settleFailed(schedulerRequestId);
      // If another accepted Core writer won, never reopen its consumed evidence.
      const remaining = new Set(this.runtime.pending.map(checkpoint => checkpoint.checkpointId));
      if (this.scheduler.pendingCheckpoints.some(checkpoint => !remaining.has(checkpoint.checkpointId))) this.scheduler.restore(this.runtime.pending);
      const category = failureCategory(error, stage, controller.signal);
      this.trace.record("core.request_failed", () => ({ reason: message(error), category: stage === "persistence" && !controller.signal.aborted ? "persistence" : category, stage, pendingCount: this.scheduler.pendingCount }), correlation);
      if (!validated && stage === "validation") this.trace.record("core.validation", () => ({ status: "rejected", reason: message(error),
        knowledgeRevision: this.state.knowledge.revision, cueRevision: this.state.cue.revision }), correlation);
      if (!this.closed && generation === this.generation) {
        this.error = message(error);
        this.retry.fail(() => this.pump(), category);
      }
    } finally {
      clearTimeout(deadline);
      this.trace.record("core.attempt_completed", () => ({ scheduledAt, completedAt: new Date().toISOString(),
        elapsedMs: performance.now() - started, outcome, queue: this.queuePressure(binding.newEvidenceIds.length),
        task: this.coordinator.task, processing: binding.newEvidenceIds.flatMap(id => this.runtime.replay.dispositions.get(id) ?? []),
        unresolvedCount: this.runtime.replay.unresolved.size, stageReviewCount: this.runtime.replay.reviews.size,
      }), correlation);
      this.coordinator.task = undefined;
    }
  }

  private queuePressure(requestCheckpointCount: number) {
    return { pendingCheckpointCount: this.scheduler.pendingCount,
      oldestPendingAgeMs: this.scheduler.pendingCount ? this.coordinator.oldestPendingAgeMs : null,
      requestCheckpointCount, processedThroughSequence: this.state.processedThroughSequence,
      consecutiveFailures: this.retry.consecutiveFailures, paused: !this.running || this.retry.isPaused,
      backingOff: this.retry.active && !this.retry.isPaused };
  }
  private windowTrace(status: "restored" | "committed") {
    this.trace.record("core.session_window", () => ({ status, lane: "LIVE", ...this.coordinator.snapshot(16),
      eligibility: this.coordinator.eligibility(), timestamp: new Date().toISOString(),
    }));
  }

  /** Caller first drains capture. Refuse new spans while draining the semantic tail. */
  async finalize(tail: readonly CanonicalSpeechSpan[] = [], speechRunId = this.runId) {
    if (this.finishing || this.closed) return false;
    this.finishing = true;
    this.trace.record("core.finalization", () => ({ status: "draining", pendingCount: this.scheduler.pendingCount }));
    const deadline = Date.now() + (this.options.finalizationMs ?? 12_000);
    try {
      if (speechRunId !== this.runId) throw new Error("core-stale-speech-run");
      await Promise.all([...this.committing]);
      for (const span of tail) await this.commit(span, speechRunId);
      this.coordinator.flush();
      this.pump();
      while (this.flight || this.scheduler.pendingCount || this.runtime.pending.length) {
        if (this.closed || Date.now() >= deadline) throw new Error("core-finalization-incomplete");
        await new Promise<void>(resolve => setTimeout(resolve, 25));
        this.pump();
      }
      await this.runtime.end();
      this.verification.close();
      this.trace.record("core.finalization", () => ({ status: "ended", pendingCount: 0 }));
      return true;
    } catch (error) {
      this.error = message(error);
      this.trace.record("core.finalization", () => ({ status: "incomplete", pendingCount: this.scheduler.pendingCount, reason: this.error }));
      return false;
    } finally { this.finishing = false; this.coordinator.flush(false); }
  }
}
