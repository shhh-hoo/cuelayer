import { coreStepSchema } from "./contracts.ts";
import { coreAcceptedEvent } from "./events.ts";
import { appendCoreEvent, type CoreReplay } from "./replay.ts";

/** Offline only. A successful return is a candidate, not a durably published runtime state.
 * Storage, serialization across concurrent writers and publication belong to M3.
 */
export function acceptCoreStep(base: CoreReplay, input: unknown) {
  const step = coreStepSchema.parse(input);
  const event = coreAcceptedEvent(base.state.sessionId, (base.events.at(-1)?.sequence ?? 0) + 1, step);
  const replay = appendCoreEvent(base, event);
  return { event, replay };
}
