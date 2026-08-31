import { describe, expect, it } from "vitest";
import { createInitialSessionState, sessionReducer } from "./session-state";

const stream = {} as MediaStream;

describe("live session state", () => {
  it("moves through a valid capture, pause, and resume flow", () => {
    const starting = sessionReducer(createInitialSessionState(), { type: "begin-capture" });
    expect(starting).toMatchObject({ status: "active", presentation: { status: "starting" } });
    const active = sessionReducer(starting, { type: "capture-ready", stream });
    expect(active.status).toBe("active");
    expect(sessionReducer(active, { type: "pause" }).status).toBe("paused");
    expect(sessionReducer(sessionReducer(active, { type: "pause" }), { type: "resume" }).status).toBe("active");
  });

  it("keeps the session alive when a source ends and supports a new capture", () => {
    const active = sessionReducer(sessionReducer(createInitialSessionState(), { type: "begin-capture" }), { type: "capture-ready", stream });
    const ended = sessionReducer(active, { type: "capture-ended" });
    expect(ended).toMatchObject({ status: "active", presentation: { status: "ended", stream: null } });
    expect(sessionReducer(ended, { type: "begin-capture" })).toMatchObject({ status: "active", presentation: { status: "starting" } });
  });

  it("isolates capture errors from the running session and ends only on explicit teacher action", () => {
    const running = sessionReducer(createInitialSessionState(), { type: "begin-capture" });
    const failed = sessionReducer(running, { type: "capture-failed", error: { kind: "cancelled", message: "Cancelled" } });
    expect(failed).toMatchObject({ status: "active", presentation: { status: "error", stream: null } });
    expect(sessionReducer(failed, { type: "end" })).toMatchObject({ status: "ended", presentation: { status: "ended", stream: null } });
  });
});
