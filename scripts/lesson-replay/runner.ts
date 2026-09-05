import { LessonStreamRuntime } from "../../src/lesson-stream/runtime.ts";
import { LosslessInterpretationScheduler } from "../../src/lesson-stream/pending-evidence.ts";
import { nextTeachingRequest } from "../../src/lesson-stream/scheduled-request.ts";
import { RetryBackoff } from "../../src/session/retry-backoff.ts";
import { classifyInterpretationFailure, interpretationDeadlines } from "../../src/lesson-stream/runtime-policy.ts";
import { interpretWithAbort, type TeachingInterpreter } from "../../src/lesson-stream/planner.ts";
import { replayLessonEvents } from "../../src/lesson-stream/replay.ts";
import { canonicalJson, persistedAuditDigest } from "../../src/trace/audit.ts";
import type { LessonEvent, TeachingStateSnapshot } from "../../src/lesson-stream/contracts.ts";
import type { Segment } from "./input.ts";
import { safeRequestEnvelope } from "./provider.ts";

export type TimelineRow = { schemaVersion: "lesson-replay-timeline-v1"; type: string; runTimeMs: number; wallTime: string; pendingCount: number; oldestPendingAgeMs: number; [key: string]: unknown };
export type ReplayResult = { status: string; attempts: number; delivered: number; skipped: number; remainingInput: Segment[]; pendingEvidenceIds: string[]; state: TeachingStateSnapshot; replayMatches: boolean; durationMs: number; lessonEvents: LessonEvent[] };
export type ReplayOptions = { lessonId: string; segments: Segment[]; timelineOriginMs: number; mode: "sequential" | "realtime"; interpreter: TeachingInterpreter; model: string; maxAttempts: number; maxRuntimeMs: number; signal?: AbortSignal; onTimeline(row: TimelineRow): void; onLessonEvents?(events: readonly LessonEvent[]): void };

