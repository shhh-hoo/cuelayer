import { PCMRecorder } from "@speechmatics/browser-audio-input";
import workletUrl from "@speechmatics/browser-audio-input/pcm-audio-worklet.min.js?url";
import {
  RealtimeClient,
  type RealtimeTranscriptionConfig,
} from "@speechmatics/real-time-client";
import { SpeechEvidenceAdapter, type SpeechMessage } from "./speech";
import type { Evidence } from "../contract";
import type { Session } from "../session";

export const speechConfiguration = (
  sampleRate: number,
): RealtimeTranscriptionConfig => ({
  transcription_config: {
    language: "cmn_en",
    model: "enhanced",
    max_delay: 1.5,
    max_delay_mode: "flexible",
    enable_partials: true,
    additional_vocab: [
      "activation energy",
      "rate-determining step",
      "electrophile",
      "nucleophile",
      "disproportionation",
      "enthalpy",
      "entropy",
      "Le Chatelier",
      "stoichiometry",
    ].map((content) => ({ content })),
  },
  audio_format: { type: "raw", encoding: "pcm_f32le", sample_rate: sampleRate },
});

/** Sample-count → browser observation mapping. No PCM is retained or inspected.
 * 100ms bins, at most 120 seconds. Values refer to end of provider audio interval,
 * not capture-device wall time; delayed/evicted intervals remain unmapped. */
export class AudioObservationClock {
  seconds = 0;
  private bins: { start: number; end: number; observed: number }[] = [];
  observe(samples: number, rate: number, at = performance.now()) {
    const start = this.seconds;
    this.seconds += samples / rate;
    const last = this.bins.at(-1);
    if (last && this.seconds - last.start < 0.1) {
      last.end = this.seconds;
      last.observed = at;
    } else {
      this.bins.push({ start, end: this.seconds, observed: at });
      if (this.bins.length > 1200) this.bins.shift();
    }
  }
  at(end: number) {
    const bin = this.bins.find((b) => end >= b.start && end <= b.end);
    return bin ? bin.observed - (bin.end - end) * 1000 : null;
  }
}

/** Retains exact failed finals for explicit retry; Session still owns the writer
 * and contiguous authority. Display grouping never participates in admission. */
export class RealtimeIngress {
  readonly run = `speechmatics:${crypto.randomUUID()}`;
  readonly clock = new AudioObservationClock();
  readonly pending = new Map<string, Omit<Evidence, "sequence">>();
  private inFlight = new Set<Promise<void>>();
  private adapter: SpeechEvidenceAdapter;
  constructor(
    private session: Session,
    private failed: (reason: string) => void,
  ) {
    this.adapter = new SpeechEvidenceAdapter(this.run, (e) => {
      const previous = this.pending.get(e.id);
      if (
        previous &&
        (previous.text !== e.text || previous.source !== e.source)
      )
        return Promise.reject(new Error("evidence-identity-collision"));
      const original = previous ?? e;
      this.pending.set(e.id, original);
      return this.admit(original);
    });
  }
  private async admit(e: Omit<Evidence, "sequence">) {
    await this.session.commitEvidence(e);
    this.pending.delete(e.id);
  }
  receive(message: SpeechMessage) {
    if (!message.metadata.transcript.trim()) {
      this.session.trace.mark("speech-empty-message", {
        run: this.run,
        message: message.message,
      });
      return;
    }
    const receivedAt = performance.now(),
      audioAt = this.clock.at(message.metadata.end_time);
    const source = JSON.stringify([
      message.metadata.start_time,
      message.metadata.end_time,
      message.channel ?? "",
    ]);
    const evidenceId = JSON.stringify([this.run, source]);
    const partial = message.message === "AddPartialTranscript";
    const segmentId = JSON.stringify([
      this.run,
      message.metadata.start_time,
      message.channel ?? "",
    ]);
    if (audioAt !== null)
      this.session.trace.mark(
        "audio-observed",
        {
          run: this.run,
          evidenceId,
          segmentId,
          mapping: "sample-count/observation",
          uncertaintyMs: 100,
        },
        audioAt,
        undefined,
        audioAt,
      );
    this.session.trace.mark(
      partial ? "speech-partial" : "speech-final",
      {
        run: this.run,
        evidenceId,
        segmentId,
        source,
        providerStart: message.metadata.start_time,
        providerEnd: message.metadata.end_time,
        audioObservedAt: audioAt,
        audioBoundary: "interval-end",
        mappingUncertaintyMs: 100,
      },
      receivedAt,
      undefined,
      receivedAt,
    );
    if (partial && audioAt !== null)
      this.session.trace.mark(
        "audio-to-partial",
        { run: this.run, evidenceId },
        audioAt,
      );
    const work = this.adapter
      .receive(message, audioAt)
      .catch((error) => {
        this.failed(
          error instanceof Error ? error.message : "speech-admission-failed",
        );
      })
      .finally(() => this.inFlight.delete(work));
    this.inFlight.add(work);
  }
  async settled() {
    await Promise.all(this.inFlight);
  }
  async retry() {
    await this.settled();
    for (const e of this.pending.values()) await this.admit(e);
  }
}

