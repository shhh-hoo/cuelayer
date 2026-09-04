import type { MutableRef } from "./speechmatics-stop-drain";
import type { SpeechRunId } from "./speech-types";

type SpeechRunState = { speech: { debug: { runId: SpeechRunId } } };

/** Resolves the active run at invocation, not at render time. */
export async function stopCurrentSpeechRun({
  stateRef,
  stopSpeechmatics,
  dispatchSession,
  now = Date.now,
}: {
  stateRef: MutableRef<SpeechRunState>;
  stopSpeechmatics(): Promise<void>;
  dispatchSession(action: { type: "speech-stopped"; runId: SpeechRunId; now: number }): void;
  now?: () => number;
}) {
  const runId = stateRef.current.speech.debug.runId;
  await stopSpeechmatics();
  dispatchSession({ type: "speech-stopped", runId, now: now() });
}
