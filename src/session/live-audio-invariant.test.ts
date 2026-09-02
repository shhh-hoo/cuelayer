import { describe, expect, it } from "vitest";
import speechSessionSource from "./use-speechmatics-session.ts?raw";
import speechProviderSource from "./SpeechmaticsSessionProvider.tsx?raw";

describe("live audio transport invariant", () => {
  it("keeps the official PCM listener as a direct sendAudio handoff", () => {
    expect(speechSessionSource.match(/usePCMAudioListener\s*\(/g)).toHaveLength(1);
    expect(speechSessionSource).toContain("usePCMAudioListener(sendAudio);");
  });

  it("does not reintroduce synchronous PCM diagnostics into the browser callback", () => {
    expect(speechSessionSource).not.toContain("forwardAudio");
    expect(speechSessionSource).not.toContain("PcmHealth");
    expect(speechSessionSource).not.toMatch(/for\s*\([^)]*audio\.length/);
  });

  it("ships the official AudioWorklet as a same-origin file rather than an inline data URL", () => {
    expect(speechProviderSource).toContain("pcm-audio-worklet.min.js?url&no-inline");
    expect(speechProviderSource).not.toContain("pcm-audio-worklet.min.js?url\"");
  });
});
