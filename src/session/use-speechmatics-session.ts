import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeTranscriptionConfig } from "@speechmatics/real-time-client-react";
import { useRealtimeEventListener, useRealtimeTranscription } from "@speechmatics/real-time-client-react";
import { getAudioDevicesStore, useAudioDevices, usePCMAudioListener, usePCMAudioRecorderContext } from "@speechmatics/browser-audio-input-react";
import { speechEventFromSpeechmatics } from "./speechmatics-adapter";
import type { SpeechEvent } from "./speech-types";
import type { DurableTraceEventDraft } from "../trace/durable-trace";
import { scopedApiRequestId, scopedRunCorrelationId } from "../trace/durable-trace";
import { deliverTraceWithoutBlocking } from "../trace/client-api-trace";
import { AudioDeliveryAccumulator } from "./audio-delivery";
import { LocalSoundCheck, type LocalSoundCheckState } from "./local-sound-check";
import { forwardPcmWithObservation, PcmHealthAccumulator, type PcmHealthWindow } from "./pcm-health";
import { EmptyTranscriptAccumulator } from "./provider-evidence";

const TOKEN_ENDPOINT = "/api/speechmatics/token";
const RECORDING_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

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

/** The same deliberate choice is passed unchanged to every official recorder start. */
export function createRecordingStartOptions(deviceId?: string) {
  return { ...(deviceId ? { deviceId } : {}), recordingOptions: RECORDING_CONSTRAINTS };
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

export async function requestRealtimeToken(sessionId: string | undefined, apiRequestId: string, onTraceEvents?: (events: DurableTraceEventDraft[]) => Promise<unknown> | unknown): Promise<string> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, { method: "POST", headers: { Accept: "application/json", ...(sessionId ? { "X-CueLayer-Session-Id": sessionId } : {}), "X-CueLayer-Api-Request-Id": apiRequestId } });
  } catch {
    throw failure("speech-token-failed", "CueLayer could not request a short-lived Speechmatics access token. Check the server connection and try again.");
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw failure("speech-token-failed", "CueLayer received an invalid Speechmatics access token response. Please try again."); }
  const traceEvents = payload && typeof payload === "object" && "traceEvents" in payload ? (payload as { traceEvents?: DurableTraceEventDraft[] }).traceEvents : undefined;
  if (traceEvents?.length) deliverTraceWithoutBlocking(onTraceEvents, traceEvents);
  if (response.status === 503) throw failure("speech-not-configured", "Speechmatics is not configured on this deployment. Add SPEECHMATICS_API_KEY to the server environment.");
  if (!response.ok) throw failure("speech-token-failed", "CueLayer could not create a short-lived Speechmatics access token. Check the server configuration and try again.");
  if (!payload || typeof payload !== "object" || !("token" in payload) || typeof payload.token !== "string") throw failure("speech-token-failed", "CueLayer received an invalid Speechmatics access token response. Please try again.");
  return payload.token;
}

type SpeechmaticsSessionCallbacks = {
  traceSessionId: string;
  tracePageInstanceId: string;
  onServerTraceEvents?: (events: DurableTraceEventDraft[]) => Promise<unknown> | unknown;
  onEvent: (runId: number, event: SpeechEvent) => void;
  onReady: (runId: number) => void;
  onTrace: (event: Omit<DurableTraceEventDraft, "id" | "timestamp" | "source">) => void;
};

/**
 * Product glue only: official React providers own the recorder, WebSocket, audio
 * forwarding and cleanup; CueLayer supplies run identity and canonical events.
 */
