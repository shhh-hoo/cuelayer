import type { Evidence } from "../contract";
import { codePointBoundary } from "../source";
export type SpeechMessage = {
  message: "AddPartialTranscript" | "AddTranscript" | "EndOfUtterance";
  metadata: { transcript: string; start_time: number; end_time: number };
  channel?: string;
  results?: {
    type: string;
    start_time?: number;
    end_time?: number;
    alternatives?: { content: string }[];
  }[];
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
      ...providerAlignment(message),
    });
    this.preparation = null;
  }
  preflight() {
    if (this.preparation)
      this.preparation = { ...this.preparation, stability: "PREFLIGHT" };
  }
}

/** Use only alignment recoverable exactly from actual provider tokens; never reconstruct text. */
export function providerAlignment(
  message: SpeechMessage,
): Pick<Evidence, "alignment"> {
  if (!message.results?.length) return {};
  const text = message.metadata.transcript,
    cuts = new Set([0, text.length]);
  let at = 0,
    lastTime = message.metadata.start_time;
  for (const result of message.results) {
    const token = result.alternatives?.[0]?.content;
    if (!token) return {};
    const start = text.indexOf(token, at);
    if (
      start < 0 ||
      text.slice(at, start).trim() ||
      !codePointBoundary(text, start) ||
      !codePointBoundary(text, start + token.length)
    )
      return {};
    if (result.type === "word") {
      if (
        !Number.isFinite(result.start_time) ||
        !Number.isFinite(result.end_time) ||
        result.start_time! < lastTime ||
        result.end_time! < result.start_time! ||
        result.end_time! > message.metadata.end_time
      )
        return {};
      lastTime = result.end_time!;
    }
    cuts.add(start);
    cuts.add(start + token.length);
    at = start + token.length;
  }
  if (text.slice(at).trim()) return {};
  return {
    alignment: {
      version: "speechmatics-words-1",
      boundaries: [...cuts].sort((a, b) => a - b),
    },
  };
}
