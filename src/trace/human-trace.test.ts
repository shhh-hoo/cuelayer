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

  it("keeps overlapping A and B planner chains separated by correlation rather than chronology", () => {
    const withCorrelation = (id: string, type: string, correlation: DurableTraceEvent["correlation"]): DurableTraceEvent => ({ ...event(id, type, {}), correlation });
    const moments = teachingMoments([
      withCorrelation("1", "asr.final", { commitId: "commit-a", finalId: "final-a", spanId: "span-a", spanRevision: 1 }),
      withCorrelation("2", "planner.started", { commitId: "commit-a", spanId: "span-a", spanRevision: 1, plannerRequestId: "planner-a" }),
      withCorrelation("3", "asr.final", { commitId: "commit-b", finalId: "final-b", spanId: "span-b", spanRevision: 1 }),
      withCorrelation("4", "planner.started", { commitId: "commit-b", spanId: "span-b", spanRevision: 1, plannerRequestId: "planner-b" }),
      withCorrelation("5", "api_call.completed", { plannerRequestId: "planner-a", apiRequestId: "api-a" }),
      withCorrelation("6", "api_call.completed", { plannerRequestId: "planner-b", apiRequestId: "api-b" }),
      withCorrelation("7", "render.activated", { commitId: "commit-a", spanId: "span-a", spanRevision: 1, cueId: "cue-a" }),
      withCorrelation("8", "render.activated", { commitId: "commit-b", spanId: "span-b", spanRevision: 1, cueId: "cue-b" }),
    ]);
    expect(moments).toHaveLength(2);
    expect(moments.find((moment) => moment.id === "commit:commit-a")?.rawEvents.map((item) => item.id)).toEqual(["1", "2", "5", "7"]);
    expect(moments.find((moment) => moment.id === "commit:commit-b")?.rawEvents.map((item) => item.id)).toEqual(["3", "4", "6", "8"]);
  });

  it("leaves unrelated ASR churn uncorrelated while an earlier planner times out", () => {
    const moments = teachingMoments([
      { ...event("1", "planner.started", {}), correlation: { commitId: "commit-a", plannerRequestId: "planner-a" } },
      { ...event("2", "asr.partial", { transcript: "B revision" }), correlation: { speechEventId: "speech-b" } },
      { ...event("3", "api_call.timed_out", {}), correlation: { plannerRequestId: "planner-a", apiRequestId: "api-a" } },
    ]);
    expect(moments).toHaveLength(2);
    expect(moments.find((moment) => moment.id === "commit:commit-a")?.rawEvents.map((item) => item.id)).toEqual(["1", "3"]);
    expect(moments.find((moment) => moment.id === "uncorrelated:2")?.partialCount).toBe(1);
  });
});
