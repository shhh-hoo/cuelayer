import type { CompactEvidenceCheckpoint } from "../contracts.ts";
import type { CoreEvent, CoreTeachingState } from "./contracts.ts";
import type { CoreReplay } from "./replay.ts";
import { createCoreTeachingState, reduceCoreStep } from "./teaching-state.ts";

/** Disposable append index. Event identity detects a different history/candidate branch.
 * Historical snapshots retain immutable channel values, never today's same-ID value. */
export class SessionIndexes {
  readonly checkpoints = new Map<string, CompactEvidenceCheckpoint>();
  readonly commits = new Map<string, Extract<CoreEvent, { type: "evidence.checkpoint_committed" }>>();
  readonly knowledge = new Map<number, CoreTeachingState>();
  readonly cue = new Map<number, CoreTeachingState>();
  readonly accepted: Extract<CoreEvent, { type: "core.step_accepted" }>[] = [];
  origins = new WeakMap<object, string[]>();
  private events: CoreEvent[] = [];
  private state?: CoreTeachingState;
  eventsVisited = 0;
  rebuilds = 0;
  sync(base: CoreReplay) {
    if (!this.state || this.state.sessionId !== base.state.sessionId || this.events.length > base.events.length
      || (this.events.length && this.events.at(-1) !== base.events[this.events.length - 1])) {
      this.checkpoints.clear(); this.commits.clear(); this.knowledge.clear(); this.cue.clear(); this.accepted.length = 0; this.origins = new WeakMap();
      this.events = []; this.state = createCoreTeachingState(base.state.sessionId); this.rebuilds++;
      this.knowledge.set(0, this.state); this.cue.set(0, this.state);
    }
    for (let i = this.events.length; i < base.events.length; i++) {
      const event = base.events[i]!; this.eventsVisited++;
      if (event.type === "evidence.checkpoint_committed") {
        this.checkpoints.set(event.checkpoint.checkpointId, event.checkpoint); this.commits.set(event.checkpoint.checkpointId, event);
      } else if (event.type === "core.step_accepted") {
        this.state = reduceCoreStep(this.state!, event.step, base.checkpoints);
        this.accepted.push(event);
      } else if (event.type === "teaching_cue.expired" && this.state!.cue.active?.id === event.cueId && this.state!.cue.revision === event.baseCueRevision) {
        this.state = { ...this.state!, cue: { revision: this.state!.cue.revision + 1 } };
      }
      this.knowledge.set(this.state!.knowledge.revision, this.state!); this.cue.set(this.state!.cue.revision, this.state!);
    }
    this.events = base.events;
    return this;
  }
}
