import { describe, expect, it } from "vitest";
import { learnerProjectionFixtureErrors } from "./contracts.ts";
import { M4A_LEARNER_PROJECTION_FIXTURES as RESEARCH_FIXTURES } from "./fixtures.ts";
import { M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES } from "./grounded-fixtures.ts";

const fixtures = M4A_GROUNDED_LEARNER_PROJECTION_FIXTURES;

describe("M4A learner projection contract fixtures", () => {
  it("keeps the first review corpus intentionally small and diverse", () => {
    expect(fixtures).toHaveLength(15);
    expect(RESEARCH_FIXTURES).toHaveLength(15);
    expect(new Set(fixtures.map(fixture => fixture.source.family))).toEqual(
      new Set(["CAMBRIDGE", "RSC", "MIT_OCW"]),
    );
  });

  it.each(fixtures)("$id satisfies projection hard invariants", fixture => {
    expect(learnerProjectionFixtureErrors(fixture)).toEqual([]);
  });

  it("covers preserve and advance without introducing a teaching-style state machine", () => {
    const transitions = fixtures.map(fixture => fixture.expected.transition.knowledge);
    expect(transitions).toContain("PRESERVE");
    expect(transitions).toContain("ADVANCE");

    const serialized = JSON.stringify(fixtures);
    expect(serialized).not.toContain("teachingStyle");
    expect(serialized).not.toContain('"LECTURE"');
    expect(serialized).not.toContain('"INQUIRY"');
    expect(serialized).not.toContain('"PRACTICAL"');
  });

  it("distinguishes focused teaching, comparison and deliberate review widening", () => {
    const framing = new Set(fixtures.map(fixture => fixture.expected.transition.framing));
    expect(framing).toEqual(new Set(["FOCUS", "COMPARE", "WIDEN"]));
  });

  it("treats representation switching and paired representations as projection choices", () => {
    const representation = new Set(fixtures.map(fixture => fixture.expected.transition.representation));
    expect(representation).toEqual(new Set(["KEEP", "SWITCH", "PAIR"]));
    for (const fixture of fixtures) {
      expect(fixture.expected.attention.representations.filter(item => item.role === "dominant").length).toBeLessThanOrEqual(1);
    }
  });

  it("requires every representation and Work Surface block to come from committed-evidence candidates", () => {
    for (const fixture of fixtures) {
      const projectedIds = [
        ...fixture.expected.attention.representations.map(item => item.id),
        ...(fixture.expected.workSurface?.blocks.map(block => block.id) ?? []),
      ];
      const candidates = fixture.input.candidates ?? [];
      const candidateIds = candidates.map(candidate => candidate.id);
      const committed = new Set(fixture.input.committedEvidenceCheckpointIds ?? []);
      expect(candidateIds).toEqual(projectedIds);
      for (const candidate of candidates) {
        expect(candidate.evidenceCheckpointIds.length).toBeGreaterThan(0);
        expect(candidate.evidenceCheckpointIds.every(checkpointId => committed.has(checkpointId))).toBe(true);
      }
      if (projectedIds.length) expect(fixture.mustNot).toContain("INVENT_UNGROUNDED_SURFACE");
    }
  });

  it("rejects research expectations as executable inputs until transient surfaces are grounded", () => {
    const requiringCandidates = RESEARCH_FIXTURES.filter(fixture =>
      fixture.expected.attention.representations.length > 0 || Boolean(fixture.expected.workSurface?.blocks.length),
    );
    expect(requiringCandidates.length).toBeGreaterThan(0);
    for (const fixture of requiringCandidates) {
      const errors = learnerProjectionFixtureErrors(fixture);
      expect(errors.some(error => error.includes("no grounded transient candidate"))).toBe(true);
    }
  });

  it("keeps calculation, practical and learner-generated work explicitly ephemeral", () => {
    const withWork = fixtures.filter(fixture => fixture.expected.workSurface);
    expect(withWork.length).toBeGreaterThanOrEqual(7);
    for (const fixture of withWork) {
      expect(fixture.expected.workSurface?.lifecycle).toBe("EPHEMERAL");
      expect(fixture.mustNot).toContain("PERSIST_WORK_AS_KNOWLEDGE");
    }
  });

  it("protects productive struggle when an unresolved learner question dominates", () => {
    const questions = fixtures.filter(fixture => {
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
    const inspecting = fixtures.filter(fixture => fixture.input.navigation.mode === "INSPECTING_HISTORY");
    expect(inspecting).toHaveLength(1);
    expect(inspecting[0]?.expected.navigation).toEqual({ camera: "PRESERVE_VIEW", liveReturn: "AVAILABLE" });
    expect(inspecting[0]?.mustNot).toContain("YANK_FROM_HISTORY_INSPECTION");
  });

  it("derives Parked Cores from currentCoreId rather than persisting a Parked status", () => {
    const review = fixtures.find(fixture => fixture.id === "rsc-group2-review-widen");
    expect(review?.input.state.knowledge.currentCoreId).toBe("group2");
    expect(review?.expected.parkedCoreIds).toEqual(["periodicity"]);
    expect(review?.mustNot).toContain("TREAT_PARKED_AS_DURABLE_STATUS");
  });

  it("keeps the free tangent as a hold rather than inventing a competing semantic Core", () => {
    const tangent = fixtures.find(fixture => fixture.id === "mit-free-tangent-and-return");
    expect(tangent?.expected.transition).toEqual({ knowledge: "PRESERVE", framing: "FOCUS", representation: "KEEP" });
    expect(tangent?.mustNot).toContain("CREATE_DUPLICATE_CORE");
  });
});
