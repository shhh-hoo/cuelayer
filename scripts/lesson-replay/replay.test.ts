import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { runReplay, type TimelineRow } from "./runner.ts";
import { mockInterpreter } from "./provider.ts";
import { loadInput, splitSegments, bytesHash, type Segment } from "./input.ts";
import { buildReport, serializeEvidence } from "./report.ts";
import { replayLessonEvents } from "../../src/lesson-stream/replay.ts";
import type { TeachingInterpretationRequest } from "../../src/lesson-stream/contracts.ts";

const input = () => loadInput(resolve("resources/lesson-replay/synthetic/manifest.json"));
const captured = () => { const rows: TimelineRow[] = []; return { rows, onTimeline: (row: TimelineRow) => rows.push(row) }; };
function options(extra: Partial<Parameters<typeof runReplay>[0]> = {}) {
  const loaded = input();
  return { lessonId: loaded.manifest.lessonId, segments: loaded.segments, timelineOriginMs: 10000, mode: "realtime" as const,
    interpreter: mockInterpreter([], 200), model: "mock", maxAttempts: 30, maxRuntimeMs: 60000, onTimeline: () => {}, ...extra };
}
function fakeTime() { vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] }); }
afterEach(() => vi.useRealTimers());

describe("production-module transcript replay", () => {
  it.each(["sequential", "realtime"] as const)("%s consumes exactly once and never exposes future text", async mode => {
    fakeTime(); const trace = captured();
    const resultPromise = runReplay(options({ mode, onTimeline: trace.onTimeline }));
    await vi.advanceTimersByTimeAsync(2000); const result = await resultPromise;
    expect(result.status).toBe("completed"); expect(result.pendingEvidenceIds).toEqual([]);
    const consumed = trace.rows.filter(r => r.type === "step.accepted").flatMap(r => r.consumedEvidenceIds as string[]);
    expect(consumed).toHaveLength(3); expect(new Set(consumed).size).toBe(3);
    const arrived = new Set<string>();
    for (const row of trace.rows) {
      if (row.type === "evidence.arrived") (row.arrivedEvidenceIds as string[]).forEach(id => arrived.add(id));
      if (row.type === "request.started") {
        const request = row.request as TeachingInterpretationRequest;
        expect(request.newEvidence.every(c => arrived.has(c.checkpointId))).toBe(true);
        expect(request.processedTimeline.every(e => e.type !== "evidence" || arrived.has(e.checkpointId))).toBe(true);
        expect(request.newEvidence.length).toBeLessThanOrEqual(2);
        expect(JSON.stringify(request)).not.toContain("referenceAnswer");
      }
    }
    const firstRequest = trace.rows.find(r => r.type === "request.started")!.request as TeachingInterpretationRequest;
    expect(JSON.stringify(firstRequest)).not.toContain(input().segments[1]!.text);
    expect(result.replayMatches).toBe(true);
    const firstComplete = trace.rows.findIndex(r => r.type === "request.completed");
    const secondArrival = trace.rows.findIndex(r => r.type === "evidence.arrived" && (r.segment as Segment).segmentId === "s2");
    expect(mode === "realtime" ? secondArrival < firstComplete : secondArrival > firstComplete).toBe(true);
  });

  it("separates media, availability, wall, request and accepted time", async () => {
    fakeTime(); const trace = captured(); const promise = runReplay(options({ onTimeline: trace.onTimeline }));
    await vi.advanceTimersByTimeAsync(2000); await promise;
    const arrivals = trace.rows.filter(r => r.type === "evidence.arrived");
    expect(arrivals.map(r => r.evidenceAvailableAtMs)).toEqual([10020, 10060, 10100]);
    expect(arrivals.map(r => r.arrivalTimeMs)).toEqual([20, 60, 100]);
    expect(trace.rows.find(r => r.type === "step.accepted")!.acceptedTimeMs).toBeGreaterThan(100);
    expect(arrivals[0]!.wallTime).toMatch(/^\d{4}-/);
  });

  it.each(["provider-failure", "timeout"] as const)("preserves all pending after bounded %s and reports every failure", async outcome => {
    fakeTime(); const trace = captured();
    const promise = runReplay(options({ interpreter: mockInterpreter([{ outcome }, { outcome }, { outcome }]), onTimeline: trace.onTimeline }));
    await vi.advanceTimersByTimeAsync(30000); const result = await promise;
    expect(result.status).toBe("paused"); expect(result.attempts).toBe(3); expect(result.pendingEvidenceIds).toHaveLength(3);
    const failures = trace.rows.filter(r => r.type === "request.failed"); expect(failures).toHaveLength(3);
    expect(failures.every(r => r.category === (outcome === "timeout" ? "timeout" : "provider"))).toBe(true);
    const requests = trace.rows.filter(r => r.type === "request.started").map(r => (r.request as TeachingInterpretationRequest).newEvidence.map(c => c.checkpointId));
    expect(requests[1]).toEqual(requests[0]); expect(requests[2]).toEqual(requests[0]);
    expect(trace.rows.filter(r => r.type === "step.accepted")).toHaveLength(0);
    const report = buildReport(result, trace.rows, "mock", "realtime");
    expect(report).toContain("failed/blocked attempts: 3"); expect(report).toContain("pending: 3");
  });

  it("recovers preserved evidence using the production retry/backoff", async () => {
    fakeTime(); const trace = captured(); const promise = runReplay(options({ interpreter: mockInterpreter([{ outcome: "provider-failure" }]), onTimeline: trace.onTimeline }));
    await vi.advanceTimersByTimeAsync(5000); const result = await promise;
    expect(result.status).toBe("completed"); expect(result.pendingEvidenceIds).toHaveLength(0);
    const consumed = trace.rows.filter(r => r.type === "step.accepted").flatMap(r => r.consumedEvidenceIds as string[]);
    expect(new Set(consumed).size).toBe(3); expect(trace.rows.filter(r => r.type === "request.failed")).toHaveLength(1);
  });

  it.each(["time-limit", "attempt-limit", "cancelled", "budget"])("writes partial evidence on %s without pretending input was KEEP", async kind => {
    fakeTime(); const trace = captured(); const abort = new AbortController();
    const overrides = kind === "time-limit" ? { maxRuntimeMs: 80 } : kind === "attempt-limit" ? { maxAttempts: 1 } : kind === "budget" ? { segments: [{ ...input().segments[0]!, text: "x".repeat(50000) }] } : {};
    const promise = runReplay(options({ ...overrides, signal: abort.signal, onTimeline: trace.onTimeline }));
    await vi.advanceTimersByTimeAsync(80); if (kind === "cancelled") abort.abort();
    await vi.advanceTimersByTimeAsync(2000); const result = await promise;
    expect(result.status).toBe(kind === "budget" ? "paused" : kind); expect(result.pendingEvidenceIds.length).toBeGreaterThan(0);
    if (kind === "time-limit" || kind === "cancelled") expect(result.remainingInput.length).toBeGreaterThan(0);
    expect(trace.rows.at(-1)!.type).toBe("run.finished");
  });

  it("does not deliver far-future subtitles when a platform timer would overflow", async () => {
    fakeTime(); const trace = captured();
    const promise = runReplay(options({ segments: [{ ...input().segments[0]!, availableAtMs: 2 ** 32 }], maxRuntimeMs: 100, onTimeline: trace.onTimeline }));
    await vi.advanceTimersByTimeAsync(1000); const result = await promise;
    expect(result.status).toBe("time-limit"); expect(result.delivered).toBe(0); expect(result.attempts).toBe(0); expect(result.remainingInput).toHaveLength(1);
  });

  it("stops sequential input on validation pause and reports undelivered segments", async () => {
    fakeTime(); const promise = runReplay(options({ mode: "sequential", interpreter: mockInterpreter([{ outcome: "invalid" }]) }));
    await vi.advanceTimersByTimeAsync(1000); const result = await promise;
    expect(result.status).toBe("paused"); expect(result.attempts).toBe(1); expect(result.delivered).toBe(1); expect(result.remainingInput).toHaveLength(2);
  });

  it("replays persisted accepted events deterministically without interpreter calls", async () => {
    fakeTime(); const provider = mockInterpreter(); const spy = vi.spyOn(provider, "interpret");
    const promise = runReplay(options({ interpreter: provider })); await vi.advanceTimersByTimeAsync(2000); const result = await promise;
    const calls = spy.mock.calls.length; const persisted = JSON.parse(serializeEvidence(result.lessonEvents));
    expect(replayLessonEvents(persisted).state).toEqual(result.state); expect(replayLessonEvents(persisted).state).toEqual(replayLessonEvents(persisted).state);
    expect(spy).toHaveBeenCalledTimes(calls);
  });
});

