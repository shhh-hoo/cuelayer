import PQueue from "p-queue";
import pRetry from "p-retry";
import {
  emptyReplay,
  isCurrent,
  fold,
  same,
  version,
  type Evidence,
  type Event,
  type ProjectionIntent,
  type Replay,
  type Task,
} from "./contract";
import { captureLive, DEFAULT_BUDGET, bytes } from "./projection";
import { captureStage, validateStage, reviewCandidates } from "./stage";
import { position, recorded, rangeSize, sourcePieces } from "./source";
import { validate, Rejection } from "./acceptance";
import { decisionEventPayload } from "./acceptance-event";
import { EventStore } from "./adapters/storage";
import { Trace } from "./adapters/trace";
import { SpeechEvidenceAdapter } from "./adapters/speech";

import { TransientFailure, type Interpreter } from "./execution";
export { TransientFailure, type Interpreter } from "./execution";
export type WorkingWindow = {
  orderedCommittedEvidence: string[];
  preflight: unknown;
  consumedEvidenceIds: string[];
  unresolved: Replay["unresolved"];
  semanticVersion: number;
  activeLive: Task | null;
  activeStage: Task | null;
  stageReviewCoverage: string[];
  capturedDependencies: Record<string, number>[];
  pendingReconciliationObligations: string[];
  livePendingCount: number;
  oldestPendingAge: number;
  stagePendingAge: number;
  unresolvedMeaningAge: number;
  recordedFrontier: Replay["recorded"];
  accountedFrontier: Replay["accounted"];
  unaccountedChars: number;
  carryChars: number;
  openTailAge: number;
  status: "READY" | "WAITING" | "LAGGING" | "INTERPRETATION_PAUSED" | "SEALED";
  repeatedWaitSuppressions: number;
  recordedCharsPerSecond: number;
  accountedCharsPerSecond: number;
};
export class Session {
  private value = emptyReplay();
  private live = new PQueue({ concurrency: 1 });
  private stage = new PQueue({ concurrency: 1 });
  private writer = new PQueue({ concurrency: 1 });
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stageTimer: ReturnType<typeof setTimeout> | undefined;
  private stageYielded = false;
  private lifetime = new AbortController();
  private tasks: { Live: Task | null; Stage: Task | null } = {
    Live: null,
    Stage: null,
  };
  private failedStage = new Set<string>();
  private userPaused = false;
  private captures = new Map<string, Task>();
  private captureCounter = 0;
  private salt = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_");
  private suppressed = 0;
  private failedKey: string | null = null;
  private attentionTimer: ReturnType<typeof setTimeout> | undefined;
  private retryClaiming = false;
  private startedAt = performance.now();
  private initialRecordedChars = 0;
  private initialAccountedChars = 0;
  private epoch = 0;
  private admissionTimes = new Map<string, number>();
  private currentSourceEvidence = new Set<string>();
  private obligationTimes = new Map<string, number>();
  private admissionGap: Omit<Evidence, "sequence"> | null = null;
  private paused = false;
  private disposed = false;
  error: string | null = null;
  attention: ProjectionIntent | null = null;
  // Accepted Cue meaning survives replay; its presentation invitation does not.
  cuePresentation: {
    version: number;
    mainlineVersion: number;
    targets: Record<string, number>;
  } | null = null;
  readonly trace = new Trace();
  readonly speech: SpeechEvidenceAdapter;
  constructor(
    readonly id: string,
    readonly store: EventStore,
    private interpreter: Interpreter,
    readonly config = {
      coalesceMs: 250,
      deadlineMs: 8000,
      maxWaitMs: 750,
      sourceChars: 2400,
      maxRequestBytes: 28000,
    },
  ) {
    this.speech = new SpeechEvidenceAdapter(`run:${crypto.randomUUID()}`, (e) =>
      this.commitEvidence(e),
    );
    this.live.on("idle", () => this.schedule());
    this.stage.on("idle", () => this.scheduleStage());
  }
  static async open(
    id: string,
    interpreter: Interpreter,
    store = new EventStore(),
    config?: Session["config"],
  ) {
    const session = new Session(id, store, interpreter, config);
    for (const event of await store.read(id)) {
      if (event.sessionId !== id) throw new Error("session-mismatch");
      session.value = fold(session.value, event);
      const restoredAt = performance.now() - Math.max(0, Date.now() - event.at);
      if (event.type === "evidence")
        session.admissionTimes.set(event.evidence.id, restoredAt);
      if (event.type === "accepted")
        for (const obligation of event.accepted.unresolved)
          session.obligationTimes.set(obligation.id, restoredAt);
    }
    if (
      session.value.eventVersion !== null &&
      session.value.eventVersion !== 3
    ) {
      session.paused = true;
      session.error = "legacy-session-read-only";
    }
    session.initialRecordedChars = position(
      session.value.evidence,
      session.value.recorded,
    );
    session.initialAccountedChars = position(
      session.value.evidence,
      session.value.accounted,
    );
    session.trace.mark("recovery", { evidence: session.value.evidence.length });
    session.schedule();
    session.scheduleStage();
    return session;
  }
  get readOnly() {
    return this.value.eventVersion !== null && this.value.eventVersion !== 3;
  }
  get replay() {
    return structuredClone(this.value);
  }
  get state() {
    return structuredClone(this.value.state);
  }
  get window(): WorkingWindow {
    const pending = this.pendingEvidence();
    const concerns = reviewCandidates(this.value);
    const obligations = Object.values(this.value.unresolved),
      now = performance.now();
    return {
      orderedCommittedEvidence: this.value.evidence.map((e) => e.id),
      preflight: this.speech.preparation,
      consumedEvidenceIds: Object.keys(this.value.consumed),
      unresolved: structuredClone(this.value.unresolved),
      semanticVersion: this.value.state.revision,
      activeLive: structuredClone(this.tasks.Live),
      activeStage: structuredClone(this.tasks.Stage),
      stageReviewCoverage: Object.keys(this.value.reviewInspections),
      capturedDependencies: [this.tasks.Live, this.tasks.Stage].flatMap((t) =>
        t ? [{ ...t.dependencies }] : [],
      ),
      pendingReconciliationObligations: reviewCandidates(this.value).map(
        (o) => o.subjectId,
      ),
      recordedFrontier: this.value.recorded,
      accountedFrontier: this.value.accounted,
      unaccountedChars:
        position(this.value.evidence, this.value.recorded) -
        position(this.value.evidence, this.value.accounted),
      carryChars: obligations.reduce(
        (n, o) => n + (o.range ? rangeSize(this.value.evidence, o.range) : 0),
        0,
      ),
      openTailAge: pending.length
        ? Math.max(0, now - (this.admissionTimes.get(pending[0].id) ?? now))
        : 0,
      status: this.value.ended
        ? "SEALED"
        : this.userPaused || this.paused
          ? "INTERPRETATION_PAUSED"
          : pending.length &&
              now - (this.admissionTimes.get(pending[0].id) ?? now) > 4000
            ? "LAGGING"
            : pending.length
              ? "WAITING"
              : "READY",
      repeatedWaitSuppressions: this.suppressed,
      recordedCharsPerSecond:
        (position(this.value.evidence, this.value.recorded) -
          this.initialRecordedChars) /
        Math.max(0.001, (now - this.startedAt) / 1000),
      accountedCharsPerSecond:
        (position(this.value.evidence, this.value.accounted) -
          this.initialAccountedChars) /
        Math.max(0.001, (now - this.startedAt) / 1000),
      livePendingCount: pending.length,
      oldestPendingAge: pending.length
        ? Math.max(0, now - (this.admissionTimes.get(pending[0].id) ?? now))
        : 0,
      stagePendingAge: Math.max(
        0,
        now -
          Math.min(
            this.tasks.Stage?.createdAt ?? now,
            ...concerns.map((c) => now - Math.max(0, Date.now() - c.createdAt)),
          ),
      ),
      unresolvedMeaningAge: obligations.length
        ? Math.max(
            0,
            now -
              Math.min(
                ...obligations.map(
                  (o) => this.obligationTimes.get(o.id) ?? now,
                ),
              ),
          )
        : 0,
    };
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Publication is already durable. */
      }
    }
  }
  private async append(
    payload: Event extends infer E
      ? E extends Event
        ? Omit<E, "schema" | "sessionId" | "id" | "sequence" | "at">
        : never
      : never,
  ) {
    if (this.value.eventVersion !== null && this.value.eventVersion !== 3)
      throw new Error("legacy-session-read-only");
    const sequence = this.value.sequence + 1;
    const event: Event = {
      ...payload,
      schema: "cuelayer-v2-event-3",
      sessionId: this.id,
      id: `${this.id}:${sequence}`,
      sequence,
      at: Date.now(),
    };
    const next = fold(this.value, event),
      start = performance.now();
    try {
      await this.store.append(event, this.value.sequence);
    } catch (error) {
      // An acknowledgement lost AFTER durable commit must not cause a second consumption.
      const durable = await this.store.events.get(event.id);
      if (!same(durable, event)) throw error;
    }
    this.value = next;
    if (event.type === "evidence")
      this.admissionTimes.set(event.evidence.id, performance.now());
    if (event.type === "accepted")
      for (const obligation of event.accepted.unresolved)
        this.obligationTimes.set(obligation.id, performance.now());
    this.trace.mark(
      "persistence",
      {
        eventId: event.id,
        type: event.type,
        ...(event.type === "accepted"
          ? {
              taskId: event.accepted.taskId,
              lane: event.accepted.lane,
              revision: next.state.revision,
            }
          : {}),
        ...(event.type === "evidence" ? { evidenceId: event.evidence.id } : {}),
      },
      start,
    );
    if (event.type === "evidence")
      this.trace.mark("evidence-admitted", {
        evidenceId: event.evidence.id,
        sequence: event.evidence.sequence,
      });
    if (event.type === "evidence")
      this.trace.mark("recorded-frontier", {
        R: next.recorded,
        chars: position(next.evidence, next.recorded),
      });
    if (event.type === "accepted" && event.accepted.processing)
      this.trace.mark("accounted-frontier", {
        A: next.accounted,
        chars: position(next.evidence, next.accounted),
        groups: event.accepted.processing.groups,
        taskId: event.accepted.taskId,
      });
    this.notify();
  }
  private pendingEvidence() {
    const at = position(this.value.evidence, this.value.accounted);
    return this.value.evidence.filter(
      (e) =>
        position(this.value.evidence, {
          evidenceId: e.id,
          sequence: e.sequence,
          offset: e.text.length,
        }) > at,
    );
  }
  async commitEvidence(raw: Omit<Evidence, "sequence">) {
    const captured = structuredClone(raw);
    this.trace.mark(
      "evidence-received",
      { evidenceId: captured.id, run: captured.run },
      captured.receivedAt,
    );
    if (captured.audioObservedAt !== null)
      this.trace.mark(
        "audio-to-final",
        { evidenceId: captured.id },
        captured.audioObservedAt,
        undefined,
        captured.receivedAt,
      );
    await this.writer.add(async () => {
      if (this.disposed || this.value.ended) throw new Error("session-closed");
      if (this.admissionGap && this.admissionGap.id !== captured.id)
        throw new Error("evidence-frontier-blocked");
      if (this.admissionGap) {
        const {
          receivedAt: _time,
          audioObservedAt: _audio,
          ...original
        } = this.admissionGap;
        const {
          receivedAt: _time2,
          audioObservedAt: _audio2,
          ...retry
        } = captured;
        if (!same(original, retry))
          throw new Error("evidence-identity-collision");
      }
      const existing = this.value.evidence.find((e) => e.id === captured.id);
      if (existing) {
        const {
          receivedAt: _r,
          audioObservedAt: _a,
          sequence: _s,
          ...old
        } = existing;
        const { receivedAt: _r2, audioObservedAt: _a2, ...fresh } = captured;
        if (!same(old, fresh)) throw new Error("evidence-identity-collision");
        return;
      }
      try {
        await this.append({
          type: "evidence",
          evidence: { ...captured, sequence: this.value.evidence.length + 1 },
        });
        this.admissionGap = null;
        this.currentSourceEvidence.add(captured.id);
        this.trace.mark("live-eligible", {
          evidenceId: captured.id,
          quietEligibleAt: performance.now() + this.config.coalesceMs,
          independentMaxWaitMs: this.config.maxWaitMs,
          liveOccupied: Boolean(this.live.pending),
          estimate: true,
        });
      } catch (error) {
        this.admissionGap = captured;
        throw error;
      }
      this.trace.mark(
        "final-to-window",
        { evidenceId: captured.id },
        captured.receivedAt,
      );
    });
    this.schedule();
  }
  capture(
    lane: Task["lane"],
    _evidence?: Evidence[],
    coreIds?: string[],
  ): Task {
    if (lane === "Stage") {
      const task = captureStage(
        this.value,
        this.id,
        `${this.salt}${(++this.captureCounter).toString(36)}`,
        this.epoch,
      );
      if (!task) throw new Rejection("no-eligible-stage-review");
      this.captures.set(task.id, structuredClone(task));
      return task;
    }
    const task = captureLive(
      this.value,
      this.id,
      `${this.salt}${(++this.captureCounter).toString(36)}`,
      this.epoch,
      {
        ...DEFAULT_BUDGET,
        sourceChars: this.config.sourceChars,
        maxRequestBytes: this.config.maxRequestBytes,
      },
      coreIds,
    );
    this.captures.set(task.id, structuredClone(task));
    return task;
  }
  private schedule() {
    if (
      this.disposed ||
      this.userPaused ||
      (this.value.eventVersion !== null && this.value.eventVersion !== 3) ||
      this.value.ended ||
      this.live.pending ||
      this.live.size
    )
      return;
    const pending = this.pendingEvidence();
    if (!pending.length) return;
    if (this.timer) clearTimeout(this.timer);
    // Quiet coalescing and independent oldest-item deadline are domain policy.
    const eligible = Math.min(
      (this.admissionTimes.get(pending.at(-1)!.id) ?? performance.now()) +
        this.config.coalesceMs,
      (this.admissionTimes.get(pending[0].id) ?? performance.now()) +
        this.config.maxWaitMs,
    );
    const wait = Math.max(0, eligible - performance.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.dispatchLive();
    }, wait);
  }
  private dispatchLive() {
    if (
      this.disposed ||
      this.userPaused ||
      (this.value.eventVersion !== null && this.value.eventVersion !== 3) ||
      this.live.pending ||
      this.live.size
    )
      return;
    if (!this.pendingEvidence().length) return;
    try {
      const task = this.capture("Live");
      const failure = this.value.attempts[task.inspectionKey!];
      this.paused = false;
      this.failedKey = null;
      if (
        !this.value.inspections[task.inspectionKey!] &&
        (failure?.outcome === "FAILED" ||
          (failure?.outcome === "STARTED" && failure.manual))
      ) {
        this.paused = true;
        this.failedKey = task.inspectionKey!;
        this.error = failure.reason ?? "retry-interrupted";
      } else this.error = null;
      if (
        this.value.inspections[task.inspectionKey!] ||
        task.inspectionKey === this.failedKey
      ) {
        if (
          this.value.inspections[task.inspectionKey!] === "WAIT_MORE_INPUT" &&
          (task.capture!.request.omitted.sourceAfter ||
            task.capture!.inspectionContext?.query)
        ) {
          this.paused = true;
          this.error = "context-blocked:inspected-context-exhausted";
        }
        if (this.value.inspections[task.inspectionKey!] === "OUTPUT_CAPACITY") {
          this.paused = true;
          this.error = "output-capacity-zero-progress";
        }
        this.captures.delete(task.id);
        this.suppressed++;
        this.notify();
        this.trace.mark("identical-inspection-suppressed", {
          inspectionKey: task.inspectionKey,
          reason: this.value.inspections[task.inspectionKey!] ?? "failure",
        });
        return;
      }
      if (failure?.outcome === "FAILED")
        this.trace.mark("newer-snapshot-after-failure", { taskId: task.id });
      this.enqueue(task, this.live);
    } catch (error) {
      this.error = String(error);
      this.paused = true;
      this.trace.mark("context-blocked", { reason: this.error });
      this.notify();
    }
  }
  private clearStageYield() {
    if (this.stageTimer) clearTimeout(this.stageTimer);
    this.stageTimer = undefined;
    this.stageYielded = false;
  }
  private scheduleStage() {
    if (
      this.disposed ||
      this.userPaused ||
      this.value.ended ||
      this.value.captureClosed ||
      this.stage.pending ||
      this.stage.size
    )
      return;
    for (const item of reviewCandidates(this.value)) {
      try {
        const task = captureStage(
          this.value,
          this.id,
          `${this.salt}${(++this.captureCounter).toString(36)}`,
          this.epoch,
          item.subjectId,
        );
        if (!task || this.failedStage.has(task.inspectionKey!)) continue;
        const oldest = this.pendingEvidence()[0],
          now = performance.now();
        const liveUnderPressure =
          !this.paused &&
          oldest &&
          now - (this.admissionTimes.get(oldest.id) ?? now) > 4000;
        // Yield new reconciliation admission once to lagging Live, never indefinitely.
        // Time only controls lane priority; it cannot account or change source meaning.
        if (liveUnderPressure && !this.stageYielded) {
          this.stageYielded = true;
          this.stageTimer = setTimeout(() => {
            this.stageTimer = undefined;
            this.scheduleStage();
          }, 1000);
          this.trace.mark("stage-deferred-for-live", {
            policy: "v2-stage-pressure-policy-1",
            maxDelayMs: 1000,
            subjectId: item.subjectId,
          });
          return;
        }
        if (liveUnderPressure && this.stageTimer) return;
        this.clearStageYield();
        this.captures.set(task.id, structuredClone(task));
        this.enqueue(task, this.stage);
        return;
      } catch (error) {
        this.trace.mark("stage-context-blocked", {
          subjectId: item.subjectId,
          reason: String(error),
        });
      }
    }
  }

  private enqueue(task: Task, queue: PQueue) {
    const queuedAt = performance.now();
    this.trace.mark("work-created", {
      taskId: task.id,
      lane: task.lane,
      dependencies: task.dependencies,
      evidenceIds: task.evidence.map((e) => e.id),
      range: task.capture?.range,
      requestBytes: task.capture ? bytes(task.capture.request) : 0,
      sourceChars: task.capture
        ? rangeSize(this.value.evidence, task.capture.range)
        : 0,
    });
    if (task.lane === "Live")
      for (const evidence of task.evidence) {
        if (this.currentSourceEvidence.has(evidence.id))
          this.trace.mark(
            "final-to-live-dispatch",
            { taskId: task.id, evidenceId: evidence.id },
            evidence.receivedAt,
          );
        this.trace.mark(
          "evidence-to-live-queued",
          { taskId: task.id, evidenceId: evidence.id },
          this.admissionTimes.get(evidence.id) ?? queuedAt,
        );
      }
    void queue
      .add(async () => {
        this.tasks[task.lane] = task;
        this.notify();
        const parent = this.trace.mark(
          "queue-wait",
          { taskId: task.id, lane: task.lane },
          queuedAt,
        );
        const started = performance.now();
        let attempt = 0;
        let phase: "transport" | "semantic" = "transport";
        this.trace.mark("inference-start", {
          taskId: task.id,
          lane: task.lane,
        });
        const deadline = new AbortController();
        const deadlineTimer = setTimeout(
          () =>
            deadline.abort(
              new DOMException("Live/Stage deadline exceeded", "TimeoutError"),
            ),
          this.config.deadlineMs,
        );
        const signal = AbortSignal.any([this.lifetime.signal, deadline.signal]);
        try {
          if (task.lane === "Live")
            await this.writer.add(async () => {
              const current = this.value.attempts[task.inspectionKey!];
              if (current?.id !== task.id)
                await this.append({
                  type: "live-attempt",
                  inspectionKey: task.inspectionKey!,
                  attempt: {
                    id: task.id,
                    outcome: "STARTED",
                    manual: false,
                    reason: null,
                  },
                });
            });
          const raw = await pRetry(
            () => {
              const attemptStart = performance.now();
              this.trace.mark("inference-attempt", {
                taskId: task.id,
                lane: task.lane,
                attempt: ++attempt,
              });
              let first = false;
              return this.interpreter(structuredClone(task), signal, () => {
                if (first) return;
                first = true;
                this.trace.mark(
                  "first-provider-byte",
                  { taskId: task.id, lane: task.lane, attempt },
                  attemptStart,
                  parent,
                );
              });
            },
            {
              retries: 2,
              minTimeout: 20,
              factor: 2,
              signal,
              shouldRetry: ({ error }) => error instanceof TransientFailure,
            },
          );
          signal.throwIfAborted();
          this.trace.mark(
            "proposal-complete",
            { taskId: task.id, lane: task.lane },
            started,
            parent,
          );
          phase = "semantic";
          await this.accept(task, raw, signal);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.trace.mark("proposal-rejected", {
            taskId: task.id,
            lane: task.lane,
            reason,
          });
          const stale =
            reason.startsWith("stale-dependency") ||
            reason === "stale-generation";
          if (task.lane === "Stage") {
            if (!stale) this.failedStage.add(task.inspectionKey!);
          } else if (!this.disposed) {
            await this.writer.add(async () => {
              if (this.value.acceptedTaskIds.includes(task.id)) return;
              const attempt = this.value.attempts[task.inspectionKey!];
              if (attempt?.id === task.id)
                await this.append({
                  type: "live-attempt",
                  inspectionKey: task.inspectionKey!,
                  attempt: {
                    ...attempt,
                    outcome: "FAILED",
                    reason,
                    category: stale ? "stale" : phase,
                  },
                });
            });
            this.error = reason;
            this.failedKey = task.inspectionKey ?? null;
            this.paused = false; // Recompute eligibility after this slot becomes idle.
            this.trace.mark("live-snapshot-failed", {
              taskId: task.id,
              reason,
              category: stale ? "stale" : phase,
            });
          }
        } finally {
          clearTimeout(deadlineTimer);
          this.tasks[task.lane] = null;
          this.captures.delete(task.id);
          const window = this.window;
          this.trace.mark("pending", {
            livePendingCount: window.livePendingCount,
            oldestPendingAge: window.oldestPendingAge,
            stagePendingAge: window.stagePendingAge,
            unaccountedChars: window.unaccountedChars,
            carryChars: window.carryChars,
            openTailAge: window.openTailAge,
            unresolvedMeaningAge: window.unresolvedMeaningAge,
            status: window.status,
            recordedCharsPerSecond: window.recordedCharsPerSecond,
            accountedCharsPerSecond: window.accountedCharsPerSecond,
          });
          this.notify();
          this.schedule();
          this.scheduleStage();
        }
      })
      .catch((error) => {
        this.error = String(error);
        this.notify();
      });
  }
  async accept(task: Task, raw: unknown, signal?: AbortSignal) {
    const proposalAt = performance.now();
    return this.writer.add(async () => {
      if (this.disposed) throw new Rejection("session-closed");
      if (this.value.acceptedTaskIds.includes(task.id)) return;
      signal?.throwIfAborted();
      const start = performance.now();
      this.trace.mark("semantic-validation-start", {
        taskId: task.id,
        lane: task.lane,
      });
      const captured = this.captures.get(task.id);
      if (!captured || !same(captured, task) || task.sessionId !== this.id)
        throw new Rejection("task-binding");
      const result =
        task.lane === "Live"
          ? validate(this.value, captured, raw)
          : validateStage(this.value, captured, raw);
      const { proposal, accepted } = result;
      const decision = "decision" in result ? result.decision : null;
      this.trace.mark(
        "semantic-validation",
        { taskId: task.id, lane: task.lane },
        start,
      );
      if (decision && !decision.groups.length) {
        await this.append(decisionEventPayload(task, result));
        this.trace.mark(
          decision.suffixStatus === "WAIT_MORE_INPUT"
            ? "live-wait"
            : "output-capacity-blocked",
          { taskId: task.id },
        );
        if (decision.suffixStatus === "OUTPUT_CAPACITY") {
          this.error = "output-capacity-zero-progress";
          this.paused = true;
          this.failedKey = task.inspectionKey!;
        }
        this.notify();
        return;
      }
      await this.append(decisionEventPayload(task, result));
      if (task.lane === "Live") {
        this.error = null;
        this.paused = false;
        this.failedKey = null;
      }
      if (
        task.lane === "Stage" &&
        this.failedKey &&
        !this.userPaused &&
        this.pendingEvidence().length
      ) {
        try {
          const refreshed = captureLive(
            this.value,
            this.id,
            "eligibility",
            this.epoch,
            {
              ...DEFAULT_BUDGET,
              sourceChars: this.config.sourceChars,
              maxRequestBytes: this.config.maxRequestBytes,
            },
          );
          if (refreshed.inspectionKey !== this.failedKey) {
            this.paused = false;
            this.failedKey = null;
            this.error = null;
          }
        } catch {
          /* Still context blocked. */
        }
      }
      if (
        decision?.suffixStatus === "WAIT_MORE_INPUT" &&
        !decision.contextRequest &&
        this.pendingEvidence().length &&
        position(this.value.evidence, this.value.recorded) ===
          position(this.value.evidence, task.capture!.range.end)
      ) {
        const tail = this.capture("Live");
        await this.append({
          type: "inspected",
          inspectionKey: tail.inspectionKey!,
          outcome: "WAIT_MORE_INPUT",
        });
        this.captures.delete(tail.id);
      }
      this.trace.mark(
        "proposal-to-accepted",
        { taskId: task.id, lane: task.lane },
        proposalAt,
      );
      this.trace.mark("semantic-accepted", {
        revision: this.value.state.revision,
        changed: accepted.operations.length > 0,
        attentionTargets: proposal.attention?.targets ?? [],
        taskId: task.id,
        lane: task.lane,
        consumed: accepted.dispositions.map((d) => d.evidenceId),
        sourceRanges: accepted.processing?.groups.map((g) => g.range) ?? [],
        changedUnits: accepted.operations
          .filter(
            (op): op is Extract<typeof op, { id: string }> =>
              "id" in op &&
              ["put", "revise", "revalidate", "invalidate"].includes(op.type),
          )
          .map((op) => op.id),
        carryCreated: accepted.unresolved.map((o) => o.id),
        carryResolved: accepted.resolved,
        accountedChars:
          accepted.processing?.groups.reduce(
            (n, g) => n + rangeSize(this.value.evidence, g.range),
            0,
          ) ?? 0,
        reviewKeys: accepted.reviews?.map((r) => r.key) ?? [],
      });
      if (
        this.cuePresentation &&
        (this.cuePresentation.version !== this.value.state.cueVersion ||
          this.cuePresentation.mainlineVersion !==
            this.value.state.mainlineVersion ||
          Object.entries(this.cuePresentation.targets).some(
            ([id, v]) =>
              !isCurrent(this.value.state, id) ||
              this.value.state.units[id].version !== v,
          ))
      ) {
        this.cuePresentation = null;
        this.trace.mark("cue-presentation-invalidated", { taskId: task.id });
      }
      if (task.lane === "Live") {
        if (
          accepted.operations.some((op) => op.type === "cue") &&
          this.value.state.cue
        ) {
          this.cuePresentation = {
            version: this.value.state.cueVersion,
            mainlineVersion: this.value.state.mainlineVersion,
            targets: Object.fromEntries(
              this.value.state.cue.targets.map((id) => [
                id,
                this.value.state.units[id].version,
              ]),
            ),
          };
          this.trace.mark("cue-presentation-published", { taskId: task.id });
        }
        let attentionOutcome = "no-attention-produced";
        if (proposal.attention) {
          const validTargets = proposal.attention.targets.every((id) =>
            isCurrent(this.value.state, id),
          );
          const sameTeaching =
            task.generation === this.value.generation &&
            (task.capture?.request.currentCore === null ||
              task.dependencies.mainline === this.value.state.mainlineVersion ||
              accepted.operations.some((op) => op.type === "mainline"));
          const newerSource =
            task.capture &&
            position(this.value.evidence, task.capture.range.end) <
              position(this.value.evidence, this.value.recorded);
          if (!validTargets || !sameTeaching)
            attentionOutcome = "attention-suppressed";
          else if (task.attentionEpoch !== this.epoch || newerSource)
            attentionOutcome = "attention-superseded";
          else if (performance.now() - task.createdAt >= 750)
            attentionOutcome = "attention-expired";
          else {
            this.attention = {
              ...proposal.attention,
              expiresAt: performance.now() + 750,
            };
            if (this.attentionTimer) clearTimeout(this.attentionTimer);
            this.attentionTimer = setTimeout(() => {
              this.attention = null;
              this.attentionTimer = undefined;
              this.trace.mark("attention-expired", { taskId: task.id });
              this.notify();
            }, 750);
            this.epoch++;
            attentionOutcome = "attention-published";
          }
        }
        this.trace.mark(attentionOutcome, { taskId: task.id, lane: task.lane });
      }
      this.trace.mark("accepted-publication", {
        taskId: task.id,
        lane: task.lane,
        revision: this.value.state.revision,
      });
      this.notify();
    });
  }
  pause() {
    this.clearStageYield();
    this.userPaused = true;
    this.paused = true;
    this.live.pause();
    this.stage.pause();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.notify();
  }
  resume() {
    this.userPaused = false;
    this.paused = false;
    if (!this.failedKey) this.error = null;
    this.live.start();
    this.stage.start();
    this.schedule();
    this.scheduleStage();
  }
  async retryFailedLive() {
    if (
      this.retryClaiming ||
      this.disposed ||
      this.userPaused ||
      this.live.pending ||
      this.live.size
    )
      return false;
    this.retryClaiming = true;
    try {
      const task = await this.writer.add(async () => {
        if (
          this.value.ended ||
          this.value.eventVersion !== 3 ||
          !this.pendingEvidence().length
        )
          return null;
        const t = this.capture("Live"),
          key = t.inspectionKey!,
          prior = this.value.attempts[key];
        if (
          !prior ||
          prior.outcome === "SUCCEEDED" ||
          this.value.inspections[key]
        ) {
          this.captures.delete(t.id);
          return null;
        }
        // An interrupted manual claim is settled before an explicit new claim. Reload alone never does this.
        if (prior.outcome === "STARTED")
          await this.append({
            type: "live-attempt",
            inspectionKey: key,
            attempt: {
              ...prior,
              outcome: "FAILED",
              reason: "retry-interrupted",
              category: "interrupted",
            },
          });
        await this.append({
          type: "live-attempt",
          inspectionKey: key,
          attempt: { id: t.id, outcome: "STARTED", manual: true, reason: null },
        });
        return t;
      });
      if (!task) return false;
      this.paused = false;
      this.failedKey = null;
      this.error = null;
      this.trace.mark("explicit-live-retry", { taskId: task.id });
      this.enqueue(task, this.live);
      return true;
    } finally {
      this.retryClaiming = false;
    }
  }
  async drainLive() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    while (this.pendingEvidence().length) {
      const before = position(this.value.evidence, this.value.accounted);
      if (this.userPaused) throw new Error("user-paused");
      this.dispatchLive();
      await this.live.onIdle();
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      if (before === position(this.value.evidence, this.value.accounted)) {
        if (this.paused) throw new Error(this.error ?? "paused");
        // No advancement can also mean an obsolete generation/dependency was
        // rejected. Only a successfully inspected CURRENT snapshot may stop
        // the drain; capture-close or new source must still get its own turn.
        const current = this.capture("Live");
        this.captures.delete(current.id);
        if (current.inspectionKey === this.failedKey)
          throw new Error(this.error ?? "failed-inspection");
        if (this.value.inspections[current.inspectionKey!]) return;
      }
    }
  }
  async finish() {
    this.clearStageYield();
    if (this.admissionGap) throw new Error("evidence-frontier-blocked");
    await this.writer.add(async () => {
      if (!this.value.captureClosed)
        await this.append({
          type: "capture-closed",
          generation: this.value.generation + 1,
        });
    });
    if (this.failedKey) {
      this.paused = false;
      this.failedKey = null;
    }
    await this.drainLive();
    if (this.pendingEvidence().length)
      throw new Error("final-drain-incomplete");
    await this.writer.add(() => this.append({ type: "ended" }));
    this.close();
  }
  close() {
    this.disposed = true;
    if (this.attentionTimer) clearTimeout(this.attentionTimer);
    this.pause();
    this.lifetime.abort();
    this.live.clear();
    this.stage.clear();
    this.listeners.clear();
    void this.trace.flush(this.store, this.id);
  }
}
