import { describe, expect, it } from "vitest";
import { LIVE_PLANNER_GOLDENS, plannerInputForGolden } from "./live-planner-golden";

describe("live planner golden corpus", () => {
  it("contains a balanced 50-case provider contract screen including the required moments", () => {
    expect(LIVE_PLANNER_GOLDENS).toHaveLength(50);
    const distribution = LIVE_PLANNER_GOLDENS.reduce<Record<string, number>>((counts, item) => {
      const label = item.expected.kind === "RELATE" ? `RELATE/${item.expected.relation}` : item.expected.kind;
      counts[label] = (counts[label] ?? 0) + 1;
      return counts;
    }, {});
    expect(distribution).toEqual({ QUIET: 7, TEXT: 9, FOCUS: 8, "RELATE/cause": 7, "RELATE/sequence": 7, "RELATE/contrast": 5, TRANSFORM: 7 });
    expect(LIVE_PLANNER_GOLDENS.find((item) => item.segments.includes("The activation energy is the minimum energy required for a successful collision."))?.expected).toEqual({ kind: "FOCUS" });
    expect(LIVE_PLANNER_GOLDENS.find((item) => item.segments.includes("First calculate the number of moles, then use the mole ratio."))?.expected).toEqual({ kind: "RELATE", relation: "sequence" });
    expect(LIVE_PLANNER_GOLDENS.find((item) => item.segments.includes("Higher temperature causes particles to move faster."))?.expected).toEqual({ kind: "RELATE", relation: "cause" });
    expect(LIVE_PLANNER_GOLDENS.find((item) => item.segments.includes("Solid iodine changes to liquid iodine."))?.expected).toEqual({ kind: "TRANSFORM" });
    expect(LIVE_PLANNER_GOLDENS.find((item) => item.segments.includes("Okay, let's move on."))?.expected).toEqual({ kind: "QUIET" });
  });

  it("preserves every case as one or more immutable committed Speechmatics turns", () => {
    for (const item of LIVE_PLANNER_GOLDENS) {
      const input = plannerInputForGolden(item);
      expect(input.recentSpeech.map((turn) => turn.text)).toEqual(item.segments);
    }
  });

  it("covers live speech shapes and unsafe relation candidates", () => {
    const covered = new Set(LIVE_PLANNER_GOLDENS.flatMap((item) => item.features));
    expect(covered).toEqual(new Set(["clean", "disfluent", "unfinished", "repetition", "correction", "multi-segment", "ambiguous-relation", "protected", "notation-sensitive"]));
    expect(LIVE_PLANNER_GOLDENS.filter((item) => item.features.includes("multi-segment")).length).toBeGreaterThanOrEqual(8);
    expect(LIVE_PLANNER_GOLDENS.filter((item) => item.features.includes("ambiguous-relation")).map((item) => item.expected.kind)).toEqual(["TEXT", "TEXT", "TEXT"]);
    expect(LIVE_PLANNER_GOLDENS.find((item) => item.id === "contrast-correction")?.expected).toEqual({ kind: "TEXT" });
  });
});
