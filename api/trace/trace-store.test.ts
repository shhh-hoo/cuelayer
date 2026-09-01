import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareDurableTraceEvent } from "../../src/trace/durable-trace";

describe("Neon Session Event Store contract", () => {
  it("defines sessions, idempotent event IDs, time separation, and query indexes", () => {
    const migration = readFileSync(resolve("db/migrations/001_session_event_store.sql"), "utf8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS teaching_sessions");
    expect(migration).toContain("event_id TEXT NOT NULL UNIQUE");
    expect(migration).toContain("occurred_at TIMESTAMPTZ NOT NULL");
    expect(migration).toContain("ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()");
    expect(migration).toContain("trace_events_session_occurred_idx");
  });
  it("keeps occurrence time and browser source sequence separate from ingestion", () => {
    const event = prepareDurableTraceEvent("session-store-test", { id: "browser:event-store-1", occurredAt: "2026-09-01T10:00:00.000Z", stage: "speechmatics", type: "asr.partial", source: "browser", sourceInstanceId: "page-1", sourceSeq: 42, payload: { transcript: "exact revision" } });
    expect(event).toMatchObject({ occurredAt: "2026-09-01T10:00:00.000Z", sourceInstanceId: "page-1", sourceSeq: 42 });
    expect(event.ingestedAt).toBeUndefined();
  });
});
