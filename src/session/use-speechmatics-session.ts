import { useCallback, useEffect, useRef } from "react";
import type { RealtimeTranscriptionConfig } from "@speechmatics/real-time-client-react";
import { useRealtimeEventListener, useRealtimeTranscription } from "@speechmatics/real-time-client-react";
import { getAudioDevicesStore, useAudioDevices, usePCMAudioListener, usePCMAudioRecorderContext } from "@speechmatics/browser-audio-input-react";
import { speechEventFromSpeechmatics } from "./speechmatics-adapter";
import type { SpeechEvent } from "./speech-types";

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

async function requestRealtimeToken(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, { method: "POST", headers: { Accept: "application/json" } });
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
  const { startRecording, stopRecording, mute, unmute, isRecording, audioContext } = usePCMAudioRecorderContext();
  const audioDevices = useAudioDevices();

  // This is Speechmatics' documented React audio handoff.
  usePCMAudioListener(sendAudio);

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
      const browserAudioContext = audioContext;
      if (!browserAudioContext) throw failure("audio-context-failed", "CueLayer could not create browser audio. Reload the page and try again.");
      await activateBrowserAudio({
        audioContext: browserAudioContext,
        permissionState: audioDevices.permissionState,
        promptPermissions: "promptPermissions" in audioDevices ? audioDevices.promptPermissions : undefined,
        getPermissionState: () => getAudioDevicesStore().permissionState,
      });
      const token = await requestRealtimeToken();
      try {
        await startTranscription(token, createSpeechmaticsConfig(browserAudioContext.sampleRate));
      } catch {
        throw failure("realtime-connection-failed", "CueLayer could not connect to Speechmatics realtime. You can reconnect speech without ending the session.");
      }
      try {
        await startRecording({});
      } catch (error) {
        throw new SpeechStartError(speechStartFailureFrom(error));
      }
      if (activeRunIdRef.current === runId) onReady(runId);
    } catch (error) {
      activeRunIdRef.current = null;
      stopRecording();
      void stopTranscription().catch(() => undefined);
      throw error;
    }
  }, [audioContext, audioDevices, onReady, startRecording, startTranscription, stopRecording, stopTranscription]);

  const stop = useCallback(async () => {
    activeRunIdRef.current = null;
    stoppingRef.current = true;
    stopRecording();
    try { await stopTranscription(); } catch { /* Official client already closed the socket. */ }
    stoppingRef.current = false;
  }, [stopRecording, stopTranscription]);

  return { start, stop, pause: mute, resume: unmute };
}
