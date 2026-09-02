import { describe, expect, it } from "vitest";
import { createInitialSessionState, sessionReducer } from "./session-state";
import { createSessionPageReducer } from "./page-session-reducer";

function endedState(traceEnabled: boolean) {
  let state = sessionReducer(createInitialSessionState(traceEnabled), { type: "begin-speech", runId: 3 });
  state = sessionReducer(state, { type: "speech-ready", runId: 3 });
  state = sessionReducer(state, { type: "speech-event", runId: 3, event: { kind: "committed", text: "activation energy", words: [] }, now: 10 });
  return sessionReducer(state, { type: "end" });
}

describe("session page lifecycle reducer", () => {
  it("starts another product session without retaining speech, planner, or legacy trace state", () => {
    const reduce = createSessionPageReducer(true);
    const reset = reduce(endedState(true), { type: "restart-session" });
    expect(reset).toMatchObject({
      status: "idle",
      presentation: { status: "empty", stream: null },
      speech: { status: "off", canonical: { finals: [], spans: [] }, debug: { runId: 0, provisionalEvents: 0, committedEvents: 0 } },
      planner: { status: "idle", requestId: 0, runtime: {} },
      trace: { enabled: true, events: [] },
    });
  });

  it("preserves the production debug policy across a restart", () => {
    const reset = createSessionPageReducer(false)(endedState(false), { type: "restart-session" });
    expect(reset.trace.enabled).toBe(false);
  });
});
