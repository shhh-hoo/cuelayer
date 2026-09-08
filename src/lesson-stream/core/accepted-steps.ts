import { coreStepSchema } from "./contracts.ts";
import { coreAcceptedEvent } from "./events.ts";
import { appendCoreEvent, type CoreReplay } from "./replay.ts";

/** Pure candidate only. CoreLessonStreamRuntime owns storage, serialized writes
 * and publication; a successful return here is not a durable acceptance.
 */
export function acceptCoreStep(base: CoreReplay, input: unknown) {
  const step = coreStepSchema.parse(input);
  const event = coreAcceptedEvent(base.state.sessionId, (base.events.at(-1)?.sequence ?? 0) + 1, step);
  const replay = appendCoreEvent(base, event);
  return { event, replay };
}
