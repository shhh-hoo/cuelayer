import { afterEach, describe, expect, it, vi } from "vitest";
import { checkpointFromClosedSpan } from "../lesson-stream/evidence-checkpoints";
import { applySpeechEvent, createInitialCanonicalSpeechState } from "./canonical-speech";
import { createInitialSessionState, sessionReducer } from "./session-state";
import type { SessionState } from "./session-types";
import { scheduleCanonicalSpeechSpanClosure } from "./use-canonical-speech-span-lifecycle";

function openState() {
  let state = sessionReducer(createInitialSessionState(), { type: "begin-speech", runId: 1 });
  state = sessionReducer(state, { type: "speech-ready", runId: 1 });
  return sessionReducer(state, {
    type: "speech-event",
    runId: 1,
    now: 100,
    event: { kind: "committed", text: "Activation energy is required", words: [{ text: "Activation", startMs: 0, endMs: 100 }] },
  });
}

describe("canonical meaningful-pause closure", () => {
  afterEach(() => vi.useRealTimers());

  it("closes a punctuationless span once at 900 ms and makes exactly one checkpoint eligible", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    let state = openState();
    const dispatch = (action: Parameters<typeof sessionReducer>[1]) => { state = sessionReducer(state, action); };
    const cleanup = scheduleCanonicalSpeechSpanClosure({ canonicalSpeech: state.speech.canonical, speechRunId: 1, dispatch });
    vi.advanceTimersByTime(899);
    expect(state.speech.canonical.spans[0]!.status).toBe("open");
    vi.advanceTimersByTime(1);
    expect(state.speech.canonical.spans[0]).toMatchObject({ status: "closed", closeReason: "meaningful_pause" });
    expect(checkpointFromClosedSpan(state.speech.canonical.spans[0]!, 1, 1)?.checkpoint.checkpointId).toBe("checkpoint-1-speech-span-0-2");
    vi.advanceTimersByTime(1_000);
    expect(state.speech.canonical.spans.filter((span) => span.status === "closed")).toHaveLength(1);
    cleanup();
  });

  it("cancels a stale revision timer when more final speech updates the span", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    let state = openState();
    const dispatch = (action: Parameters<typeof sessionReducer>[1]) => { state = sessionReducer(state, action); };
    const staleCleanup = scheduleCanonicalSpeechSpanClosure({ canonicalSpeech: state.speech.canonical, speechRunId: 1, dispatch });
    state = sessionReducer(state, { type: "speech-event", runId: 1, now: 500, event: { kind: "committed", text: "for a reaction", words: [{ text: "reaction", startMs: 200, endMs: 500 }] } });
    vi.setSystemTime(500);
    staleCleanup();
    const cleanup = scheduleCanonicalSpeechSpanClosure({ canonicalSpeech: state.speech.canonical, speechRunId: 1, dispatch });
    vi.advanceTimersByTime(899);
    expect(state.speech.canonical.spans[0]).toMatchObject({ status: "open", revision: 2 });
    vi.advanceTimersByTime(1);
    expect(state.speech.canonical.spans[0]).toMatchObject({ status: "closed", revision: 3 });
    cleanup();
  });

  it("cannot let a previous speech run timer mutate a replacement run", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    let state = openState();
    const dispatch = (action: Parameters<typeof sessionReducer>[1]) => { state = sessionReducer(state, action); };
    const cleanup = scheduleCanonicalSpeechSpanClosure({ canonicalSpeech: state.speech.canonical, speechRunId: 1, dispatch });
    state = sessionReducer(state, { type: "speech-stopped", runId: 1, now: 100 });
    state = sessionReducer(state, { type: "begin-speech", runId: 2 });
    vi.advanceTimersByTime(900);
    expect(state.speech.debug.runId).toBe(2);
    expect(state.speech.canonical.spans).toEqual([]);
    cleanup();
  });

  it("deterministically closes an open span when speech or the lesson explicitly stops", () => {
    const canonical = applySpeechEvent(createInitialCanonicalSpeechState(), { kind: "committed", text: "A final lexical span", words: [{ text: "span", startMs: 0, endMs: 10 }] }, 10).state;
    let state: SessionState = { ...createInitialSessionState(), status: "active", speech: { ...createInitialSessionState().speech, status: "ready", canonical, debug: { runId: 4, provisionalEvents: 0, committedEvents: 1 } } };
    state = sessionReducer(state, { type: "speech-stopped", runId: 4, now: 20 });
    expect(state.speech.canonical.spans[0]).toMatchObject({ status: "closed", closeReason: "explicit_stop" });
  });
});
