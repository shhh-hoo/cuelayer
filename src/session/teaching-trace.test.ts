import { describe, expect, it } from "vitest";
import type { PlannerInput, RuntimeDecision } from "../planner/contracts";
import { createDurableSessionState, createInitialSessionState, sessionReducer } from "./session-state";
import { appendTeachingTraceEvents, createTeachingTraceState, spanTraceIdFor, traceIdFor } from "./teaching-trace";
import { teachingTraceEventToDurable } from "./teaching-trace-persistence";

const words = [
  { text: "temperature", startMs: 0, endMs: 400 },
  { text: "increases", startMs: 410, endMs: 800 },
];

function decision(input: PlannerInput, display: RuntimeDecision["display"]): RuntimeDecision {
  return {
    display,
    learner: { kind: "NONE" },
  };
}

function committedState(traceEnabled = true) {
  let state = sessionReducer(createInitialSessionState(traceEnabled), { type: "begin-speech", runId: 1 });
  state = sessionReducer(state, { type: "speech-ready", runId: 1 });
  return sessionReducer(state, { type: "speech-event", runId: 1, event: { kind: "committed", text: "temperature increases", words }, now: 100 });
}

function plannerInput(state = committedState()): PlannerInput {
  return { recentSpeech: state.speech.canonical.spans };
}

const checkpoint = { spanId: "speech-span-0", spanRevision: 1, segmentIds: ["speech-span-0"] };

