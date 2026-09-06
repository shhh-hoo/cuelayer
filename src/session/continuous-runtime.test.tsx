// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveTeaching } from "./use-live-teaching";
import { LessonStreamRuntime } from "../lesson-stream/runtime";
import type { LessonEvent, TeachingInterpretationRequest } from "../lesson-stream/contracts";
import { TeachingInterpreterError, type TeachingInterpretationResponse } from "../lesson-stream/planner";
import type { TeachingProviderAudit } from "../lesson-stream/audit-contracts";
import { prepareTraceEvent, sanitizeTraceEvent, type SessionTraceDraft } from "../trace/contracts";
import { createOutputReferenceCodec } from "../../server/teaching/output-reference-codec";
import type { CanonicalSpeechState } from "./speech-types";

const empty: CanonicalSpeechState = { spans: [] } as unknown as CanonicalSpeechState;
const speech = (id: string, text: string): CanonicalSpeechState => ({ spans: [{ id, text, revision: 1, sourceFinalIds: [id], words: [], startMs: 0, endMs: 1000, openedAtMs: 0, updatedAtMs: 1000, status: "closed", closeReason: "terminal_punctuation" }] }) as unknown as CanonicalSpeechState;
function response(request: TeachingInterpretationRequest): TeachingInterpretationResponse {
  const ids = request.newEvidence.map((item) => item.checkpointId);
  return { proposal: { requestId: request.requestId, baseBoardRevision: request.currentState.board.revision, baseCueRevision: request.currentState.cue.revision, steps: [{ consumesCheckpointIds: ids, boardDelta: { action: "SET_ACTIVE", continuity: "same_thread", retainPrevious: false, contribution: { mode: "REPRESENT", content: { kind: "TEXT", text: request.newEvidence.map((e) => e.text).join(" ") }, provenance: { basis: "SPEECH", speechRefs: ids.map((checkpointId) => ({ checkpointId, quote: "" })) } } }, cueDelta: { action: "KEEP" }, evidenceRefs: [{ checkpointId: ids.at(-1)!, quote: "" }] }] } };
}
let root: Root;
let latest: ReturnType<typeof useLiveTeaching>;
let records: Array<{ request: TeachingInterpretationRequest; signal?: AbortSignal; resolve(value: TeachingInterpretationResponse): void; reject(error: Error): void }>;
let props: Parameters<typeof useLiveTeaching>[0];
const open = LessonStreamRuntime.open.bind(LessonStreamRuntime);
function Harness() { latest = useLiveTeaching(props); return <div>{latest.status}:{latest.pendingCount}:{latest.state.board.active?.contribution.content.kind === "TEXT" ? latest.state.board.active.contribution.content.text : ""}</div>; }
async function render(update: Partial<typeof props> = {}) {
  props = { ...props, ...update };
  await act(async () => { root.render(<Harness />); for (let i = 0; i < 30; i++) await Promise.resolve(); });
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const sessions = new Map<string, LessonEvent[]>();
  vi.spyOn(LessonStreamRuntime, "open").mockImplementation(async (id) => {
    const events = sessions.get(id) ?? []; sessions.set(id, events);
    return open(id, { readSession: async () => [...events], append: async (items) => { events.push(...items); } });
  });
  records = [];
  props = { sessionId: "session-a", sessionStatus: "active", speechStatus: "ready", speechRunId: "run-a", canonicalSpeech: empty, interpreter: { interpret: (request, options) => new Promise((resolve, reject) => records.push({ request, signal: options?.signal, resolve, reject })) } };
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("actual live hook generation and recovery", () => {
  it("emits correlated browser pipeline timings while preserving acceptance", async () => {
    const drafts: SessionTraceDraft[] = [];
    await render({ canonicalSpeech: speech("latency", "Synthetic timing."), onTrace: d => { drafts.push(d); } });
    const call = records[0]!;
    await act(async () => { call.resolve(response(call.request)); for (let i = 0; i < 30; i++) await Promise.resolve(); });
    const stages = drafts.filter(d => d.type === "latency.stage");
    expect(stages.map(d => d.payload.stage)).toEqual(["committed", "eligible", "started", "provider", "validation", "reduced"]);
    for (const d of stages) expect(d.payload.checkpointIds).toEqual(call.request.newEvidence.map(c => c.checkpointId));
    expect(stages.at(-1)!.payload).toMatchObject({ boardRevision: 1, cueRevision: 0, pendingCount: 0, oldestPendingAgeMs: 0 });
    expect(latest.pendingCount).toBe(0);
  });
  it("a throwing trace sink cannot change acceptance or trigger retries", async () => {
    await render({ canonicalSpeech: speech("diagnostic-failure", "Synthetic timing."), onTrace: () => { throw Error("trace-failed"); } });
    await act(async () => { records[0]!.resolve(response(records[0]!.request)); for (let i = 0; i < 30; i++) await Promise.resolve(); });
    expect(latest.pendingCount).toBe(0); expect(records).toHaveLength(1);
  });

  it.each(["success", "failure"])("retains the compact reference map in exportable %s request snapshots", async (outcome) => {
    const drafts: SessionTraceDraft[] = [];
    await render({ canonicalSpeech: speech("synthetic-codec", "Synthetic trace reference test."), onTrace: draft => { drafts.push(draft); } });
    const call = records[0]!;
    const codec = createOutputReferenceCodec(call.request);
    const audit: TeachingProviderAudit = {
      referenceCodec: codec.audit,
      providerContract: { requestedModel: "synthetic-no-provider", reasoningEffort: "low", maxOutputTokens: 2048,
        policyVersion: call.request.policyVersion, semanticProfileId: call.request.semanticProfileId, systemPolicy: "Synthetic audit fixture",
        systemPolicyDigest: "synthetic-policy-digest", structuredOutputSchema: {}, structuredOutputSchemaDigest: "synthetic-schema-digest", providerContractDigest: "synthetic-contract-digest" },
      providerRequest: { model: "synthetic-no-provider", reasoning: { effort: "low" }, max_output_tokens: 2048,
        input: [{ role: "user", content: JSON.stringify(codec.input) }], text: { format: {} } },
      providerRequestDigest: "synthetic-request-digest", domainRequestDigest: "synthetic-domain-digest",
      providerResponse: { providerResponseDigest: "synthetic-response-digest", rawStructuredOutput: { steps: [] } },
      normalizedProposalDigest: "synthetic-proposal-digest",
    };
    await act(async () => {
      if (outcome === "success") call.resolve({ ...response(call.request), audit });
      else call.reject(new TeachingInterpreterError("teaching-normalization-failed", { ...audit, failureStage: "normalization_error" }));
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
    const snapshot = drafts.find(draft => draft.type === "provider.request_snapshot");
    expect(snapshot).toBeDefined();
    const exported = JSON.parse(JSON.stringify(sanitizeTraceEvent(prepareTraceEvent("synthetic-session", "synthetic-browser", 1, snapshot!))));
    expect(exported.payload).toMatchObject({ requestId: call.request.requestId, referenceCodec: codec.audit });
    expect(exported.payload.referenceCodec.handles.e.e0).toBe(call.request.newEvidence[0]!.checkpointId);
    expect(latest.pendingCount).toBe(outcome === "success" ? 0 : 1);
  });

  it.each(["success", "failure"])("session replacement makes old %s and finally inert", async (outcome) => {
    await render({ canonicalSpeech: speech("a", "Old teaching point.") });
    expect(records).toHaveLength(1); const old = records[0]!;
    await render({ sessionId: "session-b", speechRunId: "run-b", canonicalSpeech: empty });
    expect(old.signal?.aborted).toBe(true);
    await act(async () => { if (outcome === "success") old.resolve(response(old.request)); else old.reject(new Error("old-provider-failure")); await vi.advanceTimersByTimeAsync(20_000); });
    expect(latest.status).toBe("ready"); expect(latest.error).toBeUndefined(); expect(latest.state.board.active).toBeUndefined(); expect(latest.pendingCount).toBe(0); expect(records).toHaveLength(1);
  });

  it("run replacement preserves evidence but late old success cannot apply it", async () => {
    await render({ canonicalSpeech: speech("a", "Preserved fragment.") }); const old = records[0]!;
    await render({ speechRunId: "run-b", canonicalSpeech: empty });
    expect(old.signal?.aborted).toBe(true); expect(records).toHaveLength(2);
    const current = records[1]!;
    await act(async () => { old.resolve(response(old.request)); await Promise.resolve(); });
    expect(latest.state.board.active).toBeUndefined(); expect(latest.pendingCount).toBe(1); expect(latest.status).toBe("interpreting");
    await act(async () => { current.resolve(response(current.request)); for (let i = 0; i < 20; i++) await Promise.resolve(); });
    expect(latest.state.board.active?.contribution.content).toEqual({ kind: "TEXT", text: "Preserved fragment." }); expect(latest.pendingCount).toBe(0); expect(latest.error).toBeUndefined();
  });

  it.each(["teaching-interpretation-structured-parse-failed", "teaching-normalization-failed", "interpretation-request-budget-exceeded"])("pauses %s without blind retries or consumption", async (message) => {
    await render({ canonicalSpeech: speech("a", "Preserve this teaching point.") });
    await act(async () => { records[0]!.reject(new Error(message)); await vi.advanceTimersByTimeAsync(60_000); });
    expect(records).toHaveLength(1); expect(latest.pendingCount).toBe(1);
    expect(latest.health.paused).toBe(true); expect(latest.state.board.active).toBeUndefined();
  });

  it("can recover pending interpretation with the microphone muted", async () => {
    await render({ canonicalSpeech: speech("a", "Keep the evidence.") });
    await act(async () => { records[0]!.reject(new Error("network failed")); await Promise.resolve(); });
    await render({ speechStatus: "paused" });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(records).toHaveLength(2);
    await act(async () => { records[1]!.resolve(response(records[1]!.request)); for (let i = 0; i < 25; i++) await Promise.resolve(); });
    expect(latest.pendingCount).toBe(0); expect(latest.status).toBe("ready");
  });

  it("runtime close prevents stale success, failure and retry timers from restarting work", async () => {
    await render({ canonicalSpeech: speech("a", "A point.") }); const old = records[0]!;
    await act(async () => { old.reject(new Error("network failed")); await Promise.resolve(); });
    expect(latest.health.consecutiveFailures).toBe(1);
    await act(async () => root.unmount());
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(records).toHaveLength(1);
    root = createRoot(document.createElement("div"));
  });

  it("bounds real timeout retries without amplification and recovers preserved evidence after resume", async () => {
    await render({ canonicalSpeech: speech("a", "First point.") });
    await render({ canonicalSpeech: { spans: [...speech("a", "First point.").spans, ...speech("b", "Second point.").spans] } as CanonicalSpeechState });
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(records).toHaveLength(3);
    expect(records.map((item) => item.request.newEvidence.map((c) => c.text))).toEqual([["First point."], ["First point."], ["First point."]]);
    expect(latest.health).toMatchObject({ paused: true, lagging: true, consecutiveFailures: 3, pendingCount: 2 });
    await act(async () => { latest.resumeInterpretation(); await Promise.resolve(); });
    const retry = records.at(-1)!;
    await act(async () => { retry.resolve(response(retry.request)); for (let i = 0; i < 25; i++) await Promise.resolve(); });
    const remaining = records.at(-1)!;
    expect(remaining.request.newEvidence[0]?.text).toBe("Second point.");
    await act(async () => { remaining.resolve(response(remaining.request)); for (let i = 0; i < 25; i++) await Promise.resolve(); });
    expect(latest.pendingCount).toBe(0); expect(latest.health.paused).toBe(false); expect(latest.status).toBe("ready");
    expect(latest.state.board.active?.contribution.content).toEqual({ kind: "TEXT", text: "Second point." });
  });
});
