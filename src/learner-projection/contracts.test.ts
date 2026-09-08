import { describe, expect, it } from "vitest";
import { learnerProjectionFixtureErrors } from "./contracts.ts";
import { M4A_LEARNER_PROJECTION_FIXTURES } from "./fixtures.ts";

describe("M4A learner projection contract fixtures", () => {
  it("keeps the first review corpus intentionally small and diverse", () => {
    expect(M4A_LEARNER_PROJECTION_FIXTURES).toHaveLength(15);
    expect(new Set(M4A_LEARNER_PROJECTION_FIXTURES.map(fixture => fixture.source.family))).toEqual(
      new Set(["CAMBRIDGE", "RSC", "MIT_OCW"]),
    );
  });

  it.each(M4A_LEARNER_PROJECTION_FIXTURES)("$id satisfies projection hard invariants", fixture => {
    expect(learnerProjectionFixtureErrors(fixture)).toEqual([]);
  });

  it("covers preserve and advance without introducing a teaching-style state machine", () => {
    const transitions = M4A_LEARNER_PROJECTION_FIXTURES.map(fixture => fixture.expected.transition.knowledge);
    expect(transitions).toContain("PRESERVE");
    expect(transitions).toContain("ADVANCE");

    const serialized = JSON.stringify(M4A_LEARNER_PROJECTION_FIXTURES);
    expect(serialized).not.toContain("teachingStyle");
    expect(serialized).not.toContain('"LECTURE"');
    expect(serialized).not.toContain('"INQUIRY"');
    expect(serialized).not.toContain('"PRACTICAL"');
  });

  it("distinguishes focused teaching, comparison and deliberate review widening", () => {
    const framing = new Set(M4A_LEARNER_PROJECTION_FIXTURES.map(fixture => fixture.expected.transition.framing));
    expect(framing).toEqual(new Set(["FOCUS", "COMPARE", "WIDEN"]));
  });

  it("treats representation switching and paired representations as projection choices", () => {
    const representation = new Set(M4A_LEARNER_PROJECTION_FIXTURES.map(fixture => fixture.expected.transition.representation));
    expect(representation).toEqual(new Set(["KEEP", "SWITCH", "PAIR"]));
    for (const fixture of M4A_LEARNER_PROJECTION_FIXTURES) {
      expect(fixture.expected.attention.representations.filter(item => item.role === "dominant").length).toBeLessThanOrEqual(1);
    }
  });

  it("keeps calculation, practical and learner-generated work explicitly ephemeral", () => {
    const withWork = M4A_LEARNER_PROJECTION_FIXTURES.filter(fixture => fixture.expected.workSurface);
    expect(withWork.length).toBeGreaterThanOrEqual(7);
    for (const fixture of withWork) {
      expect(fixture.expected.workSurface?.lifecycle).toBe("EPHEMERAL");
      expect(fixture.mustNot).toContain("PERSIST_WORK_AS_KNOWLEDGE");
    }
  });

  it("protects productive struggle when an unresolved learner question dominates", () => {
    const questions = M4A_LEARNER_PROJECTION_FIXTURES.filter(fixture => {
      const cueId = fixture.expected.attention.cue?.cueId;
      return cueId && fixture.input.state.cue.active?.id === cueId && fixture.input.state.cue.active.kind === "QUESTION";
    });
    expect(questions.length).toBeGreaterThanOrEqual(3);
    for (const fixture of questions) {
      expect(fixture.expected.attention.cue?.role).toBe("dominant");
      expect(fixture.mustNot).toContain("LEAK_ANSWER_DURING_PRODUCTIVE_STRUGGLE");
    }
  });

  it("never yanks an inspecting learner back to the live camera", () => {
    const inspecting = M4A_LEARNER_PROJECTION_FIXTURES.filter(fixture => fixture.input.navigation.mode === "INSPECTING_HISTORY");
    expect(inspecting).toHaveLength(1);
    expect(inspecting[0]?.expected.navigation).toEqual({ camera: "PRESERVE_VIEW", liveReturn: "AVAILABLE" });
    expect(inspecting[0]?.mustNot).toContain("YANK_FROM_HISTORY_INSPECTION");
  });

  it("derives Parked Cores from currentCoreId rather than persisting a Parked status", () => {
    const review = M4A_LEARNER_PROJECTION_FIXTURES.find(fixture => fixture.id === "rsc-group2-review-widen");
    expect(review?.input.state.knowledge.currentCoreId).toBe("group2");
    expect(review?.expected.parkedCoreIds).toEqual(["periodicity"]);
    expect(review?.mustNot).toContain("TREAT_PARKED_AS_DURABLE_STATUS");
  });

  it("keeps the free tangent as a hold rather than inventing a competing semantic Core", () => {
    const tangent = M4A_LEARNER_PROJECTION_FIXTURES.find(fixture => fixture.id === "mit-free-tangent-and-return");
    expect(tangent?.expected.transition).toEqual({ knowledge: "PRESERVE", framing: "FOCUS", representation: "KEEP" });
    expect(tangent?.mustNot).toContain("CREATE_DUPLICATE_CORE");
  });
});
