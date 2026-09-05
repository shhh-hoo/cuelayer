import type { CanonicalSpeechSpan } from "../session/speech-types.ts";
import { checkpointFromClosedSpan } from "./evidence-checkpoints.ts";
import { validateAndNormalizeProposal } from "./accepted-interpretations.ts";
import { checkpointCommittedEvent, cueExpiredEvent, interpretationAcceptedEvent, lessonEndedEvent, lessonStartedEvent, speechRunAllocatedEvent } from "./events.ts";
import { pendingEvidence, replayLessonEvents, type LessonReplay } from "./replay.ts";
import { LocalLessonEventStore } from "./store.ts";
import { reduceAcceptedStep } from "./teaching-state.ts";
import type { AcceptedInterpretationStep, LessonEvent, TeachingInterpretationRequest, TeachingStateSnapshot } from "./contracts.ts";
import type { SpeechRunId } from "../session/speech-types.ts";
import type { AlphaSemanticProfile } from "./semantic-profile.ts";

export type LessonEventStore = {
  append(events: readonly LessonEvent[], signal?: AbortSignal): Promise<void>;
  readSession(sessionId: string): Promise<LessonEvent[]>;
  close?(): void;
};

export type ProposalAcceptance =
  | { ok: true; steps: AcceptedInterpretationStep[]; transitions: Array<{ step: AcceptedInterpretationStep; lessonEvent: Extract<LessonEvent, { type: "interpretation.step_accepted" }>; lessonEventId: string; lessonEventSequence: number; stateBefore: TeachingStateSnapshot; stateAfter: TeachingStateSnapshot }>; boardConflict: boolean; cueConflict: boolean; stateBefore: TeachingStateSnapshot; stateAfter: TeachingStateSnapshot }
  | { ok: false; error: string; validationState: TeachingStateSnapshot };

export class LessonStreamRuntime {
  private closed = false;
  private lifetime = new AbortController();
  private writeChain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  readonly sessionId: string;
  private readonly store: LessonEventStore;
  private replayValue: LessonReplay;

  private constructor(
    sessionId: string,
    store: LessonEventStore,
    replayValue: LessonReplay,
  ) {
    this.sessionId = sessionId;
    this.store = store;
    this.replayValue = replayValue;
  }

