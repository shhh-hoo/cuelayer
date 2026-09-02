import { describe, expect, it } from "vitest";
import type { CaptionEpisode } from "../planner/contracts";
import { episodeNeedsClock } from "./SemanticCaptionLayer";

const plainEpisode: CaptionEpisode = {
  id: "plain",
  clip: { id: "plain-clip", captionText: "activation energy", words: [], cues: [] },
  status: "live",
  sourceSegmentIds: ["span-1"],
  activatedAt: 0,
};

const animatedEpisode: CaptionEpisode = {
  ...plainEpisode,
  id: "focus",
  cue: {
    kind: "FOCUS",
    target: { id: "target", wordIds: [] },
    treatment: "marker",
    startMs: 0,
    durationMs: 300,
    holdMs: 700,
    intensity: "normal",
  },
};

describe("semantic caption clock", () => {
  it("does not schedule a 100ms React clock for plain canonical or TEXT captions", () => {
    expect(episodeNeedsClock(plainEpisode)).toBe(false);
  });

  it("keeps time only for an active animated cue and freezes locked episodes", () => {
    expect(episodeNeedsClock(animatedEpisode)).toBe(true);
    expect(episodeNeedsClock(animatedEpisode, true)).toBe(false);
  });
});
