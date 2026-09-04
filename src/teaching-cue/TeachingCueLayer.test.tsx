import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActiveLessonCue } from "../lesson-stream/contracts";
import { TeachingCueLayer } from "./TeachingCueLayer";

const cue: ActiveLessonCue = {
  id: "question-1",
  kind: "QUESTION",
  contribution: { mode: "INITIATE", content: "Why does the rate increase?", provenance: { basis: "DOMAIN_KNOWLEDGE" } },
  sourceSegmentIds: ["speech-1"],
  activatedAt: 100,
};

describe("TeachingCueLayer", () => {
  it("renders one independent learner-facing cue in presentationless mode", () => {
    const html = renderToStaticMarkup(<TeachingCueLayer cue={cue} presentationMode="presentationless" />);
    expect(html).toContain("teaching-cue-presentationless");
    expect(html).toContain("data-kind=\"question\"");
    expect(html).toContain("Question");
    expect(html).toContain("Why does the rate increase?");
  });

  it("uses the restrained overlay treatment when a presentation owns the canvas", () => {
    const html = renderToStaticMarkup(<TeachingCueLayer cue={{ ...cue, kind: "TASK" }} presentationMode="presentation-overlay" />);
    expect(html).toContain("teaching-cue-presentation-overlay");
    expect(html).toContain("Task");
  });

  it("renders nothing when no teaching cue is active", () => {
    expect(renderToStaticMarkup(<TeachingCueLayer presentationMode="presentationless" />)).toBe("");
  });
});
