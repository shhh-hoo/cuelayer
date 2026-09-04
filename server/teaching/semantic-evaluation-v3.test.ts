import { describe, expect, it } from "vitest";
import { loadSemanticCorpusV3, validateSemanticCorpusV3 } from "./semantic-evaluation-v3";

describe("SEMANTICS v3 frozen benchmark", () => {
  it("validates the frozen hash, split, profile contracts, and coverage", () => {
    expect(validateSemanticCorpusV3()).toMatchObject({ ok: true, errors: [], caseCount: 60, developmentCount: 40, holdoutCount: 20 });
    const holdout = loadSemanticCorpusV3().cases.filter((item) => item.split === "holdout");
    expect(holdout.filter((item) => item.goldByProfile.augment.mustAugment)).toHaveLength(5);
    expect(holdout.filter((item) => item.tags.includes("negative-augment-trap"))).toHaveLength(3);
  });

  it("classifies imperative writing, reading, and prediction as teacher-originated TASKs", () => {
    const cases = loadSemanticCorpusV3().cases;
    for (const id of ["SEM3-H-01", "SEM3-H-11", "SEM3-H-19"]) {
      const item = cases.find((candidate) => candidate.id === id)!;
      expect(item.tags).toContain("task");
      expect(item.goldByProfile.core.expectedCueKinds).toContain("TASK");
      expect(item.goldByProfile.core.finalState.cue).toMatchObject({ kind: "TASK" });
    }
  });

  it("accepts either speech derivation label while retaining the preferred label diagnostically", () => {
    const reconstruct = loadSemanticCorpusV3().cases.find((item) => item.id === "SEM3-H-01")!;
    expect(reconstruct.goldByProfile.core.allowedContributionModes).toEqual(expect.arrayContaining(["RECONSTRUCT", "REPRESENT"]));
    expect(reconstruct.diagnosticExpectedSpeechMode).toBe("RECONSTRUCT");
    const represent = loadSemanticCorpusV3().cases.find((item) => item.id === "SEM3-H-03")!;
    expect(represent.goldByProfile.core.allowedContributionModes).toEqual(expect.arrayContaining(["RECONSTRUCT", "REPRESENT"]));
    expect(represent.diagnosticExpectedSpeechMode).toBe("REPRESENT");
  });
});
