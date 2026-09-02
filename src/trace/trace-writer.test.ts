import { describe, expect, it, vi } from "vitest";
import { prepareDurableTraceEvent, type DurableTraceEventDraft } from "./durable-trace";
import { TraceWriter, type TraceWriterSnapshot } from "./trace-writer";

const draft = (id: string): DurableTraceEventDraft => ({ id, stage: "session", type: "test", payload: {}, source: "browser" });

describe("bounded trace writer", () => {
  it("retries an older failed event before a later event and is healthy only after both are durable", async () => {
    const written: string[] = []; const states: TraceWriterSnapshot[] = []; let attempt = 0;
    const writer = new TraceWriter(async (drafts) => {
      attempt += 1;
      if (attempt === 1) throw new Error("indexeddb-temporary-failure");
      written.push(...drafts.map((event) => event.id));
      return drafts.map((event, index) => prepareDurableTraceEvent("session-writer", { ...event, sourceInstanceId: "page", sourceSeq: index + 1 }));
    }, { retryDelayMs: 60_000, onState: (state) => states.push(state) });
    writer.enqueue([draft("event-100")]);
    await expect(writer.flush()).rejects.toThrow("indexeddb-temporary-failure");
    expect(writer.snapshot).toMatchObject({ status: "degraded", pendingCount: 1 });
    writer.enqueue([draft("event-101")]);
    await writer.flush();
    expect(written).toEqual(["event-100", "event-101"]);
    expect(writer.snapshot).toMatchObject({ status: "healthy", pendingCount: 0 });
    expect(states.some((state) => state.pendingCount > 0 && state.status === "healthy")).toBe(false);
    writer.close();
  });

  it("bounds memory under persistent failure and reports dropped evidence", async () => {
    const write = vi.fn(async () => { throw new Error("quota-exceeded"); });
    const writer = new TraceWriter(write, { maxPending: 3, maxFailures: 1, retryDelayMs: 60_000 });
    writer.enqueue([draft("1"), draft("2"), draft("3"), draft("4"), draft("5")]);
    await expect(writer.flush()).rejects.toThrow("trace disabled after 1 write failures");
    expect(writer.snapshot).toMatchObject({ status: "degraded", pendingCount: 0, droppedCount: 5 });
    expect(writer.snapshot.error).toContain("trace disabled after 1 write failures");
    writer.enqueue([draft("6")]);
    expect(writer.snapshot).toMatchObject({ pendingCount: 0, droppedCount: 6 });
    writer.close();
  });
});
