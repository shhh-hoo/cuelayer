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
      contribution: { mode: "REPRESENT", content: {
        kind: "RELATION",
        relation: "cause",
        targets: [
          "Temperature increases",
          "successful collisions increase",
        ],
      }, provenance: { basis: "SPEECH", speechRefs: [{ checkpointId: "checkpoint-1", quote: "Temperature increases" }] } },
      sourceCheckpointIds: ["checkpoint-1", "checkpoint-2"],
      establishedAtRevision: 2,
    },
    support: [{ id: "support-1", targetBoardItemId: "board-active", contribution: { mode: "RECONSTRUCT", content: "more particles exceed activation energy", provenance: { basis: "SPEECH", speechRefs: [{ checkpointId: "checkpoint-2", quote: "more particles exceed activation energy" }] } } }],
    retained: [{ id: "board-retained", contribution: { mode: "RECONSTRUCT", content: { kind: "TEXT", text: "Activation energy is required" }, provenance: { basis: "SPEECH", speechRefs: [{ checkpointId: "checkpoint-0", quote: "Activation energy is required" }] } }, sourceCheckpointIds: ["checkpoint-0"], establishedAtRevision: 1 }],
  },
  cue: {
    revision: 1,
    active: { id: "cue-note", kind: "NOTE", contribution: { mode: "REPRESENT", content: "Compare the two pathways. Which is faster?", provenance: { basis: "SPEECH", speechRefs: [{ checkpointId: "checkpoint-3", quote: "Compare the two pathways" }] } }, sourceSegmentIds: ["checkpoint-3"], activatedAt: 0 },
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
