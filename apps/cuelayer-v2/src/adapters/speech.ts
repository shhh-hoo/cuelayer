import type { Evidence } from "../contract";
export type SpeechMessage = {
  message: "AddPartialTranscript" | "AddTranscript" | "EndOfUtterance";
  metadata: { transcript: string; start_time: number; end_time: number };
  channel?: string;
};
export type Preparation = {
  stability: "VOLATILE" | "PREFLIGHT";
  text: string;
  source: string;
};
/** Provider interval + channel scoped by durable run; never text similarity or rounded timestamps. */
export class SpeechEvidenceAdapter {
  preparation: Preparation | null = null;
  constructor(
    readonly run: string,
    private commit: (e: Omit<Evidence, "sequence">) => Promise<void>,
  ) {}
  async receive(message: SpeechMessage, audioObservedAt: number | null = null) {
    const { metadata: m } = message;
    if (
      !Number.isFinite(m.start_time) ||
      !Number.isFinite(m.end_time) ||
      m.end_time < m.start_time
    )
      throw new Error("invalid-provider-interval");
    const source = JSON.stringify([
      m.start_time,
      m.end_time,
      message.channel ?? "",
    ]);
    if (message.message === "EndOfUtterance") return; // A silence signal cannot make partial text immutable.
    if (message.message === "AddPartialTranscript") {
      this.preparation = { stability: "VOLATILE", text: m.transcript, source };
      return;
    }
    if (!m.transcript.trim()) throw new Error("empty-final");
    await this.commit({
      id: JSON.stringify([this.run, source]),
      run: this.run,
      source,
      text: m.transcript,
      start: m.start_time,
      end: m.end_time,
      receivedAt: performance.now(),
      audioObservedAt,
      stability: "COMMITTED",
    });
    this.preparation = null;
  }
  preflight() {
    if (this.preparation)
      this.preparation = { ...this.preparation, stability: "PREFLIGHT" };
  }
}
