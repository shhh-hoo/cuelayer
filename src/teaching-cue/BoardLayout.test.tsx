import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActiveTeachingCue } from "./contracts";
import { BoardLayout, boardDensityForHeight } from "./BoardLayout";

const cue: ActiveTeachingCue = {
  id: "task-1",
  kind: "TASK",
  text: "Compare the two pathways. Which one is faster?",
  sourceSegmentIds: ["speech-1"],
  activatedAt: 100,
};

describe("BoardLayout", () => {
  it("implements deterministic yield tiers from the measured content height", () => {
    expect(boardDensityForHeight(500)).toBe("full");
    expect(boardDensityForHeight(359)).toBe("compact");
    expect(boardDensityForHeight(239)).toBe("essential");
  });

  it("allocates separate content and Teaching Cue regions instead of overlapping layers", () => {
    const html = renderToStaticMarkup(<BoardLayout
      presentationMode="presentationless"
      retained={[<span key="retained">Ea unchanged</span>]}
      active={<strong>Temperature ↑</strong>}
      support={<span>more particles exceed Ea</span>}
      cue={cue}
    />);
    expect(html).toContain("board-layout-content");
    expect(html).toContain("board-layout-cue-slot");
    expect(html).toContain("teaching-cue-placement-flow");
    expect(html).toContain("data-density=\"full\"");
    expect(html).toContain("data-has-cue=\"true\"");
  });

  it("keeps the same semantic slots when a presentation owns the background", () => {
    const html = renderToStaticMarkup(<BoardLayout presentationMode="presentation-overlay" active={<span>rate = k[A]²</span>} cue={cue} />);
    expect(html).toContain("board-layout-presentation-overlay");
    expect(html).toContain("board-layout-active");
    expect(html).toContain("board-layout-cue-slot");
  });
});