describe("input provenance and safe output", () => {
  it.each(["original", "sentence", "phrase"] as const)("%s splitting preserves raw text/IDs and never fabricates earlier availability", strategy => {
    const loaded = input(); const segments = splitSegments(loaded.segments, strategy);
    for (const original of loaded.segments) {
      const parts = segments.filter(s => (s.parentSegmentId ?? s.segmentId) === original.segmentId);
      expect(parts.map(s => s.text).join("")).toBe(original.text);
      expect(parts.every(s => s.availableAtMs === original.endMs && JSON.stringify(s.originalSegmentIds) === JSON.stringify(original.originalSegmentIds))).toBe(true);
      if (strategy !== "original") expect(parts.every(s => s.timingSynthetic)).toBe(true);
    }
  });
  it("rejects hash mismatches and subtitles available before their end", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "lesson-input-"));
    try {
      const manifest = input().manifest; const segments = input().segments;
      writeFileSync(resolve(dir, "raw.jsonl"), readFileSync(input().rawPath));
      segments[0]!.availableAtMs = segments[0]!.startMs;
      const text = segments.map(s => JSON.stringify(s)).join("\n"); writeFileSync(resolve(dir, "segments.jsonl"), text);
      const path = resolve(dir, "manifest.json"); writeFileSync(path, JSON.stringify(manifest)); expect(() => loadInput(path)).toThrow("input-hash-mismatch");
      manifest.normalized.sha256 = bytesHash(text); writeFileSync(path, JSON.stringify(manifest));
      expect(() => loadInput(path)).toThrow("invalid-segment-time");
    } finally { rmSync(dir, { recursive: true }); }
  });
  it("refuses configured CLI use without explicit authorization and budgets", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "lesson-opt-in-"));
    try {
      const out = resolve(dir, "run");
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/evaluate-lesson-replay.ts", "--input", "resources/lesson-replay/synthetic/manifest.json", "--provider", "configured", "--out", out], { encoding: "utf8", env: { ...process.env, OPENAI_API_KEY: "" } });
      expect(result.status).toBe(1);
      expect(readFileSync(resolve(out, "failure.json"), "utf8")).toContain("configured-provider-requires-explicit-opt-in-key-and-both-budgets");
      expect(readFileSync(resolve(out, "report.md"), "utf8")).toContain("No unprocessed input is counted as KEEP");
    } finally { rmSync(dir, { recursive: true }); }
  });

  it("uses complete production audit serialization and redacts credentials", () => {
    const value = serializeEvidence({ authorization: "Bearer actual-private-value", output: "sk-abcdefgh123456789", rows: Array.from({ length: 300 }, (_, i) => i) });
    expect(value).not.toContain("actual-private-value"); expect(value).not.toContain("sk-abcdefgh"); expect(JSON.parse(value).rows).toHaveLength(300);
    expect(readFileSync(input().rawPath, "utf8")).toContain("Well, well,");
  });
});
