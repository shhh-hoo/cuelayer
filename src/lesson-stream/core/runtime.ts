import { SessionIndexes } from "./session-indexes.ts";
import { liveDecisionSchema, type LiveDecision, type LiveProcessing } from "./session-processing.ts";
import type { CanonicalSpeechSpan, SpeechRunId } from "../../session/speech-types.ts";
import { checkpointFromClosedSpan } from "../evidence-checkpoints.ts";
import { LocalLessonEventStore } from "../store.ts";
import { CORE_EVENT_SCHEMA_VERSION, type CoreEvent } from "./contracts.ts";
import { coreEventSchema } from "./events.ts";
import type { CoreInterpretationBinding } from "./interpretation-context.ts";
import { acceptCoreInterpretation } from "./interpretation-validation.ts";
import { appendCoreEvent, pendingCoreEvidence, replayCoreEvents, type CoreReplay } from "./replay.ts";

export type CoreEventStore = {
  /** Atomic batch. Reject on failure/abort before commit; resolve only after durable commit. */
  append(events: readonly CoreEvent[], signal?: AbortSignal): Promise<void>;
  readSession(sessionId: string): Promise<CoreEvent[]>;
  close?(): void;
};
export type CoreAcceptance = ReturnType<typeof acceptCoreInterpretation>;

/** The only publication boundary for a live Core session. */
export class CoreLessonStreamRuntime {
  readonly domain = "core" as const;
  readonly indexes = new SessionIndexes();
  private closed = false;
  private lifetime = new AbortController();
  private writes: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();

  private constructor(readonly sessionId: string, private store: CoreEventStore, private value: CoreReplay) { this.indexes.sync(value); }

  static async open(sessionId: string, providedStore?: CoreEventStore) {
    const store = providedStore ?? await LocalLessonEventStore.open<CoreEvent>("core");
    try {
      const replay = replayCoreEvents(await store.readSession(sessionId), sessionId);
      if (replay.ended && pendingCoreEvidence(replay).length) throw new Error("core-ended-with-pending-evidence");
      if (replay.state.sessionId !== sessionId) throw new Error("core-session-mismatch");
      return new CoreLessonStreamRuntime(sessionId, store, replay);
    } catch (error) { store.close?.(); throw error; }
  }

