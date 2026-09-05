import { buildTeachingInterpretationRequest } from "./context-projection.ts";
import type { LessonStreamRuntime } from "./runtime.ts";
import type { LosslessInterpretationScheduler } from "./pending-evidence.ts";
import type { SpeechRunId } from "../session/speech-types.ts";
import { MAX_PROJECTED_INPUT_TOKENS, OUTPUT_RESERVE_TOKENS, PROVIDER_ENVELOPE_RESERVE_TOKENS } from "./runtime-policy.ts";

/** Shared verbatim production batching/context budget; no replay-specific scheduler. */
export function nextTeachingRequest(runtime: LessonStreamRuntime, scheduler: LosslessInterpretationScheduler, speechRunId: SpeechRunId, sessionId: string, now = Date.now()) {
  const scheduled = scheduler.next(speechRunId, 3_500, now, (batch) => {
    const projected = buildTeachingInterpretationRequest({ requestId: "budget-preview", sessionId, events: runtime.events, currentState: runtime.state, newEvidence: batch });
    return projected.diagnostics.projectedInputTokens + PROVIDER_ENVELOPE_RESERVE_TOKENS + OUTPUT_RESERVE_TOKENS <= MAX_PROJECTED_INPUT_TOKENS;
  });
  if (!scheduled) return undefined;
  return { ...scheduled, ...buildTeachingInterpretationRequest({ requestId: scheduled.work.requestId, sessionId, events: runtime.events, currentState: runtime.state, newEvidence: scheduled.checkpoints }) };
}
