import { describe, expect, it, vi } from "vitest";
import { traceDraft, type SessionTraceEvent } from "./contracts";
import { TraceWriter } from "./writer";

function writerFor(writeBatch: (events: readonly SessionTraceEvent[]) => Promise<void>, options: ConstructorParameters<typeof TraceWriter>[3] = {}) {
  return new TraceWriter("session-writer-test", "browser-writer-test", writeBatch, { flushIntervalMs: 60_000, ...options });
}

describe("batched trace writer", () => {
  it("does not write per event and flushes multiple facts in one transaction batch", async () => {
    const writes: SessionTraceEvent[][] = [];
    const writer = writerFor(async (events) => { writes.push([...events]); });
    writer.emit(traceDraft("session.ended", { reason: "one" }));
    writer.emit(traceDraft("teaching_cue.expired", { cueId: "two" }));
    expect(writes).toEqual([]);
    await writer.flush();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.map((event) => event.type)).toEqual(["session.ended", "teaching_cue.expired"]);
    writer.close();
  });

  it("coalesces rapid partial revisions before persistence", async () => {
    const written: SessionTraceEvent[] = [];
    const writer = writerFor(async (events) => { written.push(...events); });
    writer.emit(traceDraft("speech.partial", { runId: 1, transcript: "acti", wordCount: 1 }));
    writer.emit(traceDraft("speech.partial", { runId: 1, transcript: "activation", wordCount: 1 }));
    writer.emit(traceDraft("speech.partial", { runId: 1, transcript: "activation energy", wordCount: 2 }));
    await writer.flush();
    const partials = written.filter((event) => event.type === "speech.partial");
    expect(partials).toHaveLength(1);
    expect(partials[0]?.payload).toMatchObject({ transcript: "activation energy", coalescedRevisions: 2 });
    writer.close();
  });

  it("keeps failed batches pending and succeeds on an explicit retry", async () => {
    let attempt = 0;
    const write = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("indexeddb-temporary-failure");
    });
    const writer = writerFor(write);
    writer.emit(traceDraft("session.ended", { reason: "retry" }));
    await expect(writer.flush()).rejects.toThrow("indexeddb-temporary-failure");
    expect(writer.snapshot).toMatchObject({ status: "degraded", pendingCount: 1, consecutiveFailures: 1 });
    await writer.flush();
    expect(writer.snapshot).toMatchObject({ status: "healthy", pendingCount: 0, consecutiveFailures: 0 });
    writer.close();
  });

  it("bounds queue pressure and persists an explicit gap fact", async () => {
    const written: SessionTraceEvent[] = [];
    const writer = writerFor(async (events) => { written.push(...events); }, { batchSize: 2, maxPending: 3 });
    for (let runId = 1; runId <= 5; runId += 1) writer.emit(traceDraft("speech.partial", { runId, transcript: `revision ${runId}`, wordCount: 2 }));
    expect(writer.snapshot).toMatchObject({ pendingCount: 3, droppedCount: 2 });
    await writer.flush();
    const gap = written.find((event) => event.type === "trace.gap");
    expect(gap?.payload).toMatchObject({ reason: "queue_pressure", dropped: { "speech.partial": 2 } });
    writer.close();
  });
});
