/** Bounded metadata only: never retains PCM or inserts work before official transport. */
export class PcmLatencyClock {
  private endMs = 0;
  private chunks: Array<{ startMs: number; endMs: number; deliveredAt: number }> = [];
  observe(sampleCount: number, sampleRate: number, deliveredAt: number) {
    if (!sampleCount || !sampleRate) return;
    const startMs = this.endMs; this.endMs += sampleCount / sampleRate * 1000;
    this.chunks.push({ startMs, endMs: this.endMs, deliveredAt });
    if (this.chunks.length > 512) this.chunks.shift();
  }
  resolve(endMs: number) {
    const chunk = this.chunks.find(c => endMs >= c.startMs && endMs <= c.endMs);
    return chunk ? { speechObservedAt: chunk.deliveredAt - (chunk.endMs - endMs), speechMappingUncertaintyMs: chunk.endMs - chunk.startMs, speechClockBasis: "pcm-delivery-observation" as const } : { speechObservedAt: null, speechMappingUncertaintyMs: null, speechClockBasis: "unavailable" as const };
  }
}
