import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TeachingStateSnapshot } from "../lesson-stream/contracts";
import { createInitialTeachingState } from "../lesson-stream/teaching-state";
import { TeachingSurfaceLayer } from "./TeachingSurfaceLayer";

const teachingState: TeachingStateSnapshot = {
  lessonRevision: 3,
  processedThroughSequence: 3,
  board: {
    revision: 2,
    active: {
      id: "board-active",
      content: {
        kind: "RELATION",
        relation: "cause",
        targets: [
          { checkpointId: "checkpoint-1", text: "Temperature increases" },
          { checkpointId: "checkpoint-2", text: "successful collisions increase" },
        ],
      },
      sourceCheckpointIds: ["checkpoint-1", "checkpoint-2"],
      establishedAtRevision: 2,
    },
    support: [{ id: "support-1", targetBoardItemId: "board-active", source: { checkpointId: "checkpoint-2", text: "more particles exceed activation energy" } }],
    retained: [{ id: "board-retained", content: { kind: "TEXT", source: { checkpointId: "checkpoint-0", text: "Activation energy is required" } }, sourceCheckpointIds: ["checkpoint-0"], establishedAtRevision: 1 }],
  },
  cue: {
    revision: 1,
    active: { id: "cue-task", kind: "TASK", text: "Compare the two pathways. Which is faster?", sourceSegmentIds: ["checkpoint-3"], activatedAt: 0 },
  },
};

describe("TeachingSurfaceLayer", () => {
  it("is visually quiet without accepted Board or Cue state", () => {
    expect(renderToStaticMarkup(<TeachingSurfaceLayer state={createInitialTeachingState()} presentationMode="presentationless" />)).toBe("");
  });

  it("renders bounded Board and Cue siblings from Teaching State", () => {
    const html = renderToStaticMarkup(<TeachingSurfaceLayer state={teachingState} presentationMode="presentationless" />);
    expect(html).toContain("teaching-surface-layer");
    expect(html).toContain("Temperature increases");
    expect(html).toContain("successful collisions increase");
    expect(html).toContain("Activation energy is required");
    expect(html).toContain("Compare the two pathways. Which is faster?");
    expect(html).toContain('data-board-revision="2"');
    expect(html).toContain('data-cue-revision="1"');
  });

  it("keeps presentation overlays essential", () => {
    const html = renderToStaticMarkup(<TeachingSurfaceLayer state={teachingState} presentationMode="presentation-overlay" />);
    expect(html).toContain("board-layout-presentation-overlay");
    expect(html).toContain('data-density="essential"');
  });
});
