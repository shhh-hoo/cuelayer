import { describe, expect, it } from "vitest";
import { activateBrowserAudio, createSpeechmaticsConfig, speechStartFailureFrom } from "./use-speechmatics-session";

describe("Speechmatics configuration", () => {
  it("uses the actual browser audio sample rate for raw PCM", () => {
    expect(createSpeechmaticsConfig(48_000).audio_format.sample_rate).toBe(48_000);
  });

  it("keeps microphone and browser-audio startup failures distinct", () => {
    expect(speechStartFailureFrom(new DOMException("Denied", "NotAllowedError")).code).toBe("microphone-permission-denied");
    expect(speechStartFailureFrom(Object.assign(new Error("Audio context"), { name: "AudioContextResumeError" })).code).toBe("audio-context-failed");
    expect(speechStartFailureFrom(Object.assign(new Error("Worklet"), { name: "AudioModuleRegistrationError" })).code).toBe("audio-worklet-failed");
  });

  it("initiates official microphone permission and audio-context activation before continuing startup", async () => {
    const order: string[] = [];
    let state: AudioContextState = "suspended";
    const audioContext: Pick<AudioContext, "state" | "resume"> = {
      get state() { return state; },
      resume: async () => {
        order.push("audio-context");
        state = "running";
      },
    };

    await activateBrowserAudio({
      audioContext,
      permissionState: "prompt",
      promptPermissions: async () => { order.push("permission"); },
      getPermissionState: () => "granted",
    });

    expect(order).toEqual(["permission", "audio-context"]);
  });
});
