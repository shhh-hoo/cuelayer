export type MutableRef<T> = { current: T };

export class SpeechDrainIncompleteError extends Error {
  constructor(readonly runId: number, readonly cause: unknown) {
    super("Speechmatics drain completed without CueLayer observing EndOfTranscript.");
    this.name = "SpeechDrainIncompleteError";
  }
}

/**
 * A local EndOfTranscript observation is the lossless boundary: WebSocket
 * messages are ordered, so every preceding AddTranscript has already passed
 * through CueLayer's receiveMessage handler when this settles.
 */
export function createSpeechmaticsDrainBarrier(runId: number) {
  let observed = false;
  let resolve: (() => void) | undefined;
  const completed = new Promise<void>((next) => { resolve = next; });
  return {
    runId,
    get observed() { return observed; },
    observeEndOfTranscript() {
      if (observed) return;
      observed = true;
      resolve?.();
    },
    waitForEndOfTranscript: () => completed,
  };
}

export type SpeechmaticsDrainBarrier = ReturnType<typeof createSpeechmaticsDrainBarrier>;

/** Keeps a run addressable until the official client settles and CueLayer observes its terminal message. */
export async function drainSpeechmaticsStop({
  activeRunId,
  stopping,
  stopRecording,
  stopTranscription,
  barrier,
  finish,
  fail,
}: {
  activeRunId: MutableRef<number | null>;
  stopping: MutableRef<boolean>;
  stopRecording(): void;
  stopTranscription(): Promise<unknown>;
  barrier: SpeechmaticsDrainBarrier;
  finish(runId: number): void;
  fail(runId: number, error: SpeechDrainIncompleteError): void;
}) {
  const runId = activeRunId.current;
  if (runId === null) return;
  if (runId !== barrier.runId) throw new Error("Speechmatics drain run mismatch.");
  stopping.current = true;
  stopRecording();
  try {
    try {
      await stopTranscription();
    } catch (error) {
      // A client-side close error after the ordered terminal message is harmless:
      // the local observation has already proven all final transcripts arrived.
      if (!barrier.observed) throw new SpeechDrainIncompleteError(runId, error);
    }
    await barrier.waitForEndOfTranscript();
    if (activeRunId.current === runId) activeRunId.current = null;
    finish(runId);
  } catch (error) {
    const incomplete = error instanceof SpeechDrainIncompleteError
      ? error
      : new SpeechDrainIncompleteError(runId, error);
    if (activeRunId.current === runId) activeRunId.current = null;
    fail(runId, incomplete);
    throw incomplete;
  } finally {
    stopping.current = false;
  }
}
