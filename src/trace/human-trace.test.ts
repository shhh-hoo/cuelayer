import { describe, expect, it } from "vitest";
import { teachingMoments } from "./human-trace";
import type { DurableTraceEvent } from "./durable-trace";

const event = (id: string, type: string, payload: unknown): DurableTraceEvent => ({ id, sessionId: "session-human-trace", schemaVersion: 1, occurredAt: `2026-09-01T10:00:0${id}.000Z`, stage: type.startsWith("asr") ? "speechmatics" : type.startsWith("commit") ? "commit" : "planner", type, payload, source: "browser", sourceInstanceId: "page", sourceSeq: Number(id), correlation: { commitId: "commit-1" } });

describe("deterministic Human Trace", () => {
  it("collapses ASR churn into a teaching moment while retaining raw evidence", () => {
    const moments = teachingMoments([event("1", "asr.partial", { transcript: "rate of" }), event("2", "asr.partial", { transcript: "rate of reaction" }), event("3", "asr.final", { transcript: "rate of reaction increases" }), event("4", "commit.committed", { transcript: "rate of reaction increases" }), event("5", "planner.started", {})]);
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ partialCount: 2, speech: "rate of reaction increases", commit: { type: "commit.committed" }, planner: { type: "planner.started" } });
    expect(moments[0]?.rawEvents).toHaveLength(5);
  });
});
