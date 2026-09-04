import type { CanonicalSpeechSpan } from "../session/speech-types";
import { checkpointFromClosedSpan } from "./evidence-checkpoints";
import { validateAndNormalizeProposal } from "./accepted-interpretations";
import { checkpointCommittedEvent, cueExpiredEvent, interpretationAcceptedEvent, lessonEndedEvent, lessonStartedEvent, speechRunAllocatedEvent } from "./events";
import { pendingEvidence, replayLessonEvents, type LessonReplay } from "./replay";
import { LocalLessonEventStore } from "./store";
import { reduceAcceptedStep } from "./teaching-state";
import type { AcceptedInterpretationStep, LessonEvent, TeachingInterpretationRequest, TeachingStateSnapshot } from "./contracts";
import type { SpeechRunId } from "../session/speech-types";

export type LessonEventStore = {
  append(events: readonly LessonEvent[]): Promise<void>;
  readSession(sessionId: string): Promise<LessonEvent[]>;
  close?(): void;
};

export type ProposalAcceptance =
  | { ok: true; steps: AcceptedInterpretationStep[]; transitions: Array<{ step: AcceptedInterpretationStep; stateBefore: TeachingStateSnapshot; stateAfter: TeachingStateSnapshot }>; boardConflict: boolean; cueConflict: boolean; stateBefore: TeachingStateSnapshot; stateAfter: TeachingStateSnapshot }
  | { ok: false; error: string };

export class LessonStreamRuntime {
  private writeChain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();

  private constructor(
    readonly sessionId: string,
    private readonly store: LessonEventStore,
    private replayValue: LessonReplay,
  ) {}

  static async open(sessionId: string, providedStore?: LessonEventStore) {
    const store = providedStore ?? await LocalLessonEventStore.open();
    const existing = await store.readSession(sessionId);
    return new LessonStreamRuntime(sessionId, store, replayLessonEvents(existing));
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  close() { this.store.close?.(); }
  get replay() { return this.replayValue; }
  get state() { return this.replayValue.state; }
  get events() { return this.replayValue.events; }
  get checkpoints() { return this.replayValue.checkpoints; }
  get pending() { return pendingEvidence(this.replayValue); }

  private serialize<T>(operation: () => Promise<T>) {
    const queued = this.writeChain.then(operation);
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

  private async appendNow(events: LessonEvent[]) {
    const replay = replayLessonEvents([...this.replayValue.events, ...events]);
    await this.store.append(events);
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
  }: {
    proposal: unknown;
    request: TeachingInterpretationRequest;
    model: string;
    isCurrent?: () => boolean;
  }): Promise<ProposalAcceptance> {
    return this.serialize(async () => {
      if (!isCurrent()) return { ok: false, error: "interpretation-stale-speech-run" };
      const stateBefore = this.replayValue.state;
      const validation = validateAndNormalizeProposal({ proposal, request, allCheckpoints: this.replayValue.checkpoints, state: stateBefore, model });
      if (!validation.ok) return validation;
      const checkpointSequences = new Map(this.replayValue.checkpoints.map((checkpoint) => [checkpoint.checkpointId, checkpoint.lessonSequence]));
      let rollingState = stateBefore;
      const transitions = validation.steps.map((step) => {
        const before = rollingState;
        rollingState = reduceAcceptedStep(rollingState, step, checkpointSequences);
        return { step, stateBefore: before, stateAfter: rollingState };
      });
      const firstSequence = this.nextEventSequence();
      const events = validation.steps.map((step, index) => interpretationAcceptedEvent(this.sessionId, firstSequence + index, step));
      await this.appendNow(events);
      return {
        ok: true,
        steps: validation.steps,
        transitions,
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
