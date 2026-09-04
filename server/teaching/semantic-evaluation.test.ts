import { describe, expect, it } from "vitest";
import { buildTeachingInterpretationRequest } from "../../src/lesson-stream/context-projection";
import { replayLessonEvents } from "../../src/lesson-stream/replay";
import { ACTIVE_ALPHA_SEMANTIC_PROFILE, ALPHA_AUGMENT_CANDIDATE_P4 } from "../../src/lesson-stream/semantic-profile";
import { createTeachingInterpretationSchema, teachingProviderContract } from "./provider-contract";
import { loadSemanticCorpus, normalizeSemanticText, summarizeSemanticResults, validateSemanticCorpus } from "./semantic-evaluation";

describe("frozen Alpha semantics corpus and production harness", () => {
  it("validates frozen hash, split, unique IDs, replayable prefixes, and holdout risk coverage", () => {
    expect(validateSemanticCorpus()).toMatchObject({ ok: true, errors: [], caseCount: 60, developmentCount: 40, holdoutCount: 20 });
  });

  it("uses fixed P4 components and the selected profile for every corpus request", () => {
    const item = loadSemanticCorpus().cases[0]!;
    const replay = replayLessonEvents(item.initialLessonEvents);
    const { request } = buildTeachingInterpretationRequest({ requestId: "production-path", sessionId: item.id, events: replay.events, currentState: replay.state, newEvidence: item.orderedNewCheckpoints, profile: ACTIVE_ALPHA_SEMANTIC_PROFILE });
    expect(request).toMatchObject({ semanticProfileId: "alpha-core-p4-v5", processedTimeline: expect.any(Array), currentState: replay.state, newEvidence: item.orderedNewCheckpoints });
    expect(request).not.toHaveProperty("contextPolicy");
  });

  it("keeps provider schema and policy aligned for core and candidate profiles", () => {
    const core = teachingProviderContract(ACTIVE_ALPHA_SEMANTIC_PROFILE);
    const augment = teachingProviderContract(ALPHA_AUGMENT_CANDIDATE_P4);
    expect(core.systemPolicy).toContain(`Active capability profile: ${ACTIVE_ALPHA_SEMANTIC_PROFILE.id}`);
    expect(core.systemPolicy).toContain("Board active modes: RECONSTRUCT, REPRESENT.");
    expect(core.systemPolicy).toContain("Board enrichment");
    expect(core.systemPolicy).toContain("Copy every request, checkpoint, Board, and Cue ID byte-for-byte");
    expect(augment.systemPolicy).toContain("Board active modes: RECONSTRUCT, REPRESENT, AUGMENT.");
    expect(augment.systemPolicy).toContain("standard formula, charge, or conventional symbol");
    const candidate = { requestId: "r", baseBoardRevision: 0, baseCueRevision: 0, steps: [{ consumesCheckpointIds: ["A"], boardDelta: { action: "SET_ACTIVE", contribution: { mode: "AUGMENT", content: { kind: "TEXT", text: "Al₂Cl₆" }, provenance: { basis: "DOMAIN_KNOWLEDGE", speechRefs: null, stateRefs: null } }, continuity: "same_thread", retainPrevious: false, support: null, invalidatesBoardItemIds: null }, cueDelta: { action: "KEEP" }, evidenceRefs: [{ checkpointId: "A" }], warnings: null }], warnings: null };
    expect(createTeachingInterpretationSchema(ACTIVE_ALPHA_SEMANTIC_PROFILE).safeParse(candidate).success).toBe(false);
    expect(createTeachingInterpretationSchema(ALPHA_AUGMENT_CANDIDATE_P4).safeParse(candidate).success).toBe(true);
  });

  it("produces deterministic exact-count summaries", () => {
    const result = { reconstructMatch: true, representMatch: null, contributionModes: [], usefulAugment: null, mustAugmentHit: null, safetyViolations: [], usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 3, totalTokens: 13 }, latencyMs: 20, accepted: true, structuredParse: true, interventionMatch: true, boardTransitionMatch: true, cueLifecycleMatch: true, contributionModeMatch: true, mismatches: [], caseId: "x", tags: ["reconstruct"], expectedBoardActions: ["KEEP"], boardActions: ["KEEP"], expectedCueActions: ["KEEP"], cueActions: ["KEEP"], expectedCueKinds: [null], cueKinds: [null], allowedContributionModes: [] } as never;
    expect(summarizeSemanticResults([result])).toEqual(summarizeSemanticResults([result]));
    expect(summarizeSemanticResults([result])).toMatchObject({ structuredParse: { numerator: 1, denominator: 1 }, reconstruct: { numerator: 1, denominator: 1 }, represent: { numerator: 0, denominator: 0 }, totals: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 3 } });
  });

  it("normalizes harmless Chemistry glyph variants without erasing identity or charge", () => {
    expect(normalizeSemanticText("SO₄²⁻")).toBe("so42-");
    expect(normalizeSemanticText("Eₐ")).toBe("ea");
    expect(normalizeSemanticText("SO₄²⁻")).not.toBe(normalizeSemanticText("SO₄²⁺"));
  });
});
