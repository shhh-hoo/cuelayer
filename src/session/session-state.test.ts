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

  it("starts speech from idle without requiring a presentation", () => {
    const startingSpeech = sessionReducer(createInitialSessionState(), { type: "begin-speech", runId: 1 });
    const readySpeech = sessionReducer(startingSpeech, { type: "speech-ready", runId: 1 });
    expect(readySpeech).toMatchObject({ status: "active", presentation: { status: "empty", stream: null }, speech: { status: "ready" } });
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

  it("keeps speech running when presentation selection fails", () => {
    const speechReady = sessionReducer(sessionReducer(createInitialSessionState(), { type: "begin-speech", runId: 1 }), { type: "speech-ready", runId: 1 });
    const choosingPresentation = sessionReducer(speechReady, { type: "begin-capture" });
    const failed = sessionReducer(choosingPresentation, { type: "capture-failed", error: { kind: "cancelled", message: "Cancelled" } });
    expect(failed).toMatchObject({ status: "active", presentation: { status: "error" }, speech: { status: "ready", debug: { runId: 1 } } });
  });

  it("adds a presentation after speech without resetting its canonical state", () => {
    const speechReady = sessionReducer(sessionReducer(createInitialSessionState(), { type: "begin-speech", runId: 1 }), { type: "speech-ready", runId: 1 });
    const withSpeech = sessionReducer(speechReady, { type: "speech-event", runId: 1, event: { kind: "committed", text: "activation energy", words: [] } });
    const presentationReady = sessionReducer(sessionReducer(withSpeech, { type: "begin-capture" }), { type: "capture-ready", stream });
    expect(presentationReady).toMatchObject({ presentation: { status: "ready", stream }, speech: { status: "ready", canonical: { committed: [{ text: "activation energy" }] }, debug: { runId: 1, committedEvents: 1 } } });
  });

  it("ignores an event from a disposed speech run and retains presentation state after a speech failure", () => {
    const presentationReady = sessionReducer(sessionReducer(createInitialSessionState(), { type: "begin-capture" }), { type: "capture-ready", stream });
    const startingSpeech = sessionReducer(presentationReady, { type: "begin-speech", runId: 1 });
    const readySpeech = sessionReducer(startingSpeech, { type: "speech-ready", runId: 1 });
    const failedFirstRun = sessionReducer(readySpeech, { type: "speech-event", runId: 1, event: { kind: "error", code: "connection-closed", message: "Disconnected" } });
    const restarted = sessionReducer(failedFirstRun, { type: "begin-speech", runId: 2 });
    const ignoredOldEvent = sessionReducer(restarted, { type: "speech-event", runId: 1, event: { kind: "committed", text: "old connection", words: [] } });
    const failed = sessionReducer(sessionReducer(restarted, { type: "speech-ready", runId: 2 }), { type: "speech-event", runId: 2, event: { kind: "error", code: "connection-closed", message: "Disconnected" } });
    expect(ignoredOldEvent.speech.canonical.committed).toEqual([]);
    expect(failed).toMatchObject({ presentation: { status: "ready", stream }, speech: { status: "error", error: { code: "connection-closed" } } });
  });

  it("blocks speech updates while paused or ended, and starts a clean run later", () => {
    const active = sessionReducer(createInitialSessionState(), { type: "begin-capture" });
    const ready = sessionReducer(sessionReducer(active, { type: "begin-speech", runId: 1 }), { type: "speech-ready", runId: 1 });
    const paused = sessionReducer(ready, { type: "pause" });
    const afterLatePausedEvent = sessionReducer(paused, { type: "speech-event", runId: 1, event: { kind: "committed", text: "ignored", words: [] } });
    const ended = sessionReducer(afterLatePausedEvent, { type: "end" });
    const afterLateEndedEvent = sessionReducer(ended, { type: "speech-event", runId: 1, event: { kind: "committed", text: "also ignored", words: [] } });
    const secondSession = sessionReducer(afterLateEndedEvent, { type: "begin-capture" });
    const secondRun = sessionReducer(secondSession, { type: "begin-speech", runId: 2 });
    expect(afterLatePausedEvent.speech.canonical.committed).toEqual([]);
    expect(afterLateEndedEvent.speech.canonical.committed).toEqual([]);
    expect(secondRun.speech).toMatchObject({ status: "starting", canonical: { committed: [] }, debug: { runId: 2 } });
  });
});
