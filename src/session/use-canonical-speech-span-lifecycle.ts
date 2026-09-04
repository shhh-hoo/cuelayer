import { useEffect } from "react";
import { SPEECH_SPAN_ASSEMBLY } from "./canonical-speech";
import type { CanonicalSpeechState, SpeechRunId } from "./speech-types";
import type { SessionAction } from "./session-types";

type LifecycleInput = {
  canonicalSpeech: CanonicalSpeechState;
  speechRunId: SpeechRunId;
  dispatch(action: SessionAction): void;
};

/** Schedules only canonical lexical closure; interpretation remains closed-evidence-only. */
export function scheduleCanonicalSpeechSpanClosure({ canonicalSpeech, speechRunId, dispatch }: LifecycleInput) {
  const openSpan = [...canonicalSpeech.spans].reverse().find((span) => span.status === "open");
  if (!openSpan) return () => undefined;
  const { id: spanId, revision: spanRevision, updatedAtMs } = openSpan;
  const delay = Math.max(0, updatedAtMs + SPEECH_SPAN_ASSEMBLY.idleCloseMs - Date.now());
  const timer = globalThis.setTimeout(() => {
    dispatch({ type: "close-speech-span", runId: speechRunId, spanId, spanRevision, reason: "meaningful_pause", now: Date.now() });
  }, delay);
  return () => globalThis.clearTimeout(timer);
}

export function useCanonicalSpeechSpanLifecycle(input: LifecycleInput) {
  const { canonicalSpeech, speechRunId, dispatch } = input;
  const openSpan = [...canonicalSpeech.spans].reverse().find((span) => span.status === "open");
  useEffect(
    () => scheduleCanonicalSpeechSpanClosure(input),
    [dispatch, openSpan?.id, openSpan?.revision, openSpan?.updatedAtMs, speechRunId],
  );
}
