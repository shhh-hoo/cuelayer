import { describe, expect, it, vi } from "vitest";
import { stopPresentationStream } from "./presentation-capture";

describe("presentation capture cleanup", () => {
  it("stops every captured media track when a session ends", () => {
    const first = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const second = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [first, second] } as unknown as MediaStream;
    stopPresentationStream(stream);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });
});
