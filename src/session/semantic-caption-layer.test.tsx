import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createInitialCaptionRuntime } from "../planner/caption-runtime";
import { SemanticCaptionLayer } from "./SemanticCaptionLayer";

const speech = {
  finals: [],
  spans: [{ id: "speech-span-0", revision: 1, sourceFinalIds: ["provider-final-0"], text: "A stable canonical teaching statement remains visible.", words: [], startMs: 0, endMs: 1, openedAtMs: 1, updatedAtMs: 1, status: "closed" as const }],
};

describe("presentationless canonical fallback", () => {
  it.each(["QUIET", "planner timeout", "stale result", "validation degradation"])("keeps canonical speech visible after %s", () => {
    const html = renderToStaticMarkup(<SemanticCaptionLayer runtime={createInitialCaptionRuntime()} speech={speech} presentationMode="presentationless" onExpire={() => undefined} onLearnerCueExpire={() => undefined} />);
    expect(html).toContain("A stable canonical teaching statement remains visible.");
    expect(html).toContain("surface-presentationless");
  });

  it("replaces an effect from an older span with the latest canonical speech", () => {
    const html = renderToStaticMarkup(<SemanticCaptionLayer runtime={{ current: { id: "old", clip: { id: "old", captionText: "Old effect", words: [], cues: [] }, status: "holding", sourceSegmentIds: ["speech-span-old"], activatedAt: 0 } }} speech={speech} presentationMode="presentationless" onExpire={() => undefined} onLearnerCueExpire={() => undefined} />);
    expect(html).toContain("A stable canonical teaching statement remains visible.");
    expect(html).not.toContain("Old effect");
  });

  it("does not render canonical fallback in presentation overlay mode", () => {
    const html = renderToStaticMarkup(<SemanticCaptionLayer runtime={createInitialCaptionRuntime()} speech={speech} presentationMode="presentation-overlay" onExpire={() => undefined} onLearnerCueExpire={() => undefined} />);
    expect(html).not.toContain("A stable canonical teaching statement remains visible.");
    expect(html).not.toContain("semantic-caption");
  });

  it("replaces an older semantic episode when the same canonical span advances revision", () => {
    const newerSpeech = {
      ...speech,
      spans: [{ ...speech.spans[0], revision: 2, text: "The canonical span now includes newly committed speech.", updatedAtMs: 200 }],
    };
    const html = renderToStaticMarkup(<SemanticCaptionLayer runtime={{ current: { id: "old-revision", clip: { id: "old-revision", captionText: "The old semantic episode.", words: [], cues: [] }, status: "holding", sourceSegmentIds: ["speech-span-0"], activatedAt: 100 } }} speech={newerSpeech} presentationMode="presentationless" onExpire={() => undefined} onLearnerCueExpire={() => undefined} />);
    expect(html).toContain("The canonical span now includes newly committed speech.");
    expect(html).not.toContain("The old semantic episode.");
  });
});
