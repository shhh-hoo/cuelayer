import PQueue from "p-queue";
import pRetry from "p-retry";
import {
  emptyReplay,
  fold,
  same,
  version,
  type Evidence,
  type Event,
  type ProjectionIntent,
  type Replay,
  type Task,
} from "./contract";
import { validate, Rejection } from "./acceptance";
import { EventStore } from "./adapters/storage";
import { Trace } from "./adapters/trace";
import { SpeechEvidenceAdapter } from "./adapters/speech";

export class TransientFailure extends Error {}
export type Interpreter = (
  task: Task,
  signal: AbortSignal,
  firstUseful: () => void,
) => Promise<unknown>;
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
};
export class Session {
  private value = emptyReplay();
  private live = new PQueue({ concurrency: 1 });
  private stage = new PQueue({ concurrency: 1 });
  private writer = new PQueue({ concurrency: 1 });
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lifetime = new AbortController();
  private tasks: { Live: Task | null; Stage: Task | null } = {
    Live: null,
    Stage: null,
  };
  private reviewedSnapshot = "";
  private epoch = 0;
  private admissionTimes = new Map<string, number>();
  private obligationTimes = new Map<string, number>();
  private admissionGap: Omit<Evidence, "sequence"> | null = null;
  private paused = false;
  private disposed = false;
  error: string | null = null;
  attention: ProjectionIntent | null = null;
  // Accepted Cue meaning survives replay; its presentation invitation does not.
  cuePresentation: { version: number; mainlineVersion: number } | null = null;
  readonly trace = new Trace();
  readonly speech: SpeechEvidenceAdapter;
  constructor(
    readonly id: string,
    readonly store: EventStore,
    private interpreter: Interpreter,
    readonly config = {
      coalesceMs: 25,
      maxBatch: 4,
      deadlineMs: 5000,
      maxWaitMs: 75,
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
    session.trace.mark("recovery", { evidence: session.value.evidence.length });
    session.schedule();
    session.scheduleStage();
    return session;
  }
  get replay() {
    return structuredClone(this.value);
  }
  get state() {
    return structuredClone(this.value.state);
  }
  get window(): WorkingWindow {
    const pending = this.value.evidence.filter(
      (e) => !this.value.consumed[e.id],
    );
    const unreviewed = this.value.evidence.find(
      (e) => this.value.consumed[e.id] && !this.value.reviewed.includes(e.id),
    );
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
      stageReviewCoverage: [...this.value.reviewed],
      capturedDependencies: [this.tasks.Live, this.tasks.Stage].flatMap((t) =>
        t ? [{ ...t.dependencies }] : [],
      ),
      pendingReconciliationObligations: obligations.map((o) => o.id),
      livePendingCount: pending.length,
      oldestPendingAge: pending.length
        ? Math.max(0, now - (this.admissionTimes.get(pending[0].id) ?? now))
        : 0,
      stagePendingAge: Math.max(
        0,
        now -
          Math.min(
            this.tasks.Stage?.createdAt ?? now,
            unreviewed ? (this.admissionTimes.get(unreviewed.id) ?? now) : now,
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
    payload:
      | { type: "evidence"; evidence: Evidence }
      | {
          type: "accepted";
          accepted: Extract<Event, { type: "accepted" }>["accepted"];
        }
      | { type: "ended" },
  ) {
    const sequence = this.value.sequence + 1;
    const event: Event = {
      ...payload,
      schema: "cuelayer-v2-event-1",
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
    this.trace.mark("persistence", { eventId: event.id }, start);
    this.notify();
  }
  async commitEvidence(raw: Omit<Evidence, "sequence">) {
    const captured = structuredClone(raw);
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
  capture(lane: Task["lane"], evidence: Evidence[], coreIds: string[]): Task {
    const state = this.state,
      dependencies: Record<string, number> = {};
    for (const id of coreIds) {
      dependencies[`core/${id}`] = version(state, `core/${id}`);
      dependencies[`members/${id}`] = version(state, `members/${id}`);
      for (const unit of state.cores[id]?.unitIds ?? [])
        dependencies[`unit/${unit}`] = version(state, `unit/${unit}`);
    }
    if (lane === "Live") {
      dependencies.mainline = state.mainlineVersion;
      dependencies.cue = state.cueVersion;
    } else {
      state.currentCoreId = null;
      state.mainlineVersion = 0;
      state.cue = null;
      state.cueVersion = 0;
    }
    state.cores = Object.fromEntries(
      Object.entries(state.cores).filter(([id]) => coreIds.includes(id)),
    );
    state.units = Object.fromEntries(
      Object.entries(state.units).filter(([, u]) => coreIds.includes(u.coreId)),
    );
    if (
      Object.keys(state.units).length > 64 ||
      JSON.stringify({ state, evidence }).length > 32000
    )
      throw new Rejection("context-budget-blocked");
    const id = JSON.stringify([
      this.id,
      lane,
      evidence.map((e) => e.id),
      dependencies,
    ]);
    return {
      id,
      lane,
      evidence: structuredClone(evidence),
      state,
      dependencies,
      allowedCores: coreIds,
      obligations: structuredClone(
        Object.values(this.value.unresolved).filter(
          (o) => !o.coreId || coreIds.includes(o.coreId),
        ),
      ),
      createdAt: performance.now(),
      attentionEpoch: this.epoch,
    };
  }
  private schedule() {
    if (
      this.disposed ||
      this.paused ||
      this.value.ended ||
      this.live.pending ||
      this.live.size
    )
      return;
    const pending = this.value.evidence.filter(
      (e) => !this.value.consumed[e.id],
    );
    if (!pending.length) return;
    if (this.timer) clearTimeout(this.timer);
    // Quiet coalescing and independent oldest-item deadline are domain policy.
    const eligible = Math.min(
      (this.admissionTimes.get(pending.at(-1)!.id) ?? performance.now()) +
        this.config.coalesceMs,
      (this.admissionTimes.get(pending[0].id) ?? performance.now()) +
        this.config.maxWaitMs,
    );
    const wait =
      pending.length >= this.config.maxBatch
        ? 0
        : Math.max(0, eligible - performance.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.dispatchLive();
    }, wait);
  }
  private dispatchLive() {
    if (this.disposed || this.paused || this.live.pending || this.live.size)
      return;
    const evidence = this.value.evidence
      .filter((e) => !this.value.consumed[e.id])
      .slice(0, this.config.maxBatch);
    if (!evidence.length) return;
    try {
      const task = this.capture(
        "Live",
        evidence,
        Object.keys(this.value.state.cores),
      );
      this.enqueue(task, this.live);
    } catch (error) {
      this.error = String(error);
      this.paused = true;
      this.notify();
    }
  }
  private scheduleStage() {
    if (
      this.disposed ||
      this.paused ||
      this.value.ended ||
      this.stage.pending ||
      this.stage.size
    )
      return;
    const obligations = Object.values(this.value.unresolved);
    if (!obligations.length) return;
    const processed = this.value.evidence.filter(
      (e) => this.value.consumed[e.id],
    );
    const unreviewed = processed.filter(
      (e) => !this.value.reviewed.includes(e.id),
    );
    const obligationIds = new Set(obligations.flatMap((o) => o.evidenceIds));
    // Oldest review gaps cannot be skipped by coalescing; exact recent context and unresolved sources accompany them.
    const evidence = [
      ...new Map(
        [
          ...unreviewed.slice(0, 32),
          ...processed.slice(-8),
          ...processed.filter((e) => obligationIds.has(e.id)),
        ].map((e) => [e.id, e]),
      ).values(),
    ].sort((a, b) => a.sequence - b.sequence);
    const key = JSON.stringify([
      evidence.map((e) => e.id),
      obligations.map((o) => o.id),
      this.value.state.revision,
    ]);
    if (key === this.reviewedSnapshot) return;
    this.reviewedSnapshot = key;
    const cores = [
      ...new Set(obligations.flatMap((o) => (o.coreId ? [o.coreId] : []))),
    ];
    try {
      this.enqueue(this.capture("Stage", evidence, cores), this.stage);
    } catch (error) {
      this.trace.mark("stage-context-blocked", { reason: String(error) });
      this.notify();
    }
  }
  private enqueue(task: Task, queue: PQueue) {
    const queuedAt = performance.now();
    this.trace.mark("work-created", {
      taskId: task.id,
      lane: task.lane,
      dependencies: task.dependencies,
      evidenceIds: task.evidence.map((e) => e.id),
    });
    if (task.lane === "Live")
      for (const evidence of task.evidence)
        this.trace.mark(
          "evidence-to-live-queued",
          { taskId: task.id, evidenceId: evidence.id },
          this.admissionTimes.get(evidence.id) ?? queuedAt,
        );
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
        this.trace.mark("inference-start", {
          taskId: task.id,
          lane: task.lane,
        });
        const signal = AbortSignal.any([
          this.lifetime.signal,
          AbortSignal.timeout(this.config.deadlineMs),
        ]);
        try {
          const raw = await pRetry(
            () =>
              this.interpreter(structuredClone(task), signal, () => {
                this.trace.mark(
                  "first-useful-output",
                  { taskId: task.id, lane: task.lane },
                  started,
                  parent,
                );
              }),
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
          await this.accept(task, raw, signal);
          if (task.lane === "Live") this.error = null;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.trace.mark("proposal-rejected", {
            taskId: task.id,
            lane: task.lane,
            reason,
          });
          if (reason.startsWith("stale-dependency")) {
            if (task.lane === "Stage") this.reviewedSnapshot = "";
          } else if (!this.disposed && task.lane === "Live") {
            this.error = reason;
            this.paused = true;
          }
        } finally {
          this.tasks[task.lane] = null;
          const window = this.window;
          this.trace.mark("pending", {
            livePendingCount: window.livePendingCount,
            oldestPendingAge: window.oldestPendingAge,
            stagePendingAge: window.stagePendingAge,
          });
          this.notify();
          this.scheduleStage();
        }
      })
      .catch((error) => {
        this.error = String(error);
        this.notify();
      });
  }
  async accept(task: Task, raw: unknown, signal?: AbortSignal) {
    return this.writer.add(async () => {
      if (this.disposed) throw new Rejection("session-closed");
      if (this.value.acceptedTaskIds.includes(task.id)) return;
      signal?.throwIfAborted();
      const start = performance.now(),
        { proposal, accepted } = validate(this.value, task, raw);
      this.trace.mark(
        "semantic-validation",
        { taskId: task.id, lane: task.lane },
        start,
      );
      await this.append({ type: "accepted", accepted });
      this.trace.mark("semantic-accepted", {
        revision: this.value.state.revision,
        changed: accepted.operations.length > 0,
        attentionTargets: proposal.attention?.targets ?? [],
        taskId: task.id,
        lane: task.lane,
        consumed: accepted.dispositions.map((d) => d.evidenceId),
      });
      if (
        proposal.attention &&
        task.attentionEpoch === this.epoch &&
        performance.now() - task.createdAt < 750
      ) {
        if (proposal.operations.some((op) => op.type === "cue"))
          this.cuePresentation = {
            version: this.state.cueVersion,
            mainlineVersion: this.state.mainlineVersion,
          };
        this.attention = {
          ...proposal.attention,
          expiresAt: performance.now() + 750,
        };
        this.epoch++;
      } else if (proposal.attention)
        this.trace.mark("attention-discarded", {
          taskId: task.id,
          lane: task.lane,
        });
      this.notify();
    });
  }
  pause() {
    this.paused = true;
    this.live.pause();
    this.stage.pause();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.notify();
  }
  resume() {
    this.paused = false;
    this.error = null;
    this.live.start();
    this.stage.start();
    this.schedule();
    this.scheduleStage();
  }
  async drainLive() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    while (this.value.evidence.some((e) => !this.value.consumed[e.id])) {
      if (this.paused) throw new Error(this.error ?? "paused");
      this.dispatchLive();
      await this.live.onIdle();
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
  async finish() {
    if (this.admissionGap) throw new Error("evidence-frontier-blocked");
    await this.drainLive();
    await this.writer.add(() => this.append({ type: "ended" }));
    this.close();
  }
  close() {
    this.disposed = true;
    this.pause();
    this.lifetime.abort();
    this.live.clear();
    this.stage.clear();
    this.listeners.clear();
    void this.trace.flush(this.store, this.id);
  }
}
