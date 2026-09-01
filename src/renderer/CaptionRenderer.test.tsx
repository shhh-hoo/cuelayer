import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compileCaptionEpisode } from "../planner/caption-compiler";
import type { GroundedSpeechTurn, PlannerInput, RuntimeDecision } from "../planner/contracts";
import { CaptionRenderer } from "./CaptionRenderer";

function turn(id: string, text: string): GroundedSpeechTurn {
  return { id, text, words: (text.match(/\S+/g) ?? []).map((word, index) => ({ text: word, startMs: index * 120, endMs: index * 120 + 100 })) };
}

function render(text: string, display: RuntimeDecision["display"]) {
  const input: PlannerInput = { recentSpeech: [turn("speech-span-0", text)] };
  const decision: RuntimeDecision = { display, learner: { kind: "NONE" } };
  const episode = compileCaptionEpisode(input, decision, "episode", 0)!;
  return renderToStaticMarkup(<CaptionRenderer clip={episode.clip} cue={episode.cue} currentMs={1_000} mode="fx" reducedMotion embedded />);
}

const visibleText = (html: string) => html.replace(/<[^>]+>/g, "");

describe("semantic caption context", () => {
  it("keeps surrounding canonical speech visible for FOCUS", () => {
    const html = render("The reaction mixture remains colourless", { kind: "FOCUS", target: { segmentId: "speech-span-0", text: "colourless" } });
    expect(visibleText(html)).toBe("The reaction mixture remains colourless");
    expect(html).toContain("focus-target");
  });

  it("keeps surrounding canonical speech visible for RELATE", () => {
    const html = render("Higher temperature causes particles to move faster in the reaction mixture", { kind: "RELATE", relation: "cause", targets: [{ segmentId: "speech-span-0", text: "Higher temperature" }, { segmentId: "speech-span-0", text: "particles to move faster" }] });
    expect(visibleText(html)).toBe("Higher temperature causes particles to move faster in the reaction mixture");
    expect(html).toContain("relation-item");
  });

  it("keeps surrounding canonical speech visible for TRANSFORM", () => {
    const html = render("The alkene is converted into an alcohol under these conditions", { kind: "TRANSFORM", from: { segmentId: "speech-span-0", text: "alkene" }, to: { segmentId: "speech-span-0", text: "alcohol" } });
    expect(visibleText(html)).toBe("The alkene is converted into an alcohol under these conditions");
    expect(html).toContain("previous-state");
    expect(html).toContain("current-state");
  });
});