  static async open(sessionId: string, providedStore?: LessonEventStore) {
    const store = providedStore ?? await LocalLessonEventStore.open();
    const existing = await store.readSession(sessionId);
    return new LessonStreamRuntime(sessionId, store, replayLessonEvents(existing));
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  close() { this.closed = true; this.lifetime.abort("lesson-runtime-closed"); this.listeners.clear(); this.store.close?.(); }
  get replay() { return this.replayValue; }
  get state() { return this.replayValue.state; }
  get events() { return this.replayValue.events; }
  get checkpoints() { return this.replayValue.checkpoints; }
  get pending() { return pendingEvidence(this.replayValue); }

  private serialize<T>(operation: () => Promise<T>) {
    const queued = this.writeChain.then(() => { if (this.closed) throw new Error("lesson-runtime-closed"); return operation(); });
    this.writeChain = queued.catch(() => undefined);
    return queued;
  }

  async start(timestamp = new Date().toISOString()) {
    return this.serialize(async () => {
      if (this.replayValue.events.some((event) => event.type === "lesson.started")) return;
      await this.appendNow([lessonStartedEvent(this.sessionId, this.nextEventSequence(), timestamp)]);
    });
  }

  /** Persisted before capture begins; IDs are never derived from component-local state. */
  async allocateSpeechRunId(randomUUID: () => string = () => globalThis.crypto.randomUUID()): Promise<SpeechRunId> {
    return this.serialize(async () => {
      if (this.replayValue.ended) throw new Error("lesson-already-ended");
      if (!this.replayValue.events.some((event) => event.type === "lesson.started")) {
        await this.appendNow([lessonStartedEvent(this.sessionId, this.nextEventSequence())]);
      }
      const runId = `speech-run-${randomUUID()}`;
      await this.appendNow([speechRunAllocatedEvent(this.sessionId, this.nextEventSequence(), runId)]);
      return runId;
    });
  }

  private nextEventSequence() {
    return Math.max(0, ...this.replayValue.events.map((event) => event.sequence)) + 1;
  }

  private nextLessonSequence() {
    return Math.max(0, ...this.replayValue.checkpoints.map((checkpoint) => checkpoint.lessonSequence)) + 1;
  }

  private async appendNow(events: LessonEvent[], attemptSignal?: AbortSignal) {
    const signal = attemptSignal ? AbortSignal.any([attemptSignal, this.lifetime.signal]) : this.lifetime.signal;
    signal.throwIfAborted();
    const replay = replayLessonEvents([...this.replayValue.events, ...events]);
    await this.store.append(events, signal);
    signal.throwIfAborted();
    this.replayValue = replay;
    this.listeners.forEach((listener) => listener());
  }

  async commitClosedSpan(span: CanonicalSpeechSpan, speechRunId: SpeechRunId) {
    return this.serialize(async () => {
      if (!this.replayValue.events.some((event) => event.type === "lesson.started")) throw new Error("lesson-not-started");
      const result = checkpointFromClosedSpan(span, speechRunId, this.nextLessonSequence());
      if (!result) return undefined;
      const alreadyCommitted = this.replayValue.checkpoints.some((checkpoint) => checkpoint.checkpointId === result.checkpoint.checkpointId);
      if (alreadyCommitted) return undefined;
      const event = checkpointCommittedEvent(this.sessionId, this.nextEventSequence(), result.checkpoint, result.grounding);
      await this.appendNow([event]);
      return result.checkpoint;
    });
  }

  async acceptSteps(steps: readonly AcceptedInterpretationStep[]) {
    return this.serialize(async () => {
      const firstSequence = this.nextEventSequence();
      const events = steps.map((step, index) => interpretationAcceptedEvent(this.sessionId, firstSequence + index, step));
      await this.appendNow(events);
    });
  }

  async acceptProposal({
    proposal,
    request,
    model,
    isCurrent = () => true,
    profile,
    signal,
  }: {
    proposal: unknown;
    request: TeachingInterpretationRequest;
    model: string;
    isCurrent?: () => boolean;
    profile?: AlphaSemanticProfile;
    signal?: AbortSignal;
  }): Promise<ProposalAcceptance> {
    return this.serialize(async () => {
      if (this.closed || request.sessionId !== this.sessionId || !isCurrent()) return { ok: false, error: "interpretation-stale-speech-run", validationState: this.replayValue.state };
      if (request.newEvidence.some((item, index) => this.pending[index]?.checkpointId !== item.checkpointId)) return { ok: false, error: "proposal-pending-prefix-mismatch", validationState: this.state };
      const stateBefore = this.replayValue.state;
      const validation = validateAndNormalizeProposal({ proposal, request, allCheckpoints: this.replayValue.checkpoints, state: stateBefore, model, profile });
      if (!validation.ok) return { ...validation, validationState: stateBefore };
      const checkpointSequences = new Map(this.replayValue.checkpoints.map((checkpoint) => [checkpoint.checkpointId, checkpoint.lessonSequence]));
      let rollingState = stateBefore;
      const stateTransitions = validation.steps.map((step) => {
        const before = rollingState;
        rollingState = reduceAcceptedStep(rollingState, step, checkpointSequences);
        return { step, stateBefore: before, stateAfter: rollingState };
      });
      const firstSequence = this.nextEventSequence();
      const events = validation.steps.map((step, index) => interpretationAcceptedEvent(this.sessionId, firstSequence + index, step) as Extract<LessonEvent, { type: "interpretation.step_accepted" }>);
      if (!isCurrent()) return { ok: false, error: "interpretation-stale-speech-run", validationState: this.state };
      await this.appendNow(events, signal);
      return {
        ok: true,
        steps: validation.steps,
        transitions: stateTransitions.map((transition, index) => ({ ...transition, lessonEvent: events[index]!, lessonEventId: events[index]!.eventId, lessonEventSequence: events[index]!.sequence })),
        boardConflict: validation.boardConflict,
        cueConflict: validation.cueConflict,
        stateBefore,
        stateAfter: this.replayValue.state,
      };
    });
  }

  async expireCue(cueId: string, baseCueRevision: number, timestamp = new Date().toISOString()) {
    return this.serialize(async () => {
      if (this.replayValue.state.cue.active?.id !== cueId || this.replayValue.state.cue.revision !== baseCueRevision) return false;
      await this.appendNow([cueExpiredEvent(this.sessionId, this.nextEventSequence(), cueId, baseCueRevision, timestamp)]);
      return true;
    });
  }

  async end(timestamp = new Date().toISOString()) {
    return this.serialize(async () => {
      if (this.replayValue.ended || !this.replayValue.events.some((event) => event.type === "lesson.started")) return;
      await this.appendNow([lessonEndedEvent(this.sessionId, this.nextEventSequence(), timestamp)]);
    });
  }
}
