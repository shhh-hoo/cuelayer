import { useCallback, useEffect, useRef } from "react";
import type { RealtimeTranscriptionConfig } from "@speechmatics/real-time-client-react";
import { useRealtimeEventListener, useRealtimeTranscription } from "@speechmatics/real-time-client-react";
import { getAudioDevicesStore, useAudioDevices, usePCMAudioListener, usePCMAudioRecorderContext } from "@speechmatics/browser-audio-input-react";
import { speechEventFromSpeechmatics } from "./speechmatics-adapter";
import type { SpeechEvent } from "./speech-types";
import { AudioDeliveryMonitor } from "./audio-delivery-window";
import { createSpeechmaticsDrainBarrier, drainSpeechmaticsStop, type SpeechmaticsDrainBarrier } from "./speechmatics-stop-drain";
import { traceDraft, type SessionTraceDraft, type SessionTracePayloads, type TraceEmitter } from "../trace/contracts";

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
  onTrace?: TraceEmitter;
};

function wordBounds(event: Exclude<SpeechEvent, { kind: "error" }>) {
  if (!event.words.length) return {};
  return {
    startMs: Math.min(...event.words.map((word) => word.startMs)),
    endMs: Math.max(...event.words.map((word) => word.endMs)),
  };
}

/**
 * Product glue only: official React providers own the recorder, WebSocket, audio
 * forwarding and cleanup; CueLayer supplies run identity and canonical events.
 */
