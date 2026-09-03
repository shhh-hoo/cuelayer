import { describe, expect, it } from "vitest";
import { LessonStreamRuntime, type LessonEventStore } from "../lesson-stream/runtime";
import type { LessonEvent } from "../lesson-stream/contracts";
import { createInitialSessionState, sessionReducer } from "./session-state";
import { closeOpenCanonicalSpeechSpans } from "./canonical-speech";

describe("end-session canonical finalization", () => {
  it("commits an unterminated final phrase delivered during drain before lesson.ended", async () => {
    const events: LessonEvent[] = [];
    const store: LessonEventStore = { async append(batch) { events.push(...batch); }, async readSession() { return events; } };
    let state = sessionReducer(createInitialSessionState(), { type: "begin-speech", runId: 1 });
    state = sessionReducer(state, { type: "speech-ready", runId: 1 });
    // This final is delivered after EndOfStream was sent but before EndOfTranscript settles.
    state = sessionReducer(state, { type: "speech-event", runId: 1, now: 100, event: { kind: "committed", text: "the final unterminated tail phrase", words: [{ text: "tail", startMs: 0, endMs: 100 }] } });
    state = sessionReducer(state, { type: "speech-stopped", runId: 1, now: 101 });
    const finalCanonicalSpeech = closeOpenCanonicalSpeechSpans(state.speech.canonical, "explicit_stop", 101);
    const runtime = await LessonStreamRuntime.open("end-drain", store);
    await runtime.start();
    for (const span of finalCanonicalSpeech.spans.filter((item) => item.status === "closed")) await runtime.commitClosedSpan(span, 1);
    await runtime.end();
    const checkpointIndex = events.findIndex((event) => event.type === "evidence.checkpoint_committed" && event.checkpoint.text.includes("tail phrase"));
    const endedIndex = events.findIndex((event) => event.type === "lesson.ended");
    expect(checkpointIndex).toBeGreaterThan(-1);
    expect(checkpointIndex).toBeLessThan(endedIndex);
  });
});