export async function runReplay(options: ReplayOptions): Promise<ReplayResult> {
  const started = performance.now(), elapsed = () => Math.max(0, performance.now() - started);
  const controller = new AbortController(), events: LessonEvent[] = [];
  const scheduler = new LosslessInterpretationScheduler(), retry = new RetryBackoff();
  const arrivals = new Map<string, { segment: Segment; runTimeMs: number }>();
  let attempts = 0, delivered = 0, skipped = 0, status = "completed";
  let flight: Promise<void> | undefined;
  const runtime = await LessonStreamRuntime.open(options.lessonId, {
    readSession: async () => [], append: async (items, signal) => { signal?.throwIfAborted(); options.onLessonEvents?.(items); events.push(...items); },
  });
  const health = () => {
    const times = runtime.pending.flatMap(c => arrivals.has(c.checkpointId) ? [arrivals.get(c.checkpointId)!.runTimeMs] : []);
    return { pendingCount: runtime.pending.length, oldestPendingAgeMs: times.length ? Math.max(0, elapsed() - Math.min(...times)) : 0 };
  };
  const emit = (type: string, payload: Record<string, unknown> = {}) => options.onTimeline({ schemaVersion: "lesson-replay-timeline-v1", type, runTimeMs: elapsed(), wallTime: new Date().toISOString(), ...health(), ...payload });
  const stop = (reason: string) => { if (!controller.signal.aborted) { status = reason; controller.abort(reason); retry.clear(); emit("run.stopped", { reason }); } };
  const cancel = () => stop("cancelled");
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const cap = setTimeout(() => stop("time-limit"), options.maxRuntimeMs);
  const wait = (ms: number) => new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, Math.max(0, ms));
    if (controller.signal.aborted) done(); else controller.signal.addEventListener("abort", done, { once: true });
  });
  const evidenceTimes = (ids: string[]) => ids.map(checkpointId => ({ checkpointId, ...arrivals.get(checkpointId) }));
  let speechRunId: string | number = "";
  const pump = () => {
    if (controller.signal.aborted || flight || retry.active || !scheduler.pendingCount) return;
    if (attempts >= options.maxAttempts) { stop("attempt-limit"); return; }
    const scheduled = nextTeachingRequest(runtime, scheduler, speechRunId, runtime.sessionId);
    if (!scheduled) {
      if (scheduler.isBudgetBlocked) { retry.fail(() => undefined, "budget"); emit("request.blocked", { reason: "interpretation-request-budget-exceeded", category: "budget" }); }
      return;
    }
    const { work, request, diagnostics } = scheduled;
    const attempt = ++attempts, attemptStarted = elapsed();
    const attemptController = new AbortController();
    const abort = () => attemptController.abort(controller.signal.reason);
    controller.signal.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; attemptController.abort("hard_deadline"); }, interpretationDeadlines().clientMs);
    emit("request.started", { requestId: work.requestId, attempt, requestTimeMs: attemptStarted, evidence: evidenceTimes(work.checkpointIds), request, providerRequest: safeRequestEnvelope(request), requestDigest: persistedAuditDigest(request), diagnostics, before: runtime.state });
    flight = (async () => {
      try {
        const output = await interpretWithAbort(options.interpreter, request, attemptController.signal);
        clearTimeout(timer); // Same production boundary: response arrival ends client deadline.
        if (controller.signal.aborted) throw new Error("replay-cancelled");
        emit("request.output", { requestId: work.requestId, attempt, output });
        const accepted = await runtime.acceptProposal({ request, proposal: output.proposal, model: output.audit?.providerResponse.providerModel ?? options.model, signal: attemptController.signal, isCurrent: () => !controller.signal.aborted });
        if (!accepted.ok) {
          emit("request.validation", { requestId: work.requestId, attempt, reason: accepted.error, validationState: accepted.validationState });
          throw new Error(accepted.error);
        }
        scheduler.settleAccepted(work.requestId, accepted.steps.flatMap(s => s.consumesCheckpointIds)); retry.accept();
        for (const transition of accepted.transitions) emit("step.accepted", { requestId: work.requestId, attempt, acceptedTimeMs: elapsed(), consumedEvidenceIds: transition.step.consumesCheckpointIds, evidence: evidenceTimes(transition.step.consumesCheckpointIds), before: transition.stateBefore, boardDelta: transition.step.boardDelta, cueDelta: transition.step.cueDelta, after: transition.stateAfter, lessonEventId: transition.lessonEventId });
        emit("request.completed", { requestId: work.requestId, attempt, latencyMs: elapsed() - attemptStarted });
      } catch (error) {
        scheduler.settleFailed(work.requestId);
        const reason = error instanceof Error ? error.message : "replay-request-failed";
        const category = classifyInterpretationFailure(reason, controller.signal.aborted, timedOut);
        emit("request.failed", { requestId: work.requestId, attempt, reason, category, latencyMs: elapsed() - attemptStarted, evidence: evidenceTimes(work.checkpointIds), validationState: runtime.state, ...(error && typeof error === "object" && "audit" in error ? { audit: error.audit } : {}) });
        retry.fail(pump, category);
      } finally {
        clearTimeout(timer); controller.signal.removeEventListener("abort", abort); flight = undefined;
        queueMicrotask(pump);
      }
    })();
  };
  const drain = async () => {
    while (!controller.signal.aborted && !retry.isPaused && (flight || retry.active || scheduler.pendingCount)) { pump(); await wait(10); }
  };
  try {
    await runtime.start(); speechRunId = await runtime.allocateSpeechRunId();
    emit("run.started", { mode: options.mode, speed: options.mode === "realtime" ? 1 : null, injectionBoundary: "closed-canonical-span / production-checkpoint-builder" });
    for (const segment of options.segments) {
      if (options.mode === "realtime") {
        const due = segment.availableAtMs - options.timelineOriginMs;
        while (!controller.signal.aborted && elapsed() < due) await wait(Math.min(due - elapsed(), options.maxRuntimeMs));
      }
      if (controller.signal.aborted) break;
      const arrivedAt = elapsed();
      const checkpoint = await runtime.commitClosedSpan({ id: segment.segmentId, revision: 1, sourceFinalIds: segment.originalSegmentIds, text: segment.text, words: [], startMs: segment.startMs, endMs: segment.endMs, openedAtMs: Date.now(), updatedAtMs: Date.now(), status: "closed", closeReason: "explicit_stop" }, speechRunId);
      delivered++;
      if (checkpoint) {
        arrivals.set(checkpoint.checkpointId, { segment, runTimeMs: arrivedAt }); scheduler.enqueue([checkpoint]);
        emit("evidence.arrived", { segment, sourceTimeMs: segment.endMs, evidenceAvailableAtMs: segment.availableAtMs, arrivalTimeMs: arrivedAt, scheduledRunTimeMs: segment.availableAtMs - options.timelineOriginMs, arrivedEvidenceIds: [checkpoint.checkpointId], checkpoint }); pump();
      } else { skipped++; emit("input.skipped", { segment, reason: "production-checkpoint-builder-returned-no-evidence" }); }
      if (options.mode === "sequential") { await drain(); if (retry.isPaused) break; }
    }
    await drain();
    if (!controller.signal.aborted && retry.isPaused) status = "paused";
    if (flight) await flight;
    if (status === "completed" && delivered === options.segments.length && !runtime.pending.length) await runtime.end();
  } catch (error) {
    stop("error"); emit("run.error", { reason: error instanceof Error ? error.message : String(error) });
    if (flight) await flight;
  } finally {
    clearTimeout(cap); retry.clear(); options.signal?.removeEventListener("abort", cancel);
  }
  const replayMatches = canonicalJson(replayLessonEvents(events).state) === canonicalJson(runtime.state);
  const result: ReplayResult = { status, attempts, delivered, skipped, remainingInput: options.segments.slice(delivered), pendingEvidenceIds: runtime.pending.map(c => c.checkpointId), state: runtime.state, replayMatches, durationMs: elapsed(), lessonEvents: events };
  emit("run.finished", { ...result, lessonEvents: undefined }); runtime.close();
  return result;
}