export function useSpeechmaticsSession({ onEvent, onReady, onTrace }: SpeechmaticsSessionCallbacks) {
  const activeRunIdRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);
  const drainBarrierRef = useRef<SpeechmaticsDrainBarrier | undefined>(undefined);
  const sawRecordingRef = useRef(false);
  const providerMessageSequenceRef = useRef(0);
  const deliveryMonitorRef = useRef<AudioDeliveryMonitor | undefined>(undefined);
  const deliveryTimerRef = useRef<number | undefined>(undefined);
  const onTraceRef = useRef<TraceEmitter | undefined>(onTrace);
  onTraceRef.current = onTrace;
  const { startTranscription, stopTranscription, sendAudio, socketState } = useRealtimeTranscription();
  const { startRecording, stopRecording, mute, unmute, isRecording, audioContext } = usePCMAudioRecorderContext();
  const audioDevices = useAudioDevices();

  const emitTrace = useCallback((draft: SessionTraceDraft) => onTraceRef.current?.(draft), []);

  // Deliberate invariant: no measurement, persistence, allocation, or React update
  // may run in front of the official live PCM transport callback.
  usePCMAudioListener(sendAudio);

  const stopDeliveryMonitor = useCallback((final = false) => {
    if (deliveryTimerRef.current !== undefined) {
      window.clearInterval(deliveryTimerRef.current);
      deliveryTimerRef.current = undefined;
    }
    const monitor = deliveryMonitorRef.current;
    if (!monitor) return;
    const now = Date.now();
    if (final) {
      emitTrace(traceDraft("speech.transport_window", monitor.takeWindow(now, true), {
        priority: "aggregate",
        correlation: { rootId: `speech:${monitor.runId}`, runId: monitor.runId },
      }));
      emitTrace(traceDraft("speech.transport_window", monitor.runSummary(now), {
        priority: "aggregate",
        correlation: { rootId: `speech:${monitor.runId}`, runId: monitor.runId },
      }));
    }
    deliveryMonitorRef.current = undefined;
  }, [emitTrace]);

  const startDeliveryMonitor = useCallback((runId: number) => {
    stopDeliveryMonitor(false);
    const monitor = new AudioDeliveryMonitor(runId, Date.now());
    deliveryMonitorRef.current = monitor;
    deliveryTimerRef.current = window.setInterval(() => {
      if (deliveryMonitorRef.current !== monitor) return;
      emitTrace(traceDraft("speech.transport_window", monitor.takeWindow(Date.now()), {
        priority: "aggregate",
        correlation: { rootId: `speech:${runId}`, runId },
      }));
    }, 1_000);
  }, [emitTrace, stopDeliveryMonitor]);

  const lifecycle = useCallback((runId: number, state: SessionTracePayloads["speech.lifecycle"]["state"], details: Omit<SessionTracePayloads["speech.lifecycle"], "runId" | "state"> = {}) => {
    emitTrace(traceDraft("speech.lifecycle", { runId, state, ...details }, {
      priority: "critical",
      correlation: { rootId: `speech:${runId}`, runId },
    }));
  }, [emitTrace]);

  const failRun = useCallback((runId: number, code: string, message: string) => {
    if (activeRunIdRef.current !== runId) return;
    activeRunIdRef.current = null;
    stoppingRef.current = true;
    stopRecording();
    stopDeliveryMonitor(true);
    void stopTranscription().catch(() => undefined).finally(() => { stoppingRef.current = false; });
    lifecycle(runId, "failed", { code, message });
    onEvent(runId, { kind: "error", code, message });
  }, [lifecycle, onEvent, stopDeliveryMonitor, stopRecording, stopTranscription]);

  const onProviderMessage = useCallback(({ data }: { data: Parameters<typeof speechEventFromSpeechmatics>[0] }) => {
    const runId = activeRunIdRef.current;
    if (runId === null) return;
    if (data.message === "EndOfTranscript") {
      const barrier = drainBarrierRef.current;
      if (barrier?.runId === runId) barrier.observeEndOfTranscript();
      return;
    }
    if (data.message === "AudioAdded") {
      const seqNo = (data as { seq_no?: unknown }).seq_no;
      if (typeof seqNo === "number") deliveryMonitorRef.current?.observe(seqNo);
      return;
    }
    const event = speechEventFromSpeechmatics(data);
    if (!event) return;
    const speechEventId = `speech-event-${runId}-${providerMessageSequenceRef.current++}`;
    if (event.kind === "error") {
      failRun(runId, event.code, event.message);
      return;
    }
    const correlation = { rootId: `speech:${runId}`, runId, speechEventId };
    if (event.kind === "provisional") {
      emitTrace(traceDraft("speech.partial", { runId, transcript: event.text, wordCount: event.words.length }, { priority: "raw", correlation }));
    } else {
      emitTrace(traceDraft("speech.final_received", { runId, transcript: event.text, wordCount: event.words.length, ...wordBounds(event) }, { priority: "critical", correlation }));
    }
    onEvent(runId, event.kind === "committed" ? { ...event, speechEventId } : event);
  }, [emitTrace, failRun, onEvent]);

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
    drainBarrierRef.current = undefined;
    sawRecordingRef.current = false;
    providerMessageSequenceRef.current = 0;
    lifecycle(runId, "starting");
    try {
      const browserAudioContext = audioContext;
      if (!browserAudioContext) throw failure("audio-context-failed", "CueLayer could not create browser audio. Reload the page and try again.");
      await activateBrowserAudio({
        audioContext: browserAudioContext,
        permissionState: audioDevices.permissionState,
        promptPermissions: "promptPermissions" in audioDevices ? audioDevices.promptPermissions : undefined,
        getPermissionState: () => getAudioDevicesStore().permissionState,
      });
      lifecycle(runId, "browser_audio_ready", { sampleRate: browserAudioContext.sampleRate });
      lifecycle(runId, "token_requested");
      const token = await requestRealtimeToken();
      lifecycle(runId, "token_received");
      try {
        await startTranscription(token, createSpeechmaticsConfig(browserAudioContext.sampleRate));
      } catch (error) {
        if (import.meta.env.DEV) console.warn("Speechmatics realtime startup failed", error);
        throw failure("realtime-connection-failed", "CueLayer could not connect to Speechmatics realtime. You can reconnect speech without ending the session.");
      }
      lifecycle(runId, "transcription_started", { sampleRate: browserAudioContext.sampleRate });
      startDeliveryMonitor(runId);
      try {
        await startRecording({});
      } catch (error) {
        throw new SpeechStartError(speechStartFailureFrom(error));
      }
      lifecycle(runId, "capture_started", { sampleRate: browserAudioContext.sampleRate });
      if (activeRunIdRef.current === runId) {
        onReady(runId);
        lifecycle(runId, "ready", { sampleRate: browserAudioContext.sampleRate });
      }
    } catch (error) {
      const startFailure = speechStartFailureFrom(error);
      stopDeliveryMonitor(true);
      activeRunIdRef.current = null;
      stopRecording();
      void stopTranscription().catch(() => undefined);
      lifecycle(runId, "failed", { code: startFailure.code, message: startFailure.message });
      throw error;
    }
  }, [audioContext, audioDevices, lifecycle, onReady, startDeliveryMonitor, startRecording, startTranscription, stopDeliveryMonitor, stopRecording, stopTranscription]);

  const stop = useCallback(async () => {
    const runId = activeRunIdRef.current;
    if (runId === null) return;
    const barrier = createSpeechmaticsDrainBarrier(runId);
    drainBarrierRef.current = barrier;
    try {
      await drainSpeechmaticsStop({
        activeRunId: activeRunIdRef,
        stopping: stoppingRef,
        stopRecording,
        stopTranscription,
        barrier,
        finish: (runId) => {
          stopDeliveryMonitor(true);
          emitTrace(traceDraft("speech.drain_completed", { runId }, { priority: "critical", correlation: { rootId: `speech:${runId}`, runId } }));
          lifecycle(runId, "stopped");
        },
        fail: (runId, error) => {
          stopDeliveryMonitor(true);
          const code = "speech-drain-incomplete";
          emitTrace(traceDraft("speech.drain_incomplete", { runId, code, message: error.message }, { priority: "critical", correlation: { rootId: `speech:${runId}`, runId } }));
          lifecycle(runId, "failed", { code, message: error.message });
          onEvent(runId, { kind: "error", code, message: error.message });
        },
      });
    } finally {
      if (drainBarrierRef.current === barrier) drainBarrierRef.current = undefined;
    }
  }, [emitTrace, lifecycle, onEvent, stopDeliveryMonitor, stopRecording, stopTranscription]);

  const pause = useCallback(() => {
    mute();
    const runId = activeRunIdRef.current;
    if (runId !== null) lifecycle(runId, "paused");
  }, [lifecycle, mute]);

  const resume = useCallback(() => {
    unmute();
    const runId = activeRunIdRef.current;
    if (runId !== null) lifecycle(runId, "resumed");
  }, [lifecycle, unmute]);

  return { start, stop, pause, resume };
}
