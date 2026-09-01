import { useCallback, useEffect, useRef } from "react";
import type { RealtimeTranscriptionConfig } from "@speechmatics/real-time-client-react";
import { useRealtimeEventListener, useRealtimeTranscription } from "@speechmatics/real-time-client-react";
import { getAudioDevicesStore, useAudioDevices, usePCMAudioListener, usePCMAudioRecorderContext } from "@speechmatics/browser-audio-input-react";
import { speechEventFromSpeechmatics } from "./speechmatics-adapter";
import type { SpeechEvent } from "./speech-types";
import type { DurableTraceEventDraft } from "../trace/durable-trace";

const TOKEN_ENDPOINT = "/api/speechmatics/token";

export type SpeechStartFailure = {
  code: "speech-not-configured" | "speech-token-failed" | "microphone-permission-denied" | "audio-context-failed" | "audio-worklet-failed" | "realtime-connection-failed";
  message: string;
};

class SpeechStartError extends Error {
  constructor(readonly failure: SpeechStartFailure) {
    super(failure.message);
    this.name = "SpeechStartError";
  }
}

type BrowserAudioActivation = {
  audioContext?: Pick<AudioContext, "state" | "resume">;
  permissionState: PermissionState | "prompting";
  promptPermissions?: () => void | Promise<void>;
  getPermissionState: () => PermissionState | "prompting";
};

/** Starts the official browser-audio permission and context lifecycle in the click call stack. */
export async function activateBrowserAudio({ audioContext, permissionState, promptPermissions, getPermissionState }: BrowserAudioActivation): Promise<void> {
  if (!audioContext) throw failure("audio-context-failed", "CueLayer could not create browser audio. Reload the page and try again.");
  if (permissionState === "denied") throw failure("microphone-permission-denied", "CueLayer needs microphone permission to enable live speech.");

  // Both calls begin before the first await, preserving the deliberate Enable mic gesture.
  const permissionRequest = permissionState === "prompt" && promptPermissions
    ? Promise.resolve(promptPermissions())
    : Promise.resolve();
  const resumeRequest = audioContext.state === "running"
    ? Promise.resolve()
    : audioContext.resume().catch(() => { throw failure("audio-context-failed", "CueLayer could not start browser audio. Try interacting with the page and enabling the microphone again."); });

  try {
    await Promise.all([permissionRequest, resumeRequest]);
  } catch (error) {
    if (error instanceof SpeechStartError) throw error;
    throw new SpeechStartError(speechStartFailureFrom(error));
  }
  if (getPermissionState() === "denied") throw failure("microphone-permission-denied", "CueLayer needs microphone permission to enable live speech.");
  if (audioContext.state !== "running") throw failure("audio-context-failed", "CueLayer could not start browser audio. Try interacting with the page and enabling the microphone again.");
}

export function createSpeechmaticsConfig(sampleRate: number) {
  return {
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
    audio_format: { type: "raw", encoding: "pcm_f32le", sample_rate: sampleRate },
  } satisfies RealtimeTranscriptionConfig;
}

function failure(code: SpeechStartFailure["code"], message: string): SpeechStartError {
  return new SpeechStartError({ code, message });
}

export function speechStartFailureFrom(error: unknown): SpeechStartFailure {
  if (error instanceof SpeechStartError) return error.failure;
  if (typeof DOMException !== "undefined" && error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return { code: "microphone-permission-denied", message: "CueLayer needs microphone permission to enable live speech." };
  }
  if (error instanceof Error && error.name === "AudioContextResumeError") {
    return { code: "audio-context-failed", message: "CueLayer could not start browser audio. Try interacting with the page and enabling the microphone again." };
  }
  if (error instanceof Error && error.name === "AudioModuleRegistrationError") {
    return { code: "audio-worklet-failed", message: "CueLayer could not load the browser audio processor. Reload the page and try again." };
  }
  return { code: "realtime-connection-failed", message: "CueLayer could not connect to Speechmatics realtime. You can reconnect speech without ending the session." };
}

async function requestRealtimeToken(sessionId: string, apiRequestId: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, { method: "POST", headers: { Accept: "application/json", "X-CueLayer-Session-Id": sessionId, "X-CueLayer-Api-Request-Id": apiRequestId } });
  } catch {
    throw failure("speech-token-failed", "CueLayer could not request a short-lived Speechmatics access token. Check the server connection and try again.");
  }
  if (response.status === 503) throw failure("speech-not-configured", "Speechmatics is not configured on this deployment. Add SPEECHMATICS_API_KEY to the server environment.");
  if (!response.ok) throw failure("speech-token-failed", "CueLayer could not create a short-lived Speechmatics access token. Check the server configuration and try again.");
  let payload: unknown;
  try { payload = await response.json(); } catch { throw failure("speech-token-failed", "CueLayer received an invalid Speechmatics access token response. Please try again."); }
  if (!payload || typeof payload !== "object" || !("token" in payload) || typeof payload.token !== "string") throw failure("speech-token-failed", "CueLayer received an invalid Speechmatics access token response. Please try again.");
  return payload.token;
}

type SpeechmaticsSessionCallbacks = {
  traceSessionId: string;
  onEvent: (runId: number, event: SpeechEvent) => void;
  onReady: (runId: number) => void;
  onTrace: (event: Omit<DurableTraceEventDraft, "id" | "timestamp" | "source">) => void;
};

/**
 * Product glue only: official React providers own the recorder, WebSocket, audio
 * forwarding and cleanup; CueLayer supplies run identity and canonical events.
 */