export function useSpeechmaticsSession({ traceSessionId, tracePageInstanceId, onServerTraceEvents, onEvent, onReady, onTrace }: SpeechmaticsSessionCallbacks) {
  const activeRunIdRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);
  const sawRecordingRef = useRef(false);
  const providerSequenceRef = useRef(0);
  const pcmHealthRef = useRef<PcmHealthAccumulator | undefined>(undefined);
  const audioDeliveryRef = useRef<AudioDeliveryAccumulator | undefined>(undefined);
  const emptyTranscriptRef = useRef<EmptyTranscriptAccumulator | undefined>(undefined);
  const soundCheckRef = useRef(new LocalSoundCheck());
  const measurementFailureReportedRef = useRef(false);
  const finalDiagnosticsEmittedRef = useRef(false);
  const { startTranscription, stopTranscription, sendAudio, socketState } = useRealtimeTranscription();
  const previousSocketStateRef = useRef<typeof socketState>(undefined);
  const socketStateRef = useRef(socketState);
  socketStateRef.current = socketState;
  const { startRecording, stopRecording, mute, unmute, isRecording, audioContext } = usePCMAudioRecorderContext();
  const audioDevices = useAudioDevices();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>();
  const [latestPcmWindow, setLatestPcmWindow] = useState<PcmHealthWindow>();
  const [soundCheckState, setSoundCheckState] = useState<LocalSoundCheckState>(soundCheckRef.current.state);
  const deviceList = audioDevices.permissionState === "granted" ? audioDevices.deviceList : [];
  const selectedDevice = deviceList.find((device) => device.deviceId === selectedDeviceId);

  const flushDiagnosticSummaries = useCallback((atMs: number, final = false) => {
    if (final && finalDiagnosticsEmittedRef.current) return;
    const pcm = final ? pcmHealthRef.current?.finish(atMs) : pcmHealthRef.current?.takeDue(atMs);
    if (pcm) {
      setLatestPcmWindow(pcm);
      onTrace({ stage: "speechmatics", type: "speechmatics.audio_input_window", payload: pcm });
    }
    const pcmSampleCount = pcmHealthRef.current?.totalSampleCount;
    const delivery = final ? audioDeliveryRef.current?.finish(atMs, pcmSampleCount) : audioDeliveryRef.current?.takeDue(atMs, pcmSampleCount);
    if (delivery) onTrace({ stage: "speechmatics", type: "speechmatics.audio_delivery_summary", payload: { ...delivery, final } });
    const empties = final ? emptyTranscriptRef.current?.finish(atMs) : emptyTranscriptRef.current?.takeDue(atMs);
    if (empties) onTrace({ stage: "speechmatics", type: "speechmatics.empty_transcript_summary", payload: empties });
    if (final) {
      const pcmRun = pcmHealthRef.current?.runSummary(atMs);
      if (pcmRun) onTrace({ stage: "speechmatics", type: "speechmatics.audio_input_summary", payload: pcmRun });
      const deliveryRun = audioDeliveryRef.current?.runSummary(atMs, pcmSampleCount);
      if (deliveryRun) onTrace({ stage: "speechmatics", type: "speechmatics.audio_delivery_summary", payload: { ...deliveryRun, final: true, scope: "run" } });
      finalDiagnosticsEmittedRef.current = true;
    }
  }, [onTrace]);

  const forwardAudio = useCallback((audio: Float32Array) => {
    const runId = activeRunIdRef.current;
    const health = pcmHealthRef.current;
    if (runId === null || !health) return;
    const atMs = Date.now();
    const socketOpen = socketStateRef.current === "open";
    let soundCheckCompleted = false;
    const forwarded = forwardPcmWithObservation(audio, () => {
      health.observe(audio, atMs, socketOpen);
      soundCheckCompleted = soundCheckRef.current.observe(audio);
    }, sendAudio);
    health.recordSendResult(forwarded.sendAudioThrew, socketOpen);
    if (soundCheckCompleted) setSoundCheckState(soundCheckRef.current.state);
    if (forwarded.measurementFailed && !measurementFailureReportedRef.current) {
      measurementFailureReportedRef.current = true;
      onTrace({ stage: "speechmatics", type: "speechmatics.audio_measurement_error", payload: { runId, reason: "pcm_measurement_failed_audio_forwarding_continued" } });
    }
    flushDiagnosticSummaries(atMs);
  }, [flushDiagnosticSummaries, onTrace, sendAudio]);

  // The official AudioWorklet listener remains the sole PCM source and transport handoff.
  usePCMAudioListener(forwardAudio);

  const failRun = useCallback((runId: number, code: string, message: string) => {
    if (activeRunIdRef.current !== runId) return;
    stoppingRef.current = true;
    stopRecording();
    flushDiagnosticSummaries(Date.now(), true);
    activeRunIdRef.current = null;
    void stopTranscription().catch(() => undefined).finally(() => { stoppingRef.current = false; });
    onTrace({ stage: "speechmatics", type: "speechmatics.connection_failed", payload: { runId, code, message } });
    onEvent(runId, { kind: "error", code, message });
  }, [flushDiagnosticSummaries, onEvent, onTrace, stopRecording, stopTranscription]);

  const onProviderMessage = useCallback(({ data }: { data: Parameters<typeof speechEventFromSpeechmatics>[0] }) => {
    const runId = activeRunIdRef.current;
    if (runId === null) return;
    const atMs = Date.now();
    if (data.message === "AudioAdded") {
      audioDeliveryRef.current?.observe(data.seq_no, atMs, pcmHealthRef.current?.totalSampleCount);
      flushDiagnosticSummaries(atMs);
      return;
    }
    const rawText = (data as { metadata?: { transcript?: unknown } }).metadata?.transcript;
    if ((data.message === "AddPartialTranscript" || data.message === "AddTranscript") && typeof rawText === "string" && !rawText.trim()) {
      emptyTranscriptRef.current?.observe(data.message, rawText, atMs);
      flushDiagnosticSummaries(atMs);
      return;
    }
    const sequence = providerSequenceRef.current++;
    const messageId = `provider-message-${runId}-${sequence}`;
    onTrace({ stage: "speechmatics", type: "speechmatics.raw_message", correlation: { speechEventId: scopedRunCorrelationId(tracePageInstanceId, runId, "speech-event", messageId) }, payload: { runId, messageId, message: data } });
    const event = speechEventFromSpeechmatics(data);
    if (!event) return;
    if (event.kind === "error") {
      failRun(runId, event.code, event.message);
      return;
    }
    onEvent(runId, event.provider ? { ...event, provider: { ...event.provider, sequence, messageId } } : event);
  }, [failRun, flushDiagnosticSummaries, onEvent, onTrace, tracePageInstanceId]);

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
    measurementFailureReportedRef.current = false;
    finalDiagnosticsEmittedRef.current = false;
    soundCheckRef.current.close();
    setSoundCheckState(soundCheckRef.current.state);
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
      const config = createSpeechmaticsConfig(browserAudioContext.sampleRate);
      pcmHealthRef.current = new PcmHealthAccumulator(runId, config.audio_format.sample_rate, browserAudioContext.sampleRate);
      audioDeliveryRef.current = new AudioDeliveryAccumulator(runId);
      emptyTranscriptRef.current = new EmptyTranscriptAccumulator(runId);
      onTrace({ stage: "speechmatics", type: "speechmatics.browser_audio_ready", payload: { runId, sampleRate: browserAudioContext.sampleRate } });
      onTrace({ stage: "speechmatics", type: "speechmatics.effective_recognition_config", payload: {
        runId,
        language: config.transcription_config.language,
        model: config.transcription_config.model,
        maxDelay: config.transcription_config.max_delay,
        maxDelayMode: config.transcription_config.max_delay_mode,
        enablePartials: config.transcription_config.enable_partials,
        audioEncoding: config.audio_format.encoding,
        configuredSampleRate: config.audio_format.sample_rate,
        audioContextSampleRate: browserAudioContext.sampleRate,
        recordingConstraints: RECORDING_CONSTRAINTS,
        inputSelection: selectedDeviceId ? "explicit" : "default",
      } });
      const token = await requestRealtimeToken(traceSessionId, scopedApiRequestId(tracePageInstanceId, "speechmatics-token", runId), onServerTraceEvents);
      onTrace({ stage: "speechmatics", type: "speechmatics.temporary_token_received", payload: { runId, tokenReceived: true } });
      let recognitionStarted;
      try {
        recognitionStarted = await startTranscription(token, config);
      } catch (error) {
        if (import.meta.env.DEV) console.warn("Speechmatics realtime startup failed", error);
        throw failure("realtime-connection-failed", "CueLayer could not connect to Speechmatics realtime. You can reconnect speech without ending the session.");
      }
      onTrace({ stage: "speechmatics", type: "speechmatics.recognition_started", payload: { runId, recognitionStarted } });
      try {
        await startRecording(createRecordingStartOptions(selectedDeviceId));
      } catch (error) {
        throw new SpeechStartError(speechStartFailureFrom(error));
      }
      onTrace({ stage: "speechmatics", type: "speechmatics.capture_started", payload: { runId, inputSelection: selectedDeviceId ? "explicit" : "default" } });
      if (activeRunIdRef.current === runId) {
        onReady(runId);
        onTrace({ stage: "speechmatics", type: "speechmatics.ready", payload: { runId } });
      }
    } catch (error) {
      flushDiagnosticSummaries(Date.now(), true);
      activeRunIdRef.current = null;
      stopRecording();
      void stopTranscription().catch(() => undefined);
      throw error;
    }
  }, [audioContext, audioDevices, flushDiagnosticSummaries, onReady, onServerTraceEvents, onTrace, selectedDeviceId, startRecording, startTranscription, stopRecording, stopTranscription, tracePageInstanceId, traceSessionId]);

  const stop = useCallback(async () => {
    const runId = activeRunIdRef.current;
    stoppingRef.current = true;
    stopRecording();
    try { await stopTranscription(); } catch { /* Official client already closed the socket. */ }
    flushDiagnosticSummaries(Date.now(), true);
    activeRunIdRef.current = null;
    stoppingRef.current = false;
    if (runId !== null) onTrace({ stage: "speechmatics", type: "speechmatics.stopped", payload: { runId } });
  }, [flushDiagnosticSummaries, onTrace, stopRecording, stopTranscription]);

  const pause = useCallback(() => {
    mute();
    onTrace({ stage: "speechmatics", type: "speechmatics.capture_paused", payload: { runId: activeRunIdRef.current } });
  }, [mute, onTrace]);
  const resume = useCallback(() => {
    unmute();
    onTrace({ stage: "speechmatics", type: "speechmatics.capture_resumed", payload: { runId: activeRunIdRef.current } });
  }, [onTrace, unmute]);
  const startSoundCheck = useCallback(() => {
    if (!audioContext || activeRunIdRef.current === null) return;
    soundCheckRef.current.start(audioContext.sampleRate);
    setSoundCheckState(soundCheckRef.current.state);
  }, [audioContext]);
  const playSoundCheck = useCallback(() => {
    if (audioContext) soundCheckRef.current.play(audioContext);
  }, [audioContext]);
  const closeSoundCheck = useCallback(() => {
    soundCheckRef.current.close();
    setSoundCheckState(soundCheckRef.current.state);
  }, []);

  return {
    start,
    stop,
    pause,
    resume,
    diagnostics: {
      permissionState: audioDevices.permissionState,
      deviceList,
      selectedDeviceId,
      selectedDeviceLabel: selectedDevice?.label ?? (selectedDeviceId ? "Selected device unavailable" : "Browser default input"),
      setSelectedDeviceId,
      requestPermission: "promptPermissions" in audioDevices ? audioDevices.promptPermissions : undefined,
      latestPcmWindow,
      soundCheckState,
      startSoundCheck,
      playSoundCheck,
      closeSoundCheck,
    },
  };
}
