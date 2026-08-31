import { useCallback, useEffect, useRef } from "react";
import type { RealtimeTranscriptionConfig } from "@speechmatics/real-time-client-react";
import { useRealtimeEventListener, useRealtimeTranscription } from "@speechmatics/real-time-client-react";
import { usePCMAudioListener, usePCMAudioRecorderContext } from "@speechmatics/browser-audio-input-react";
import { speechEventFromSpeechmatics } from "./speechmatics-adapter";
import type { SpeechEvent } from "./speech-types";

const TOKEN_ENDPOINT = "/api/speechmatics/token";

const speechmaticsConfig = {
  transcription_config: {
    language: "cmn_en",
    model: "enhanced",
    max_delay: 1.5,
    max_delay_mode: "flexible",
    enable_partials: true,
    additional_vocab: [
      { content: "activation energy" },
      { content: "rate-determining step" },
      { content: "electrophile" },
      { content: "nucleophile" },
      { content: "disproportionation" },
      { content: "enthalpy" },
      { content: "entropy" },
      { content: "Le Chatelier" },
      { content: "stoichiometry" },
    ],
  },
  audio_format: { type: "raw", encoding: "pcm_f32le", sample_rate: 16_000 },
} satisfies RealtimeTranscriptionConfig;

async function requestRealtimeToken(): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, { method: "POST", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`token-${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("token" in payload) || typeof payload.token !== "string") throw new Error("invalid-token-response");
  return payload.token;
}

type SpeechmaticsSessionCallbacks = {
  onEvent: (runId: number, event: SpeechEvent) => void;
  onReady: (runId: number) => void;
};

/**
 * Product glue only: official React providers own the recorder, WebSocket, audio
 * forwarding and cleanup; CueLayer supplies run identity and canonical events.
 */
export function useSpeechmaticsSession({ onEvent, onReady }: SpeechmaticsSessionCallbacks) {
  const activeRunIdRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);
  const sawRecordingRef = useRef(false);
  const { startTranscription, stopTranscription, sendAudio, socketState } = useRealtimeTranscription();
  const { startRecording, stopRecording, mute, unmute, isRecording } = usePCMAudioRecorderContext();

  // This is Speechmatics' documented React audio handoff. AudioWorklet PCM buffers are ArrayBuffers.
  usePCMAudioListener((audio) => sendAudio(audio.buffer as ArrayBuffer));

  const failRun = useCallback((runId: number, code: string, message: string) => {
    if (activeRunIdRef.current !== runId) return;
    activeRunIdRef.current = null;
    stopRecording();
    void stopTranscription().catch(() => undefined);
    onEvent(runId, { kind: "error", code, message });
  }, [onEvent, stopRecording, stopTranscription]);

  const onProviderMessage = useCallback(({ data }: { data: Parameters<typeof speechEventFromSpeechmatics>[0] }) => {
    const runId = activeRunIdRef.current;
    if (runId === null) return;
    const event = speechEventFromSpeechmatics(data);
    if (!event) return;
    if (event.kind === "error") {
      failRun(runId, event.code, event.message);
      return;
    }
    onEvent(runId, event);
  }, [failRun, onEvent]);

  useRealtimeEventListener("receiveMessage", onProviderMessage);

  useEffect(() => {
    const runId = activeRunIdRef.current;
    if (runId !== null && socketState === "closed" && !stoppingRef.current) {
      failRun(runId, "connection-closed", "Speechmatics disconnected. You can reconnect speech without ending the presentation.");
    }
  }, [failRun, socketState]);

  useEffect(() => {
    if (isRecording) {
      sawRecordingRef.current = true;
      return;
    }
    const runId = activeRunIdRef.current;
    if (runId !== null && sawRecordingRef.current && !stoppingRef.current) {
      failRun(runId, "microphone-ended", "The microphone stopped. You can enable speech again.");
    }
  }, [failRun, isRecording]);

  const start = useCallback(async (runId: number) => {
    activeRunIdRef.current = runId;
    stoppingRef.current = false;
    sawRecordingRef.current = false;
    try {
      await startTranscription(await requestRealtimeToken(), speechmaticsConfig);
      await startRecording({});
      if (activeRunIdRef.current === runId) onReady(runId);
    } catch (error) {
      activeRunIdRef.current = null;
      stopRecording();
      void stopTranscription().catch(() => undefined);
      throw error;
    }
  }, [onReady, startRecording, startTranscription, stopRecording, stopTranscription]);

  const stop = useCallback(async () => {
    activeRunIdRef.current = null;
    stoppingRef.current = true;
    stopRecording();
    try { await stopTranscription(); } catch { /* Official client already closed the socket. */ }
    stoppingRef.current = false;
  }, [stopRecording, stopTranscription]);

  return { start, stop, pause: mute, resume: unmute };
}
