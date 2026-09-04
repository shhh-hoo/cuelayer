import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActiveLessonCue } from "../lesson-stream/contracts";
import { BoardLayout, boardDensityForContent } from "./BoardLayout";

const cue: ActiveLessonCue = {
  id: "task-1",
  kind: "TASK",
  contribution: { mode: "INITIATE", content: "Compare the two pathways. Which one is faster?", provenance: { basis: "DOMAIN_KNOWLEDGE" } },
  sourceSegmentIds: ["speech-1"],
  activatedAt: 100,
};

describe("BoardLayout", () => {
  it("uses a deterministic content policy without runtime measurement", () => {
    expect(boardDensityForContent({ presentationMode: "presentationless", retainedCount: 1, cueTextLength: 40 })).toBe("full");
    expect(boardDensityForContent({ presentationMode: "presentationless", retainedCount: 3, cueTextLength: 40 })).toBe("compact");
    expect(boardDensityForContent({ presentationMode: "presentationless", retainedCount: 1, cueTextLength: 181 })).toBe("essential");
    expect(boardDensityForContent({ presentationMode: "presentation-overlay", retainedCount: 0, cueTextLength: 0 })).toBe("essential");
  });

  it("allocates separate content and Teaching Cue regions", () => {
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
  });

  it("keeps presentation overlays essential and bounded", () => {
    const html = renderToStaticMarkup(<BoardLayout presentationMode="presentation-overlay" active={<span>rate = k[A]²</span>} cue={cue} />);
    expect(html).toContain("board-layout-presentation-overlay");
    expect(html).toContain("data-density=\"essential\"");
    expect(html).toContain("board-layout-cue-slot");
  });
});