describe("development teaching trace", () => {
  it("correlates a successful ASR → commit → planner → compile → render trace", () => {
    let state = committedState();
    const input = plannerInput(state);
    const focus = decision(input, { kind: "FOCUS", target: { segmentId: "speech-span-0", text: "temperature" } });
    state = sessionReducer(state, { type: "planner-gate", runId: 1, ...checkpoint, decision: "run", reason: "canonical_span_checkpoint", requestId: 1, input, now: 110 });
    state = sessionReducer(state, { type: "planner-requested", runId: 1, requestId: 1, ...checkpoint, input, now: 110 });
    state = sessionReducer(state, { type: "planner-decision", runId: 1, requestId: 1, ...checkpoint, input, decision: focus, startedAt: 110, now: 180 });
    const episode = state.planner.runtime.current!;
    state = sessionReducer(state, { type: "renderer-activated", episode, now: 190 });

    expect(state.trace.events.map((event) => `${event.stage}:${event.decision}`)).toEqual([
      "asr:final",
      "commit:committed",
      "span:opened",
      "planner_gate:run",
      "planner:started",
      "planner:completed",
      "compile:emit",
      "render:activated",
    ]);
    expect(new Set(state.trace.events.map((event) => event.traceId))).toEqual(new Set([traceIdFor(1, "provider-event-1-0"), spanTraceIdFor(1, "speech-span-0", 1)]));
    expect(state.trace.events.find((event) => event.stage === "planner" && event.decision === "completed")?.latencyMs).toBe(70);
    expect(state.trace.events.find((event) => event.stage === "render")?.latencyMs).toBe(90);
  });

  it("records an explicit planner gate skip for queued committed speech", () => {
    let state = committedState();
    state = sessionReducer(state, { type: "planner-gate", runId: 1, ...checkpoint, decision: "skip", reason: "planner_in_flight_queued_latest_revision", now: 115 });
    expect(state.trace.events.at(-1)).toMatchObject({ stage: "planner_gate", decision: "skip", reason: "planner_in_flight_queued_latest_revision", spanId: "speech-span-0", spanRevision: 1, latencyMs: 15 });
  });

  it("distinguishes raw finals from canonical span revisions and closure", () => {
    let state = committedState();
    state = sessionReducer(state, { type: "speech-event", runId: 1, event: { kind: "committed", text: "quickly", words: [{ text: "quickly", startMs: 810, endMs: 1_100 }] }, now: 130 });
    state = sessionReducer(state, { type: "close-speech-span", runId: 1, spanId: "speech-span-0", spanRevision: 2, reason: "meaningful_pause", now: 1_030 });
    expect(state.speech.canonical.finals.map((item) => item.id)).toEqual(["provider-final-0", "provider-final-1"]);
    expect(state.trace.events.filter((event) => event.stage === "span").map((event) => event.decision)).toEqual(["opened", "appended", "closed"]);
    expect(state.trace.events.at(-1)).toMatchObject({ stage: "span", decision: "closed", spanId: "speech-span-0", spanRevision: 3, reason: "meaningful_pause", sourceFinalIds: ["provider-final-0", "provider-final-1"] });
  });

  it("preserves partial → revision → final ordering and rejects an empty noise-only final", () => {
    let state = sessionReducer(createInitialSessionState(true), { type: "begin-speech", runId: 4 });
    state = sessionReducer(state, { type: "speech-ready", runId: 4 });
    state = sessionReducer(state, { type: "speech-event", runId: 4, event: { kind: "provisional", text: "  activa", words: [], provider: { message: "AddPartialTranscript", resultCount: 1, sequence: 12 } }, now: 10 });
    state = sessionReducer(state, { type: "speech-event", runId: 4, event: { kind: "provisional", text: "activation ener", words: [], provider: { message: "AddPartialTranscript", resultCount: 2, sequence: 13 } }, now: 20 });
    state = sessionReducer(state, { type: "speech-event", runId: 4, event: { kind: "committed", text: "activation energy", words, provider: { message: "AddTranscript", resultCount: 2, sequence: 14 } }, now: 30 });
    state = sessionReducer(state, { type: "speech-event", runId: 4, event: { kind: "committed", text: "   ", words: [], provider: { message: "AddTranscript", resultCount: 0, sequence: 15 } }, now: 40 });

    expect(state.trace.events.filter((event) => event.stage === "asr").map((event) => [event.decision, event.transcript, event.speechEventId])).toEqual([
      ["partial", "  activa", "provider-event-4-12"],
      ["partial", "activation ener", "provider-event-4-13"],
      ["final", "activation energy", "provider-event-4-14"],
      ["final", "   ", "provider-event-4-15"],
    ]);
    expect(state.trace.events.at(-1)).toMatchObject({ stage: "commit", decision: "rejected", reason: "empty_transcript", transcript: "   " });
    expect(state.speech.canonical.finals).toHaveLength(1);
  });

  it("keeps durable correlation from provider final through commit, span, planner, cue, and render", () => {
    let state = committedState();
    const input = plannerInput(state);
    const focus = decision(input, { kind: "FOCUS", target: { segmentId: "speech-span-0", text: "temperature" } });
    state = sessionReducer(state, { type: "planner-requested", runId: 1, requestId: 9, ...checkpoint, input, now: 110 });
    state = sessionReducer(state, { type: "planner-decision", runId: 1, requestId: 9, ...checkpoint, input, decision: focus, startedAt: 110, now: 180 });
    state = sessionReducer(state, { type: "renderer-activated", episode: state.planner.runtime.current!, now: 190, presentationMode: "presentationless", surfaceSource: "semantic", rendererState: { captionText: "temperature increases" } });
    const durable = state.trace.events.map((event) => teachingTraceEventToDurable(event, "page-correlation"));

    expect(durable.find((event) => event.type === "asr.final")?.correlation).toMatchObject({ speechEventId: "provider-event-1-0", finalId: "provider-final-0" });
    expect(durable.find((event) => event.type === "commit.committed")?.correlation).toMatchObject({ commitId: "provider-final-0", finalId: "provider-final-0" });
    expect(durable.find((event) => event.type === "span.opened")?.correlation).toMatchObject({ finalId: "provider-final-0", spanId: "speech-span-0", spanRevision: 1 });
    expect(durable.find((event) => event.type === "planner.started")?.correlation).toMatchObject({ spanId: "speech-span-0", plannerRequestId: "9" });
    const cueId = durable.find((event) => event.type === "compile.emit")?.correlation?.cueId;
    expect(cueId).toBe("caption-1-9");
    expect(durable.find((event) => event.type === "render.activated")?.correlation).toMatchObject({ spanId: "speech-span-0", plannerRequestId: "9", cueId });
  });

  it("explains a planner QUIET result as compile no_emit", () => {
    let state = committedState();
    const input = plannerInput(state);
    const quiet = decision(input, { kind: "QUIET", reason: "transition" });
    state = sessionReducer(state, { type: "planner-requested", runId: 1, requestId: 1, ...checkpoint, input, now: 120 });
    state = sessionReducer(state, { type: "planner-decision", runId: 1, requestId: 1, ...checkpoint, input, decision: quiet, startedAt: 120, now: 160 });
    expect(state.planner.runtime.current).toBeUndefined();
    expect(state.trace.events.at(-1)).toMatchObject({ stage: "compile", decision: "no_emit", reason: "quiet_intent", displayIntent: { kind: "QUIET", reason: "transition" } });
    expect(state.trace.events.some((event) => event.stage === "render")).toBe(false);
  });

  it("keeps validation degradation distinct from intentional QUIET", () => {
    let state = committedState();
    const input = plannerInput(state);
    const invalidRelation = decision(input, { kind: "RELATE", relation: "cause", targets: [{ segmentId: "speech-span-0", text: "temperature" }, { segmentId: "speech-span-0", text: "not spoken" }] });
    state = sessionReducer(state, { type: "planner-requested", runId: 1, requestId: 1, ...checkpoint, input, now: 120 });
    state = sessionReducer(state, { type: "planner-decision", runId: 1, requestId: 1, ...checkpoint, input, decision: invalidRelation, startedAt: 120, now: 160 });
    expect(state.trace.events.filter((event) => event.stage === "planner").map((event) => event.decision)).toContain("validation_degraded");
    expect(state.trace.events.at(-1)).toMatchObject({ stage: "compile", decision: "emit", displayIntent: { kind: "TEXT" } });
  });

  it("records provider failure separately before its grounded fallback compiles", () => {
    let state = committedState();
    const input = plannerInput(state);
    state = sessionReducer(state, { type: "planner-requested", runId: 1, requestId: 1, ...checkpoint, input, now: 120 });
    state = sessionReducer(state, { type: "planner-failed", runId: 1, requestId: 1, ...checkpoint, input, message: "planner-invalid-structured-output", startedAt: 120, now: 160 });
    expect(state.trace.events.at(-2)).toMatchObject({ stage: "planner", decision: "failed", reason: "planner-invalid-structured-output" });
    expect(state.trace.events.at(-1)).toMatchObject({ stage: "compile", decision: "emit", reason: "provider_fallback_text_with_canonical_context" });
  });

  it("traces and rejects a planner result for an obsolete span revision", () => {
    let state = committedState();
    const input = plannerInput(state);
    const focus = decision(input, { kind: "FOCUS", target: { segmentId: "speech-span-0", text: "increases" } });
    state = sessionReducer(state, { type: "planner-requested", runId: 1, requestId: 1, ...checkpoint, input, now: 120 });
    state = sessionReducer(state, { type: "speech-event", runId: 1, event: { kind: "committed", text: "sorry decreases", words: [{ text: "sorry", startMs: 810, endMs: 980 }, { text: "decreases", startMs: 990, endMs: 1_300 }] }, now: 130 });
    state = sessionReducer(state, { type: "planner-decision", runId: 1, requestId: 1, ...checkpoint, input, decision: focus, startedAt: 120, now: 180 });
    expect(state.planner.runtime.current).toBeUndefined();
    expect(state.trace.events.at(-1)).toMatchObject({ stage: "planner", decision: "stale", reason: "canonical_span_revision_advanced", spanId: "speech-span-0", spanRevision: 1 });
    expect(state.trace.events.some((event) => event.stage === "compile")).toBe(false);
  });

  it("bounds retained history", () => {
    let trace = createTeachingTraceState(true, 3);
    for (let index = 0; index < 5; index += 1) {
      trace = appendTeachingTraceEvents(trace, [{ traceId: `trace-${index}`, stage: "asr", timestamp: index, segmentId: `committed-${index}`, commitId: `committed-${index}`, decision: "final", transcript: String(index), isFinal: true }]);
    }
    expect(trace.events.map((event) => event.traceId)).toEqual(["trace-2", "trace-3", "trace-4"]);
    expect(trace.nextEventId).toBe(6);
  });

  it("keeps the durable forwarding window bounded", () => {
    let state = sessionReducer(createDurableSessionState(), { type: "begin-speech", runId: 8 });
    state = sessionReducer(state, { type: "speech-ready", runId: 8 });
    for (let index = 0; index < 205; index += 1) {
      state = sessionReducer(state, { type: "speech-event", runId: 8, event: { kind: "provisional", text: `revision ${index}`, words: [], provider: { message: "AddPartialTranscript", resultCount: 1, sequence: index } }, now: index });
    }
    expect(state.trace.events).toHaveLength(205);
  });

  it("caps a long-lived runtime trace instead of retaining the whole session", () => {
    let state = sessionReducer(createDurableSessionState(), { type: "begin-speech", runId: 8 });
    state = sessionReducer(state, { type: "speech-ready", runId: 8 });
    for (let index = 0; index < 510; index += 1) {
      state = sessionReducer(state, { type: "speech-event", runId: 8, event: { kind: "provisional", text: `revision ${index}`, words: [], provider: { message: "AddPartialTranscript", resultCount: 1, sequence: index } }, now: index });
    }
    expect(state.trace.events).toHaveLength(500);
    expect(state.trace.events[0]).toMatchObject({ transcript: "revision 10" });
  });

  it("does not change live-session product state when tracing is enabled", () => {
    const disabled = committedState(false);
    const enabled = committedState(true);
    const withoutTrace = ({ trace: _trace, ...state }: typeof enabled) => state;
    expect(withoutTrace(enabled)).toEqual(withoutTrace(disabled));
    expect(disabled.trace.events).toEqual([]);
    expect(enabled.trace.events).toHaveLength(3);
  });
});
