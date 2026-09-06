// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFixture } from "./useFixture";
import { STEPS } from "./fixture";

let root: Root;
let latest: ReturnType<typeof useFixture>;
function Harness() { latest = useFixture(); return null; }
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network permitted in fixture"); }));
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("plays itself once with the specified pauses, without duplicate StrictMode timers or provider calls", async () => {
  expect(latest.playback.index).toBe(0);
  for (let index = 0; index < STEPS.length - 1; index++) {
    await act(async () => vi.advanceTimersByTimeAsync(STEPS[index]!.holdMs - 1));
    expect(latest.playback.index).toBe(index);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(latest.playback.index).toBe(index + 1);
  }
  expect(latest.playback.playing).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(latest.playback.index).toBe(STEPS.length - 1);
  expect(fetch).not.toHaveBeenCalled();
});
it("pauses, steps, resumes and resets without stale timer advancement", async () => {
  await act(async () => latest.dispatch({ type: "toggle" }));
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(latest.playback.index).toBe(0);
  await act(async () => latest.dispatch({ type: "next" }));
  expect(latest.playback.index).toBe(1);
  expect(latest.playback.playing).toBe(false);
  await act(async () => latest.dispatch({ type: "toggle" }));
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(latest.playback.index).toBe(2);
  await act(async () => latest.dispatch({ type: "reset" }));
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(latest.playback).toMatchObject({ index: 0, playing: false, resetKey: 1 });
  expect(latest.playback.lesson.cores).toHaveLength(1);
});
