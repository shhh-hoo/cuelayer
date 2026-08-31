import { InputAudioEvent, PCMRecorder } from "@speechmatics/browser-audio-input";
import { RealtimeClient } from "@speechmatics/real-time-client";
import type { RealtimeServerMessage } from "@speechmatics/real-time-client";
import workletScriptURL from "@speechmatics/browser-audio-input/pcm-audio-worklet.min.js?url";
import { speechEventFromSpeechmatics } from "./speechmatics-adapter";
import type { SpeechEvent } from "./speech-types";

const SAMPLE_RATE = 16_000;
const TOKEN_ENDPOINT = "/api/speechmatics/token";

type LiveSpeechCallbacks = {
  onEvent: (event: SpeechEvent) => void;
  onReady: () => void;
  onUnexpectedClose: () => void;
};

type OfficialRealtimeConfig = {
  transcription_config: {
    language: "cmn_en";
    model: "enhanced";
    max_delay: number;
    max_delay_mode: "flexible";
    enable_partials: true;
    additional_vocab: Array<{ content: string }>;
  };
  audio_format: { type: "raw"; encoding: "pcm_f32le"; sample_rate: number };
};

const speechmaticsConfig: OfficialRealtimeConfig = {
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
  audio_format: { type: "raw", encoding: "pcm_f32le", sample_rate: SAMPLE_RATE },
};

async function requestRealtimeToken(): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, { method: "POST", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`token-${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("token" in payload) || typeof payload.token !== "string") throw new Error("invalid-token-response");
  return payload.token;
}

/** Owns exactly one browser microphone + Speechmatics realtime connection. */
export class SpeechmaticsLiveRun {
  private readonly client = new RealtimeClient({ url: "wss://global.rt.speechmatics.com/v2" });
  private readonly recorder = new PCMRecorder(workletScriptURL);
  private audioContext: AudioContext | undefined;
  private disposed = false;
  private stopping = false;
  private microphoneWatch: number | undefined;

  constructor(private readonly callbacks: LiveSpeechCallbacks) {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("microphone-unsupported");
    this.client.addEventListener("receiveMessage", this.handleMessage);
    this.client.addEventListener("socketStateChange", this.handleSocketState);
    this.recorder.addEventListener("audio", this.handleAudio);

    try {
      const token = await requestRealtimeToken();
      this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      if (this.audioContext.sampleRate !== SAMPLE_RATE) throw new Error("unsupported-sample-rate");
      // The current official API calls this `model`; v5.0.1's generated SDK type still exposes its older name.
      await this.client.start(token, speechmaticsConfig as unknown as Parameters<RealtimeClient["start"]>[1]);
      if (this.disposed) return;
      await this.recorder.startRecording({ audioContext: this.audioContext });
      if (this.disposed) return;
      this.microphoneWatch = window.setInterval(() => {
        if (!this.disposed && !this.recorder.isRecording) this.fail("microphone-ended", "The microphone stopped. You can enable speech again.");
      }, 500);
      this.callbacks.onReady();
    } catch (error) {
      this.releaseLocalResources();
      void this.client.stopRecognition().catch(() => undefined);
      throw error;
    }
  }

  pause(): void { this.recorder.mute(); }
  resume(): void { this.recorder.unmute(); }

  async stop(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopping = true;
    this.releaseLocalResources();
    try { await this.client.stopRecognition(); } catch { /* A closed socket has already released the provider side. */ }
    this.client.removeEventListener("receiveMessage", this.handleMessage);
    this.client.removeEventListener("socketStateChange", this.handleSocketState);
  }

  private readonly handleMessage = ({ data }: MessageEvent<RealtimeServerMessage>) => {
    if (this.disposed) return;
    const event = speechEventFromSpeechmatics(data);
    if (event) this.callbacks.onEvent(event);
  };

  private readonly handleAudio = (event: InputAudioEvent) => {
    if (this.disposed || this.recorder.isMuted) return;
    const { buffer, byteOffset, byteLength } = event.data;
    try { this.client.sendAudio(buffer.slice(byteOffset, byteOffset + byteLength)); }
    catch { this.fail("audio-send-failed", "Speechmatics could not receive microphone audio."); }
  };

  private readonly handleSocketState = () => {
    if (!this.disposed && !this.stopping && this.client.socketState === "closed") this.fail("connection-closed", "Speechmatics disconnected. You can reconnect speech without ending the presentation.");
  };

  private fail(code: string, message: string): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseLocalResources();
    void this.client.stopRecognition().catch(() => undefined);
    this.callbacks.onEvent({ kind: "error", code, message });
    this.callbacks.onUnexpectedClose();
  }

  private releaseLocalResources(): void {
    if (this.microphoneWatch !== undefined) window.clearInterval(this.microphoneWatch);
    this.microphoneWatch = undefined;
    this.recorder.removeEventListener("audio", this.handleAudio);
    this.recorder.stopRecording();
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = undefined;
  }
}