export function useSpeechmaticsSession({ traceSessionId, onEvent, onReady, onTrace }: SpeechmaticsSessionCallbacks) {
  const activeRunIdRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);
  const sawRecordingRef = useRef(false);
  const providerSequenceRef = useRef(0);
  const { startTranscription, stopTranscription, sendAudio, socketState } = useRealtimeTranscription();
  const previousSocketStateRef = useRef<typeof socketState>(undefined);
  const { startRecording, stopRecording, mute, unmute, isRecording, audioContext } = usePCMAudioRecorderContext();
  const audioDevices = useAudioDevices();

  // This is Speechmatics' documented React audio handoff.
  usePCMAudioListener(sendAudio);

  const failRun = useCallback((runId: number, code: string, message: string) => {
    if (activeRunIdRef.current !== runId) return;
    activeRunIdRef.current = null;
    stopRecording();
    void stopTranscription().catch(() => undefined);
    onTrace({ stage: "speechmatics", type: "speechmatics.connection_failed", payload: { runId, code, message } });
    onEvent(runId, { kind: "error", code, message });
  }, [onEvent, onTrace, stopRecording, stopTranscription]);

  const onProviderMessage = useCallback(({ data }: { data: Parameters<typeof speechEventFromSpeechmatics>[0] }) => {
    const runId = activeRunIdRef.current;
    if (runId === null) return;
    const event = speechEventFromSpeechmatics(data);
    if (!event) return;
    if (event.kind === "error") {
      failRun(runId, event.code, event.message);
      return;
    }
    const sequence = providerSequenceRef.current++;
    onEvent(runId, event.provider ? { ...event, provider: { ...event.provider, sequence } } : event);
  }, [failRun, onEvent]);

  useRealtimeEventListener("receiveMessage", onProviderMessage);

  useEffect(() => {
    const runId = activeRunIdRef.current;
    if (runId !== null && previousSocketStateRef.current !== socketState) {
      onTrace({ stage: "speechmatics", type: "speechmatics.socket_state_changed", payload: { runId, previousState: previousSocketStateRef.current, socketState } });
    }
    previousSocketStateRef.current = socketState;
    if (runId !== null && socketState === "closed" && !stoppingRef.current) {
      failRun(runId, "connection-closed", "Speechmatics disconnected. You can reconnect speech without ending the presentation.");
    }
  }, [failRun, onTrace, socketState]);

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
    providerSequenceRef.current = 0;
    onTrace({ stage: "speechmatics", type: "speechmatics.connection_starting", payload: { runId } });
    try {
      const browserAudioContext = audioContext;
      if (!browserAudioContext) throw failure("audio-context-failed", "CueLayer could not create browser audio. Reload the page and try again.");
      await activateBrowserAudio({
        audioContext: browserAudioContext,
        permissionState: audioDevices.permissionState,
        promptPermissions: "promptPermissions" in audioDevices ? audioDevices.promptPermissions : undefined,
        getPermissionState: () => getAudioDevicesStore().permissionState,
      });
      onTrace({ stage: "speechmatics", type: "speechmatics.browser_audio_ready", payload: { runId, sampleRate: browserAudioContext.sampleRate } });
      const token = await requestRealtimeToken(traceSessionId, `speechmatics-token-${runId}`);
      onTrace({ stage: "speechmatics", type: "speechmatics.temporary_token_received", payload: { runId, tokenReceived: true } });
      try {
        await startTranscription(token, createSpeechmaticsConfig(browserAudioContext.sampleRate));
      } catch (error) {
        if (import.meta.env.DEV) console.warn("Speechmatics realtime startup failed", error);
        throw failure("realtime-connection-failed", "CueLayer could not connect to Speechmatics realtime. You can reconnect speech without ending the session.");
      }
      onTrace({ stage: "speechmatics", type: "speechmatics.transcription_started", payload: { runId, language: "cmn_en", model: "enhanced" } });
      try {
        await startRecording({});
      } catch (error) {
        throw new SpeechStartError(speechStartFailureFrom(error));
      }
      onTrace({ stage: "speechmatics", type: "speechmatics.capture_started", payload: { runId } });
      if (activeRunIdRef.current === runId) {
        onReady(runId);
        onTrace({ stage: "speechmatics", type: "speechmatics.ready", payload: { runId } });
      }
    } catch (error) {
      activeRunIdRef.current = null;
      stopRecording();
      void stopTranscription().catch(() => undefined);
      throw error;
    }
  }, [audioContext, audioDevices, onReady, onTrace, startRecording, startTranscription, stopRecording, stopTranscription, traceSessionId]);

  const stop = useCallback(async () => {
    const runId = activeRunIdRef.current;
    activeRunIdRef.current = null;
    stoppingRef.current = true;
    stopRecording();
    try { await stopTranscription(); } catch { /* Official client already closed the socket. */ }
    stoppingRef.current = false;
    if (runId !== null) onTrace({ stage: "speechmatics", type: "speechmatics.stopped", payload: { runId } });
  }, [onTrace, stopRecording, stopTranscription]);

  const pause = useCallback(() => {
    mute();
    onTrace({ stage: "speechmatics", type: "speechmatics.capture_paused", payload: { runId: activeRunIdRef.current } });
  }, [mute, onTrace]);
  const resume = useCallback(() => {
    unmute();
    onTrace({ stage: "speechmatics", type: "speechmatics.capture_resumed", payload: { runId: activeRunIdRef.current } });
  }, [onTrace, unmute]);

  return { start, stop, pause, resume };
}
