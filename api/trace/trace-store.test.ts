import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendTraceEvents, listRecentTraceSessions, readTraceEvents } from "./trace-store";

describe("local durable trace store", () => {
  let directory = "";
  const prior = { trace: process.env.CUELAYER_TRACE_DIR, vercel: process.env.VERCEL, blob: process.env.BLOB_READ_WRITE_TOKEN, oidc: process.env.VERCEL_OIDC_TOKEN, store: process.env.BLOB_STORE_ID };

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "cuelayer-trace-test-"));
    process.env.CUELAYER_TRACE_DIR = directory;
    delete process.env.VERCEL;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.BLOB_STORE_ID;
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries({ CUELAYER_TRACE_DIR: prior.trace, VERCEL: prior.vercel, BLOB_READ_WRITE_TOKEN: prior.blob, VERCEL_OIDC_TOKEN: prior.oidc, BLOB_STORE_ID: prior.store })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it("survives the former 160-event boundary and reloads from storage in order", async () => {
    const sessionId = "session-persistence-test";
    const drafts = Array.from({ length: 205 }, (_, index) => ({
      id: `browser:event-${String(index).padStart(4, "0")}`,
      timestamp: new Date(1_800_000_000_000 + index).toISOString(),
      stage: "speechmatics" as const,
      type: index === 204 ? "asr.final" : "asr.partial",
      correlation: { speechEventId: `provider-event-${index}` },
      payload: { transcript: `revision ${index}` },
      source: "browser" as const,
    }));
    await appendTraceEvents(sessionId, drafts);

    const firstReload = await readTraceEvents(sessionId);
    const recreatedUiReload = await readTraceEvents(sessionId);
    expect(firstReload).toHaveLength(205);
    expect(recreatedUiReload.map((event) => event.payload)).toEqual(firstReload.map((event) => event.payload));
    expect(recreatedUiReload[0]?.type).toBe("asr.partial");
    expect(recreatedUiReload.at(-1)?.type).toBe("asr.final");
    expect(await listRecentTraceSessions()).toContain(sessionId);
  });

  it("is idempotent for an identical event id and rejects an attempted rewrite", async () => {
    const sessionId = "session-append-only-test";
    const draft = { id: "browser:append-only-1", timestamp: "2026-01-01T00:00:00.000Z", stage: "session" as const, type: "session.started", payload: { value: 1 }, source: "browser" as const };
    await appendTraceEvents(sessionId, [draft]);
    await appendTraceEvents(sessionId, [draft]);
    expect(await readTraceEvents(sessionId)).toHaveLength(1);
    await expect(appendTraceEvents(sessionId, [{ ...draft, payload: { value: 2 } }])).rejects.toThrow("trace-event-id-conflict");
  });
});
