import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraceOutbox } from "./outbox";
import type { TraceTransport } from "./trace-client";

const sessionId = "session-outbox-test";
const capability = { writeCapability: "w".repeat(43), readCapability: "r".repeat(43) };
const draft = (id: string) => ({ id, occurredAt: "2026-09-01T10:00:00.000Z", stage: "speechmatics" as const, type: "asr.partial", source: "browser" as const, payload: { transcript: id } });

describe("IndexedDB trace outbox", () => {
  beforeEach(() => { Object.assign(globalThis, { indexedDB: new IDBFactory() }); });

  it("retains browser events after an ingestion failure and flushes them after recovery", async () => {
    const first = await TraceOutbox.open();
    await first.saveSession({ sessionId, sourceInstanceId: "page-a", nextSeq: 1, ...capability });
    await first.enqueue(sessionId, [draft("browser:outbox-1")], "page-a");
    const unavailable: TraceTransport = { createSession: vi.fn(), load: vi.fn(), append: vi.fn().mockRejectedValue(new Error("network-down")) };
    await expect(first.flush(sessionId, unavailable)).rejects.toThrow("network-down");
    expect(await first.pendingCount(sessionId)).toBe(1);

    const reopened = await TraceOutbox.open();
    const recovered: TraceTransport = { createSession: vi.fn(), load: vi.fn(), append: vi.fn(async (_id, _capability, events) => events) };
    expect(await reopened.flush(sessionId, recovered)).toMatchObject({ pending: 0 });
    expect(recovered.append).toHaveBeenCalledWith(sessionId, capability.writeCapability, [expect.objectContaining({ id: "browser:outbox-1", sourceSeq: 1 })]);
    expect(await reopened.pendingCount(sessionId)).toBe(0);
  });

  it("uploads bounded batches and never duplicates an acknowledged retry", async () => {
    const outbox = await TraceOutbox.open();
    await outbox.saveSession({ sessionId, sourceInstanceId: "page-a", nextSeq: 1, ...capability });
    await outbox.enqueue(sessionId, Array.from({ length: 51 }, (_, index) => draft(`browser:batch-${index}`)), "page-a");
    const transport: TraceTransport = { createSession: vi.fn(), load: vi.fn(), append: vi.fn(async (_id, _capability, events) => events) };
    await outbox.flush(sessionId, transport);
    await outbox.flush(sessionId, transport);
    expect(transport.append).toHaveBeenCalledTimes(2);
    expect((transport.append as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]).toHaveLength(50);
    expect((transport.append as ReturnType<typeof vi.fn>).mock.calls[1]?.[2]).toHaveLength(1);
    expect(await outbox.pendingCount(sessionId)).toBe(0);
  });
});
