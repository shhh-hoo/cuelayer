import { describe, expect, it } from "vitest";
import { createInitialSessionState, sessionReducer } from "./session-state";
import { createSessionPageReducer } from "./page-session-reducer";

function endedState() {
  let state = sessionReducer(createInitialSessionState(), { type: "begin-speech", runId: 3 });
  state = sessionReducer(state, { type: "speech-ready", runId: 3 });
  state = sessionReducer(state, { type: "speech-event", runId: 3, event: { kind: "committed", text: "activation energy", words: [] }, now: 10 });
  return sessionReducer(state, { type: "end" });
}

describe("session page lifecycle reducer", () => {
  it("starts another product session without retaining page-owned speech state", () => {
    const reduce = createSessionPageReducer();
    const reset = reduce(endedState(), { type: "restart-session" });
    expect(reset).toMatchObject({
      status: "idle",
      presentation: { status: "empty", stream: null },
      speech: { status: "off", canonical: { finals: [], spans: [] }, debug: { runId: 0, provisionalEvents: 0, committedEvents: 0 } },
    });
  });

  it("leaves durable trace ownership outside the page reducer", () => {
    const reset = createSessionPageReducer()(endedState(), { type: "restart-session" });
    expect("trace" in reset).toBe(false);
  });
});
