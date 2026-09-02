export type LocalSoundCheckState = { status: "idle" | "capturing" | "ready"; sampleCount: number; sampleRate?: number };

/** A five-second, browser-memory-only diagnostic capture. It is intentionally not serializable. */
export class LocalSoundCheck {
  private chunks: Float32Array[] = [];
  private limit = 0;
  private count = 0;
  private sampleRate?: number;
  private active = false;

  get state(): LocalSoundCheckState {
    return { status: this.active ? "capturing" : this.count ? "ready" : "idle", sampleCount: this.count, sampleRate: this.sampleRate };
  }

  start(sampleRate: number, seconds = 5) {
    this.close();
    this.sampleRate = sampleRate;
    this.limit = Math.max(1, Math.round(sampleRate * seconds));
    this.active = true;
  }

  observe(audio: Float32Array) {
    if (!this.active) return false;
    const remaining = this.limit - this.count;
    if (remaining <= 0) { this.active = false; return true; }
    this.chunks.push(audio.slice(0, remaining));
    this.count += Math.min(audio.length, remaining);
    if (this.count >= this.limit) this.active = false;
    return !this.active;
  }

  play(audioContext: AudioContext) {
    if (!this.count || !this.sampleRate) return;
    const buffer = audioContext.createBuffer(1, this.count, this.sampleRate);
    const destination = buffer.getChannelData(0);
    let offset = 0;
    for (const chunk of this.chunks) { destination.set(chunk, offset); offset += chunk.length; }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
  }

  close() {
    this.chunks = [];
    this.limit = 0;
    this.count = 0;
    this.sampleRate = undefined;
    this.active = false;
  }
}
