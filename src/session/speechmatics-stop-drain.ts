export type MutableRef<T> = { current: T };

/** Keeps the run addressable while Speechmatics drains EndOfStream final transcripts. */
export async function drainSpeechmaticsStop({
  activeRunId,
  stopping,
  stopRecording,
  stopTranscription,
  finish,
}: {
  activeRunId: MutableRef<number | null>;
  stopping: MutableRef<boolean>;
  stopRecording(): void;
  stopTranscription(): Promise<unknown>;
  finish(runId: number): void;
}) {
  const runId = activeRunId.current;
  if (runId === null) return;
  stopping.current = true;
  stopRecording();
  try {
    await stopTranscription();
  } catch {
    // The official client may already have settled its socket after EndOfStream.
  } finally {
    if (activeRunId.current === runId) activeRunId.current = null;
    finish(runId);
    stopping.current = false;
  }
}
