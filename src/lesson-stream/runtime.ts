import type { CanonicalSpeechSpan } from "../session/speech-types";
import { checkpointFromClosedSpan } from "./evidence-checkpoints";
import { checkpointCommittedEvent, cueExpiredEvent, interpretationAcceptedEvent, lessonEndedEvent, lessonStartedEvent } from "./events";
import { pendingEvidence, replayLessonEvents, type LessonReplay } from "./replay";
import { LocalLessonEventStore } from "./store";
import type { AcceptedInterpretationStep, LessonEvent } from "./contracts";

export type LessonEventStore = {
  append(events: readonly LessonEvent[]): Promise<void>;
  readSession(sessionId: string): Promise<LessonEvent[]>;
  close?(): void;
};

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

  async start(timestamp = new Date().toISOString()) {
    const operation = this.writeChain.then(async () => {
      if (this.replayValue.events.some((event) => event.type === "lesson.started")) return;
      await this.appendNow([lessonStartedEvent(this.sessionId, this.nextEventSequence(), timestamp)]);
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
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

  private append(events: LessonEvent[]) {
    const operation = this.writeChain.then(() => this.appendNow(events));
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }

  async commitClosedSpan(span: CanonicalSpeechSpan, speechRunId: number) {
    const operation = this.writeChain.then(async () => {
      if (!this.replayValue.events.some((event) => event.type === "lesson.started")) throw new Error("lesson-not-started");
      const alreadyCommitted = this.replayValue.events.some((event) => event.type === "evidence.checkpoint_committed" && event.grounding.canonicalSpanIds.some((item) => item.spanId === span.id));
      if (alreadyCommitted) return undefined;
      const result = checkpointFromClosedSpan(span, speechRunId, this.nextLessonSequence());
      if (!result) return undefined;
      const event = checkpointCommittedEvent(this.sessionId, this.nextEventSequence(), result.checkpoint, result.grounding);
      await this.appendNow([event]);
      return result.checkpoint;
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }

  async acceptSteps(steps: readonly AcceptedInterpretationStep[]) {
    const firstSequence = this.nextEventSequence();
    const events = steps.map((step, index) => interpretationAcceptedEvent(this.sessionId, firstSequence + index, step));
    await this.append(events);
  }

  async expireCue(cueId: string, baseCueRevision: number, timestamp = new Date().toISOString()) {
    if (this.state.cue.active?.id !== cueId || this.state.cue.revision !== baseCueRevision) return false;
    await this.append([cueExpiredEvent(this.sessionId, this.nextEventSequence(), cueId, baseCueRevision, timestamp)]);
    return true;
  }

  async end(timestamp = new Date().toISOString()) {
    const operation = this.writeChain.then(async () => {
      if (this.replayValue.ended || !this.replayValue.events.some((event) => event.type === "lesson.started")) return;
      await this.appendNow([lessonEndedEvent(this.sessionId, this.nextEventSequence(), timestamp)]);
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }
}
