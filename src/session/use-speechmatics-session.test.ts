import { describe, expect, it } from "vitest";
import { activateBrowserAudio, createSpeechmaticsConfig, speechStartFailureFrom } from "./use-speechmatics-session";
import { createSpeechmaticsDrainBarrier, drainSpeechmaticsStop } from "./speechmatics-stop-drain";

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

  it("delivers an EndOfStream tail under its original run before local drain completion", async () => {
    const activeRunId = { current: 7 as number | null };
    const stopping = { current: false };
    let resolveDrain: (() => void) | undefined;
    const stopTranscription = () => new Promise<void>((resolve) => { resolveDrain = resolve; });
    const barrier = createSpeechmaticsDrainBarrier(7);
    const order: string[] = [];
    const delivered: Array<{ runId: number; kind: string; text: string }> = [];
    const stop = drainSpeechmaticsStop({
      activeRunId,
      stopping,
      stopRecording: () => { order.push("recorder-stopped"); },
      stopTranscription,
      barrier,
      finish: () => { order.push("speech.lifecycle-stopped"); },
      fail: () => { order.push("speech.lifecycle-failed"); },
    });
    await Promise.resolve();
    expect(stopping.current).toBe(true);
    expect(activeRunId.current).toBe(7);
    // Simulated AddTranscript during the official client's EndOfStream drain.
    if (activeRunId.current !== null) {
      delivered.push({ runId: activeRunId.current, kind: "committed", text: "unterminated tail phrase" });
      order.push("tail-final");
    }
    expect(activeRunId.current).toBe(7);
    barrier.observeEndOfTranscript();
    order.push("EndOfTranscript-observed");
    resolveDrain?.();
    await stop;
    expect(delivered).toEqual([{ runId: 7, kind: "committed", text: "unterminated tail phrase" }]);
    expect(activeRunId.current).toBeNull();
    expect(stopping.current).toBe(false);
    expect(order).toEqual(["recorder-stopped", "tail-final", "EndOfTranscript-observed", "speech.lifecycle-stopped"]);
  });

  it("does not report a successful stop when the client fails before EndOfTranscript", async () => {
    const activeRunId = { current: 8 as number | null };
    const barrier = createSpeechmaticsDrainBarrier(8);
    const lifecycle: string[] = [];
    await expect(drainSpeechmaticsStop({
      activeRunId,
      stopping: { current: false },
      stopRecording: () => undefined,
      stopTranscription: async () => { throw new Error("client timeout"); },
      barrier,
      finish: () => lifecycle.push("stopped"),
      fail: () => lifecycle.push("failed"),
    })).rejects.toMatchObject({ name: "SpeechDrainIncompleteError", runId: 8 });
    expect(activeRunId.current).toBeNull();
    expect(lifecycle).toEqual(["failed"]);
  });
});
