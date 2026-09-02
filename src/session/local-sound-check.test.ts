import { describe, expect, it } from "vitest";
import { LocalSoundCheck } from "./local-sound-check";

describe("local sound check", () => {
  it("captures no more than five seconds in memory and discards it explicitly", () => {
    const check = new LocalSoundCheck();
    check.start(10, 5);
    check.observe(new Float32Array(30).fill(0.2));
    expect(check.state).toEqual({ status: "capturing", sampleCount: 30, sampleRate: 10 });
    check.observe(new Float32Array(30).fill(0.2));
    expect(check.state).toEqual({ status: "ready", sampleCount: 50, sampleRate: 10 });
    check.close();
    expect(check.state).toEqual({ status: "idle", sampleCount: 0, sampleRate: undefined });
  });
});
