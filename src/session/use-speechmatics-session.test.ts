import { afterEach, describe, expect, it, vi } from "vitest";
import { activateBrowserAudio, createRecordingStartOptions, createSpeechmaticsConfig, requestRealtimeToken, speechStartFailureFrom } from "./use-speechmatics-session";

describe("Speechmatics configuration", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses the actual browser audio sample rate for raw PCM", () => {
    expect(createSpeechmaticsConfig(48_000).audio_format.sample_rate).toBe(48_000);
  });

  it("passes an explicit selected device to every official recorder start", () => {
    const selection = "chosen-device";
    expect(createRecordingStartOptions(selection)).toMatchObject({ deviceId: selection, recordingOptions: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    expect(createRecordingStartOptions(selection)).toEqual(createRecordingStartOptions(selection));
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

  it("consumes a token without waiting for slow trace persistence and allows missing trace session metadata", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ token: "temporary-token", traceEvents: [{ id: "server-fact" }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const neverSettles = vi.fn(() => new Promise(() => undefined));
    await expect(requestRealtimeToken(undefined, "api-token-request", neverSettles)).resolves.toBe("temporary-token");
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ Accept: "application/json", "X-CueLayer-Api-Request-Id": "api-token-request" });
    expect(neverSettles).toHaveBeenCalledOnce();
  });
});
