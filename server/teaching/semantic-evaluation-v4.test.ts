import { describe, expect, it } from "vitest";
import { loadSemanticCorpusV4, validateSemanticCorpusV4 } from "./semantic-evaluation-v4";

describe("SEMANTICS v4 final frozen benchmark", () => {
  it("validates the frozen contract and holdout coverage", () => {
    expect(validateSemanticCorpusV4()).toMatchObject({ ok: true, errors: [], caseCount: 60, developmentCount: 40, holdoutCount: 20 });
    const holdout = loadSemanticCorpusV4().cases.filter((item) => item.split === "holdout");
    expect(holdout.filter((item) => item.goldByProfile.augment.mustAugment)).toHaveLength(5);
    expect(holdout.filter((item) => item.tags.includes("negative-augment-trap"))).toHaveLength(3);
  });

  it("scores Active/Support composition in context instead of requiring duplicated entity text", () => {
    const cases = loadSemanticCorpusV4().cases;
    const note = cases.find((item) => item.id === "SEM4-H-08")!;
    expect(note.goldByProfile.core.finalState.boardActive).toEqual({ entities: [["dynamic equilibrium"]] });
    expect(note.goldByProfile.core.finalState.support).toEqual([{ entities: [["forward", "both reaction"], ["reverse", "both reaction"], ["rate", "rates"], ["equal", "equals", "match", "matches"]] }]);
    const augment = cases.find((item) => item.id === "SEM4-H-17")!;
    expect(augment.goldByProfile.augment.finalState.support).toEqual([{ requiredLexical: [["dh", "delta h", "δh"]] }]);
  });
});
