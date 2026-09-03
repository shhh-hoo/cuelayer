import { describe, expect, it } from "vitest";
import { LessonStreamRuntime, type LessonEventStore } from "../lesson-stream/runtime";
import type { LessonEvent } from "../lesson-stream/contracts";
import { createInitialSessionState, sessionReducer } from "./session-state";
import { closeOpenCanonicalSpeechSpans } from "./canonical-speech";
import { createSpeechmaticsDrainBarrier, drainSpeechmaticsStop } from "./speechmatics-stop-drain";

describe("end-session canonical finalization", () => {
  it("commits an unterminated final phrase delivered during drain before lesson.ended", async () => {
    const events: LessonEvent[] = [];
    const order: string[] = [];
    const store: LessonEventStore = {
      async append(batch) {
        events.push(...batch);
        for (const event of batch) if (event.type === "evidence.checkpoint_committed") order.push("evidence.checkpoint_committed");
        for (const event of batch) if (event.type === "lesson.ended") order.push("lesson.ended");
      },
      async readSession() { return events; },
    };
    let state = sessionReducer(createInitialSessionState(), { type: "begin-speech", runId: 1 });
    state = sessionReducer(state, { type: "speech-ready", runId: 1 });
    const activeRunId = { current: 1 as number | null };
    const barrier = createSpeechmaticsDrainBarrier(1);
    let settleClient: (() => void) | undefined;
    const stop = drainSpeechmaticsStop({
      activeRunId,
      stopping: { current: false },
      stopRecording: () => undefined,
      stopTranscription: () => new Promise<void>((resolve) => { settleClient = resolve; }),
      barrier,
      finish: () => order.push("speech.drain_completed"),
      fail: () => order.push("speech.drain_incomplete"),
    });
    await Promise.resolve();
    // This final is delivered after EndOfStream was sent but before EndOfTranscript settles.
    state = sessionReducer(state, { type: "speech-event", runId: 1, now: 100, event: { kind: "committed", text: "the final unterminated tail phrase", words: [{ text: "tail", startMs: 0, endMs: 100 }] } });
    order.push("speech.final_received");
    barrier.observeEndOfTranscript();
    order.push("EndOfTranscript-observed");
    settleClient?.();
    await stop;
    state = sessionReducer(state, { type: "speech-stopped", runId: 1, now: 101 });
    order.push("canonical.explicit_stop");
    const finalCanonicalSpeech = closeOpenCanonicalSpeechSpans(state.speech.canonical, "explicit_stop", 101);
    const runtime = await LessonStreamRuntime.open("end-drain", store);
    await runtime.start();
    for (const span of finalCanonicalSpeech.spans.filter((item) => item.status === "closed")) await runtime.commitClosedSpan(span, 1);
    await runtime.end();
    const checkpointIndex = events.findIndex((event) => event.type === "evidence.checkpoint_committed" && event.checkpoint.text.includes("tail phrase"));
    const endedIndex = events.findIndex((event) => event.type === "lesson.ended");
    expect(checkpointIndex).toBeGreaterThan(-1);
    expect(checkpointIndex).toBeLessThan(endedIndex);
    expect(order).toEqual([
      "speech.final_received",
      "EndOfTranscript-observed",
      "speech.drain_completed",
      "canonical.explicit_stop",
      "evidence.checkpoint_committed",
      "lesson.ended",
    ]);
  });
});