export class Microphone {
  private client: RealtimeClient | null = null;
  private recorder: PCMRecorder | null = null;
  private context: AudioContext | null = null;
  private ingress: RealtimeIngress | null = null;
  status = "idle";
  error: string | null = null;
  constructor(
    private session: Session,
    private changed: () => void,
  ) {}
  get audioSeconds() {
    return this.ingress?.clock.seconds ?? 0;
  }
  get pendingCount() {
    return this.ingress?.pending.size ?? 0;
  }
  private fail = (reason: string) => {
    this.error = reason;
    this.recorder?.stopRecording();
    this.status = "failed";
    this.session.trace.mark("speech-failure", { reason });
    this.changed();
  };
  async start() {
    if (!["idle", "stopped"].includes(this.status) || this.pendingCount)
      throw new Error("speech-run-not-drained");
    this.status = "starting";
    this.error = null;
    this.changed();
    this.context = new AudioContext();
    const activated = this.context.resume(); // Begin activation in the user's gesture.
    try {
      await activated;
      const response = await fetch("/api/v2/speech-token", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("speech-token-unavailable");
      const { token } = await response.json();
      const client = (this.client = new RealtimeClient());
      const ingress = (this.ingress = new RealtimeIngress(
        this.session,
        this.fail,
      ));
      client.addEventListener("receiveMessage", ({ data }) => {
        if (
          data.message === "AddTranscript" ||
          data.message === "AddPartialTranscript"
        )
          ingress.receive(data);
        if (data.message === "Error") this.fail(`speech-provider:${data.type}`);
      });
      client.addEventListener("socketStateChange", () => {
        if (client.socketState === "closed" && this.status === "listening")
          this.fail("speech-disconnected");
      });
      const configuration = speechConfiguration(this.context.sampleRate);
      this.session.trace.mark("speech-config", {
        run: ingress.run,
        configuration,
        endpoint: client.url,
      });
      await client.start(token, configuration);
      this.recorder = new PCMRecorder(workletUrl);
      this.recorder.addEventListener("audio", ({ data }) => {
        try {
          client.sendAudio(data as Float32Array<ArrayBuffer>); // Provider handoff ALWAYS precedes diagnostics.
          ingress.clock.observe(data.length, this.context!.sampleRate);
        } catch {
          this.fail("speech-audio-send");
        }
      });
      await this.recorder.startRecording({ audioContext: this.context });
      this.status = "listening";
      this.session.trace.mark("microphone-started", { run: ingress.run });
      this.changed();
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error.name === "NotAllowedError"
            ? "microphone-permission-denied"
            : error.message
          : "microphone-unavailable",
      );
      if (this.client?.socketState === "open")
        await this.client.stopRecognition().catch(() => {});
      await this.context.close();
    }
  }
  async stop(finalize = true) {
    const wasListening = this.status === "listening";
    this.recorder?.stopRecording();
    this.status = "draining";
    this.changed();
    try {
      if (this.client?.socketState === "open")
        await this.client.stopRecognition();
      await this.ingress?.settled();
      if (this.pendingCount) throw new Error("speech-undurable-tail");
      this.status = "stopped";
      this.session.trace.mark("speech-drained", {
        audioSeconds: this.audioSeconds,
        pendingCount: this.pendingCount,
      });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "speech-stop-failed");
    } finally {
      if (this.context?.state !== "closed") await this.context?.close();
      this.changed();
    }
    if (finalize && wasListening && this.status === "stopped") {
      try {
        await this.session.finish();
      } catch (error) {
        this.session.error =
          error instanceof Error ? error.message : "final-drain-failed";
        this.session.trace.mark("final-drain-failed", {
          reason: this.session.error,
        });
      }
      this.changed();
    }
  }
  async retry() {
    await this.ingress?.retry();
    this.error = null;
    await this.stop();
    this.session.resume();
    this.changed();
  }
  forceFinal() {
    this.client?.forceEndOfUtterance();
  }
}
