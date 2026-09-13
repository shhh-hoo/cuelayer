/** Diagnostic classifications never select semantic acceptance or retry behavior. */
export type CoreAbortSource = "provider_deadline" | "client_deadline" | "client_disconnect" | "session_cancellation" | "stale_speech_generation" | "provider_transport_failure";
export function coreAbortSource(signal?: AbortSignal, error?: unknown): CoreAbortSource {
  const reason = signal?.aborted ? signal.reason : error instanceof Error ? error.message : error;
  if (reason === "core-provider-timeout") return "provider_deadline";
  if (reason === "core-client-timeout") return "client_deadline";
  if (reason === "client-disconnected") return "client_disconnect";
  if (reason === "core-cancelled") return "session_cancellation";
  if (reason === "core-stale-speech-run" || reason === "core-stale-result") return "stale_speech_generation";
  return signal?.aborted ? "session_cancellation" : "provider_transport_failure";
}
export type CoreTiming = { startedAt: string; completedAt: string; elapsedMs: number; outcome: "success" | "failure"; abortSource?: CoreAbortSource };
export type CoreRequestWeight = { serializedCharacters: number; serializedBytes: number; estimatedTokens: number;
  estimate: "ceil-json-characters-divided-by-four"; contextCharacters: number; contextEstimatedTokens: number;
  entityCount: number; newEvidenceCheckpointCount: number; requestedMaxOutputTokens: number };
export type CoreQueuePressure = { pendingCheckpointCount: number; oldestPendingAgeMs: number | null; requestCheckpointCount: number;
  processedThroughSequence: number; consecutiveFailures: number; paused: boolean; backingOff: boolean };
