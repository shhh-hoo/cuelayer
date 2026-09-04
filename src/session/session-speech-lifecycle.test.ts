import { describe, expect, it } from "vitest";
import { stopCurrentSpeechRun } from "./session-speech-lifecycle";

describe("session speech lifecycle", () => {
  it("stops the current run without a run-specific callback identity", async () => {
    const stateRef = { current: { speech: { debug: { runId: 1 } } } };
    const stopped: Array<string | number> = [];
    const stop = () => stopCurrentSpeechRun({
      stateRef,
      stopSpeechmatics: async () => undefined,
      dispatchSession: (action) => stopped.push(action.runId),
      now: () => 1,
    });

    // The same stable callback is retained while a later run becomes active.
    stateRef.current = { speech: { debug: { runId: 2 } } };
    await stop();

    expect(stopped).toEqual([2]);
  });
});