  get replay() { return this.value; }
  get state() { return this.value.state; }
  get events() { return this.value.events; }
  get pending() { return pendingCoreEvidence(this.value); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  close() { this.closed = true; this.lifetime.abort("core-runtime-closed"); this.listeners.clear(); this.store.close?.(); }

  private serialize<T>(operation: () => Promise<T>) {
    const queued = this.writes.then(() => { this.lifetime.signal.throwIfAborted(); return operation(); });
    this.writes = queued.catch(() => undefined);
    return queued;
  }
  private envelope(type: CoreEvent["type"], timestamp = new Date().toISOString()) {
    const sequence = (this.events.at(-1)?.sequence ?? 0) + 1;
    return { type, schemaVersion: CORE_EVENT_SCHEMA_VERSION, sessionId: this.sessionId, sequence,
      eventId: JSON.stringify([this.sessionId, type, sequence]), timestamp };
  }
  private async appendNow(events: CoreEvent[], signal = this.lifetime.signal, candidate = events.reduce(appendCoreEvent, this.value)) {
    const combined = AbortSignal.any([this.lifetime.signal, signal]);
    combined.throwIfAborted();
    try { await this.store.append(events, combined); }
    catch (error) {
      // A transport/store may lose its acknowledgement AFTER atomic commit.
      // Only exact durable event identity/content proves success; never re-propose it.
      const durable = await this.store.readSession(this.sessionId);
      const byId = new Map(durable.map(event => [event.eventId, event]));
      if (!events.every(event => JSON.stringify(byId.get(event.eventId)) === JSON.stringify(event))) throw error;
    }
    // Commit is the linearization point. A late abort must not leave durable
    // events unpublished/unconsumed and cause a duplicate acceptance on retry.
    this.value = candidate;
    this.indexes.sync(candidate);
    if (!this.closed) for (const listener of this.listeners) {
      try { listener(); } catch { /* Observers cannot change a committed result. */ }
    }
  }
  start(timestamp?: string) {
    return this.serialize(async () => {
      if (!this.events.length) await this.appendNow([coreEventSchema.parse(this.envelope("lesson.started", timestamp))]);
    });
  }
  allocateSpeechRunId(randomUUID: () => string = () => globalThis.crypto.randomUUID()): Promise<SpeechRunId> {
    return this.serialize(async () => {
      if (!this.events.length) await this.appendNow([coreEventSchema.parse(this.envelope("lesson.started"))]);
      const runId = `speech-run-${randomUUID()}`;
      await this.appendNow([coreEventSchema.parse({ ...this.envelope("speech.run_allocated"), runId })]);
      return runId;
    });
  }
  commitClosedSpan(span: CanonicalSpeechSpan, speechRunId: SpeechRunId) {
    // Capture caller-owned evidence before queuing behind any outstanding write.
    const closed = structuredClone(span);
    return this.serialize(async () => {
      const result = checkpointFromClosedSpan(closed, speechRunId, this.value.checkpoints.length + 1);
      if (!result) return undefined;
      const existing = this.indexes.checkpoints.get(result.checkpoint.checkpointId);
      if (existing) {
        const candidate = { ...result.checkpoint, lessonSequence: existing.lessonSequence };
        if (JSON.stringify(candidate) !== JSON.stringify(existing)
          || JSON.stringify(result.grounding) !== JSON.stringify(this.value.grounding.get(existing.checkpointId))) throw new Error("core-checkpoint-identity-collision");
        return undefined;
      }
      await this.appendNow([coreEventSchema.parse({ ...this.envelope("evidence.checkpoint_committed"), ...result })]);
      return result.checkpoint;
    });
  }
  acceptProposal(binding: CoreInterpretationBinding, proposal: unknown, options: {
    processing?: LiveDecision;
    signal?: AbortSignal; isCurrent?: () => boolean; acceptedAt?: string;
    onValidated?: (result: CoreAcceptance) => void;
  } = {}): Promise<CoreAcceptance> {
    const input = structuredClone(proposal);
    const decision = options.processing && liveDecisionSchema.parse(options.processing);
    return this.serialize(async () => {
      options.signal?.throwIfAborted();
      if (options.isCurrent && !options.isCurrent()) throw new Error("core-stale-result");
      if (this.value.ended) throw new Error("core-lesson-ended");
      const result = acceptCoreInterpretation(binding, input, options.acceptedAt ?? new Date().toISOString(), this.value);
      if (result.kind === "NEEDS_CONTEXT") {
        try { options.onValidated?.(result); } catch { /* Diagnostic only. */ }
        return result;
      }
      if (options.isCurrent && !options.isCurrent()) throw new Error("core-stale-result");
      const deferred = new Map(decision?.deferred.map(item => [item.checkpointId, item]));
      if (deferred.size !== (decision?.deferred.length ?? 0) || [...deferred.keys()].some(id => !binding.newEvidenceIds.includes(id))) throw new Error("core-processing-deferred-invalid");
      const resolved = decision?.resolvedObligationIds ?? [];
      if (new Set(resolved).size !== resolved.length || resolved.some(id => !this.value.unresolved.has(id)
        || ![...binding.evidence.values()].some(c => c.checkpointId === id))) throw new Error("core-processing-resolution-unavailable");
      const steps = result.steps.map((step, index) => {
        const changed = result.replay.dispositions.get(step.consumesCheckpointIds[0]!)?.kind === "semantic_change";
        const liveProcessing: LiveProcessing = {
          version: "session-live-processing-v1", adapter: decision ? "explicit" : "legacy-propose",
          dispositions: step.consumesCheckpointIds.map(checkpointId => deferred.has(checkpointId)
            ? { ...deferred.get(checkpointId)!, kind: "deferred_unresolved" }
            : { checkpointId, kind: changed ? "semantic_change" : "resolved_no_change" }),
          resolvedObligationIds: index === result.steps.length - 1 ? resolved : [],
          ...(decision?.reviewRequired ? { review: { id: JSON.stringify([step.requestId, step.stepIndex, "STAGE"]), checkpointIds: step.consumesCheckpointIds, status: "incomplete" as const } } : {}),
        };
        return { ...step, liveProcessing };
      });
      const events = result.events.map((event, index) => coreEventSchema.parse({ ...event, step: steps[index] }));
      const candidate = events.reduce(appendCoreEvent, this.value);
      try { options.onValidated?.({ ...result, steps, events, replay: candidate }); } catch { /* Diagnostic only. */ }
      await this.appendNow(events, options.signal, candidate);
      return { ...result, steps, events, replay: this.value };
    });
  }
  expireCue(cueId: string, baseCueRevision: number, timestamp?: string) {
    return this.serialize(async () => {
      if (this.state.cue.active?.id !== cueId || this.state.cue.revision !== baseCueRevision) return false;
      await this.appendNow([coreEventSchema.parse({ ...this.envelope("teaching_cue.expired", timestamp), cueId, baseCueRevision })]);
      return true;
    });
  }
  end(timestamp?: string) {
    return this.serialize(async () => {
      if (this.value.ended) return;
      if (this.pending.length) throw new Error("core-lesson-pending-evidence");
      await this.appendNow([coreEventSchema.parse(this.envelope("lesson.ended", timestamp))]);
    });
  }
}
