import { describe, expect, it } from "vitest";
import { createTeachingInterpretationSchema } from "./provider-contract";
import { ALPHA_CORE_P4 } from "../../src/lesson-stream/semantic-profile";
import { loadSemanticCorpusV5, validateSemanticCorpusV5 } from "./semantic-evaluation-v5";

describe("SEMANTICS v5 locked benchmark", () => {
  it("validates its immutable corpus and release coverage", () => {
    expect(validateSemanticCorpusV5()).toMatchObject({ ok: true, errors: [], caseCount: 60, developmentCount: 40, holdoutCount: 20 });
    expect(loadSemanticCorpusV5().cases.filter((item) => item.split === "holdout" && item.goldByProfile.augment.mustAugment)).toHaveLength(5);
  });

  it("constrains every provider checkpoint reference to a real request checkpoint", () => {
    const contribution = (checkpointId: string) => ({ mode: "REPRESENT", content: { kind: "TEXT", text: "Point" }, provenance: { basis: "SPEECH", speechRefs: [{ checkpointId }], stateRefs: null } });
    const proposal = (checkpointId: string) => ({ requestId: "r", baseBoardRevision: 0, baseCueRevision: 0, steps: [{ consumesCheckpointIds: [checkpointId], boardDelta: { action: "SET_ACTIVE", contribution: contribution(checkpointId), continuity: "same_thread", retainPrevious: false, support: null, invalidatesBoardItemIds: null }, cueDelta: { action: "KEEP" }, evidenceRefs: [{ checkpointId }], warnings: null }], warnings: null });
    const schema = createTeachingInterpretationSchema(ALPHA_CORE_P4, ["checkpoint-real"]);
    expect(schema.safeParse(proposal("checkpoint-real")).success).toBe(true);
    expect(schema.safeParse(proposal("checkpoint-fabricated")).success).toBe(false);
  });
});
