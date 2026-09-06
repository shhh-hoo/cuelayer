// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ listeners: [] as Array<(x: Float32Array) => void>, receive: undefined as undefined | ((x: { data: unknown }) => void), sent: vi.fn(), start: vi.fn(), stop: vi.fn() }));
vi.mock("@speechmatics/real-time-client-react", () => ({ useRealtimeTranscription: () => ({ startTranscription: mock.start, stopTranscription: mock.stop, sendAudio: mock.sent, socketState: "open" }), useRealtimeEventListener: (_: string, callback: typeof mock.receive) => { mock.receive = callback; } }));
vi.mock("@speechmatics/browser-audio-input-react", () => ({ usePCMAudioListener: (cb: (x: Float32Array) => void) => mock.listeners.push(cb), usePCMAudioRecorderContext: () => ({ startRecording: async () => {}, stopRecording: () => {}, mute: () => {}, unmute: () => {}, isRecording: false, audioContext: { state: "running", sampleRate: 48000 } }), useAudioDevices: () => ({ permissionState: "granted" }), getAudioDevicesStore: () => ({ permissionState: "granted" }) }));
import { useSpeechmaticsSession } from "./use-speechmatics-session";
import type { SessionTraceDraft } from "../trace/contracts";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { mock.listeners.length = 0; vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("keeps official send first and exports final timing without retaining PCM", async () => {
  const drafts: SessionTraceDraft[] = []; let session: ReturnType<typeof useSpeechmaticsSession>;
  function Harness() { session = useSpeechmaticsSession({ onEvent: () => {}, onReady: () => {}, onTrace: d => { drafts.push(d); } }); return null; }
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ token: "synthetic-test-token" }) })));
  const root = createRoot(document.createElement("div")); await act(async () => root.render(<Harness />)); await act(async () => session!.start("synthetic-run"));
  expect(mock.listeners[0]).toBe(mock.sent); const pcm = new Float32Array(480); for (const listener of mock.listeners) listener(pcm);
  expect(mock.sent).toHaveBeenCalledWith(pcm);
  mock.receive!({ data: { message: "AddTranscript", metadata: { transcript: "Synthetic." }, results: [{ type: "word", start_time: 0, end_time: 0.01, alternatives: [{ content: "Synthetic", confidence: 1 }] }] } });
  const final = drafts.find(d => d.type === "speech.final_received")!;
  expect(final.payload).toMatchObject({ latency: { speechEndMs: 10, asrFinalAt: expect.any(Number), speechObservedAt: expect.any(Number), speechClockBasis: "pcm-delivery-observation" } });
  expect(JSON.stringify(final)).not.toContain("Float32Array"); await act(async () => root.unmount());
});
