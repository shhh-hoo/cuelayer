import { beforeEach, describe, expect, it, vi } from "vitest";
import { LESSON_POLICY_VERSION, type TeachingInterpretationRequest } from "../../src/lesson-stream/contracts";
import { createInitialTeachingState } from "../../src/lesson-stream/teaching-state";
import { ACTIVE_ALPHA_SEMANTIC_PROFILE, ALPHA_AUGMENT_CANDIDATE_P4 } from "../../src/lesson-stream/semantic-profile";

const mocks = vi.hoisted(() => ({ constructor: vi.fn(), create: vi.fn() }));
vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(options: unknown) { mocks.constructor(options); }
    responses = { create: mocks.create };
  },
}));

import { estimateTeachingCost, requestOpenAITeachingInterpretation } from "./openai-interpreter";
import { createTeachingInterpretationSchema, normalizeTeachingProposal, teachingInterpretationSchema } from "./provider-contract";
import { validateAndNormalizeProposal } from "../../src/lesson-stream/accepted-interpretations";
import { persistedAuditDigest } from "../../src/trace/audit";

const input: TeachingInterpretationRequest = {
  requestId: "request-1",
  sessionId: "session-1",
  policyVersion: LESSON_POLICY_VERSION,
  semanticProfileId: ACTIVE_ALPHA_SEMANTIC_PROFILE.id,
  processedTimeline: [{ type: "evidence", checkpointId: "checkpoint-0", sequence: 1, text: "Activation energy is required.", warnings: [] }],
  currentState: createInitialTeachingState(),
  newEvidence: [{ checkpointId: "checkpoint-1", lessonSequence: 2, speechRunId: 1, startMs: 100, endMs: 200, text: "Temperature increases.", sourceFinalIds: ["provider-final-1"], warnings: [] }],
  expected: { firstUnconsumedSequence: 2, lastUnconsumedSequence: 2 },
};

describe("OpenAI Teaching State interpreter", () => {
  beforeEach(() => {
    mocks.constructor.mockReset();
    mocks.create.mockReset();
  });

  it("uses one structured P4 request and exposes compact usage", async () => {
    mocks.create.mockResolvedValue({
      id: "response-1",
      model: "gpt-5.6-luna-actual",
      output_text: JSON.stringify({
        requestId: "request-1",
        baseBoardRevision: 0,
        baseCueRevision: 0,
        steps: [{
          consumesCheckpointIds: ["checkpoint-1"],
          boardDelta: { action: "KEEP", reason: "no_board_value" },
          cueDelta: { action: "KEEP" },
          evidenceRefs: [],
          warnings: null,
        }],
        warnings: null,
      }),
      usage: { input_tokens: 300, output_tokens: 40, total_tokens: 340, input_tokens_details: { cached_tokens: 80 } },
    });
    const controller = new AbortController();
    const result = await requestOpenAITeachingInterpretation(input, "test-key", "gpt-5.6-luna", { signal: controller.signal });
    expect(result).toMatchObject({ proposal: { requestId: "request-1", steps: [{ boardDelta: { action: "KEEP" } }] }, usage: { inputTokens: 300, cachedInputTokens: 80, outputTokens: 40, totalTokens: 340 } });
    const request = mocks.create.mock.calls[0]![0];
    expect(request.reasoning).toEqual({ effort: "none" });
    expect(request.temperature).toBe(0);
    expect(request.input[0].content).toContain("currentState is current authority");
    expect(request.input[0].content).toContain("newEvidence is the sole deliberation trigger");
    expect(request.input[0].content).toContain("Every non-KEEP step must include evidenceRefs");
    expect(request.input[0].content).toContain("STATE_AND_DOMAIN_KNOWLEDGE");
    expect(request.input[0].content).toContain("Cue represents only teacher-originated classroom action");
    expect(request.input[0].content).toContain("board-${requestId}-accepted-N");
    expect(request.input[0].content).toContain("Autonomous CORRECT and INITIATE are disabled");
    expect(request.input[1].content).toBe(JSON.stringify(input));
    expect(request.input[1].content).not.toContain('"words"');
    expect(request.input[1].content).not.toContain("providerEvidence");
    expect(mocks.create.mock.calls[0]![1]).toEqual({ signal: controller.signal });
    expect(result.audit).toMatchObject({ providerRequestDigest: expect.any(String), providerResponse: { providerResponseId: "response-1", providerModel: "gpt-5.6-luna-actual", outputText: expect.any(String), rawStructuredOutput: { requestId: "request-1" }, providerResponseDigest: expect.any(String) } });
    expect(result.audit.providerContract).toMatchObject({ semanticProfileId: "alpha-core-p4-v2", policyVersion: LESSON_POLICY_VERSION, systemPolicyDigest: expect.any(String), structuredOutputSchemaDigest: expect.any(String) });
    const { providerResponseDigest, ...providerResponseFact } = result.audit.providerResponse;
    expect(providerResponseDigest).toBe(persistedAuditDigest(providerResponseFact));
  });

  it("estimates cost only from explicitly configured rates", () => {
    const usage = { inputTokens: 300, cachedInputTokens: 80, outputTokens: 40, totalTokens: 340 };
    expect(estimateTeachingCost(usage, {})).toBeUndefined();
    expect(estimateTeachingCost(usage, { inputPerMillion: 1, cachedInputPerMillion: 0.25, outputPerMillion: 4 })).toBeCloseTo(0.0004);
  });

  it("captures the safe transport response before structured parsing fails", async () => {
    mocks.create.mockResolvedValue({ id: "response-malformed", model: "gpt-actual", output_text: "not JSON", status: "completed", usage: { input_tokens: 1, output_tokens: 1 } });
    await expect(requestOpenAITeachingInterpretation(input, "test-key", "gpt-requested")).rejects.toMatchObject({
      audit: {
        failureStage: "structured_parse_error",
        providerResponse: { providerResponseId: "response-malformed", providerModel: "gpt-actual", outputText: "not JSON", providerResponseDigest: expect.any(String) },
      },
    });
  });

  it("retains parsed structured output when schema parsing fails", async () => {
    mocks.create.mockResolvedValue({ id: "response-normalization", model: "gpt-actual", output_text: JSON.stringify({ requestId: "request-1", baseBoardRevision: 0, baseCueRevision: 0, steps: [], warnings: null }) });
    await expect(requestOpenAITeachingInterpretation(input, "test-key", "gpt-requested")).rejects.toMatchObject({
      audit: { failureStage: "structured_parse_error", providerResponse: { rawStructuredOutput: { requestId: "request-1" } } },
    });
  });

  it("normalizes nullable structured-output fields before domain validation", () => {
    const parsed = {
      requestId: "request-1",
      baseBoardRevision: 0,
      baseCueRevision: 0,
      steps: [{
        consumesCheckpointIds: ["checkpoint-1"],
        boardDelta: {
          action: "SET_ACTIVE" as const,
          contribution: { mode: "REPRESENT" as const, content: { kind: "TEXT" as const, text: "Temperature rises" }, provenance: { basis: "SPEECH" as const, speechRefs: [{ checkpointId: "checkpoint-1", quote: "Temperature increases" }], stateRefs: null } },
          continuity: "same_thread" as const,
          retainPrevious: false,
          support: null,
          invalidatesBoardItemIds: null,
        },
        cueDelta: { action: "SET" as const, cueKind: "NOTE" as const, contribution: { mode: "REPRESENT" as const, content: "Notice the temperature change", provenance: { basis: "SPEECH" as const, speechRefs: [{ checkpointId: "checkpoint-1", quote: "Temperature increases" }], stateRefs: null } }, targetBoardItemId: null },
        evidenceRefs: [{ checkpointId: "checkpoint-1", quote: "Temperature increases" }],
        warnings: null,
      }],
      warnings: null,
    };
    const proposal = normalizeTeachingProposal(parsed);
    expect(proposal.steps[0]).toMatchObject({ boardDelta: { action: "SET_ACTIVE" }, cueDelta: { action: "SET" } });
    expect(proposal.steps[0]!.boardDelta).not.toHaveProperty("support");
    expect(proposal.steps[0]!.boardDelta).not.toHaveProperty("invalidatesBoardItemIds");
    expect(proposal.steps[0]!.cueDelta).not.toHaveProperty("targetBoardItemId");
    expect(validateAndNormalizeProposal({ proposal, request: input, allCheckpoints: input.newEvidence, state: createInitialTeachingState(), model: "test" }).ok).toBe(true);
    const { warnings: _warnings, ...rawWithoutTopLevelWarnings } = parsed;
    expect(validateAndNormalizeProposal({ proposal: rawWithoutTopLevelWarnings, request: input, allCheckpoints: input.newEvidence, state: createInitialTeachingState(), model: "test" })).toEqual({
      ok: false,
      error: "proposal-step-schema-invalid:step-0:boardDelta.support:null",
    });
  });

  it("retains non-null structured-output optional fields", () => {
    const proposal = normalizeTeachingProposal({
      requestId: "request-1", baseBoardRevision: 0, baseCueRevision: 0,
      steps: [{
        consumesCheckpointIds: ["checkpoint-1"],
        boardDelta: { action: "SET_ACTIVE", contribution: { mode: "RECONSTRUCT", content: { kind: "TEXT", text: "Temperature increases" }, provenance: { basis: "SPEECH", speechRefs: [{ checkpointId: "checkpoint-1", quote: "Temperature increases" }], stateRefs: null } }, continuity: "same_thread", retainPrevious: false, support: [{ mode: "RECONSTRUCT", content: "Temperature increases", provenance: { basis: "SPEECH", speechRefs: [{ checkpointId: "checkpoint-1", quote: "Temperature increases" }], stateRefs: null } }], invalidatesBoardItemIds: ["old-board"] },
        cueDelta: { action: "SET", cueKind: "NOTE", contribution: { mode: "RECONSTRUCT", content: "Temperature increases", provenance: { basis: "SPEECH", speechRefs: [{ checkpointId: "checkpoint-1", quote: "Temperature increases" }], stateRefs: null } }, targetBoardItemId: "board-request-1-accepted-0" },
        evidenceRefs: [], warnings: [{ code: "provider-note", detail: "kept" }],
      }],
      warnings: [{ code: "proposal-note", detail: "kept" }],
    });
    expect(proposal.steps[0]!.boardDelta).toMatchObject({ support: [{ mode: "RECONSTRUCT", provenance: { speechRefs: [{ checkpointId: "checkpoint-1" }] } }], invalidatesBoardItemIds: ["old-board"] });
    expect(proposal.steps[0]!.cueDelta).toMatchObject({ targetBoardItemId: "board-request-1-accepted-0" });
    expect(proposal.warnings).toEqual([{ code: "proposal-note", detail: "kept" }]);
  });

  it("derives provider and validator mode permissions from the same profile", () => {
    const speechProvenance = { basis: "SPEECH", speechRefs: [{ checkpointId: "checkpoint-1", quote: "Temperature increases" }], stateRefs: null };
    const domainProvenance = { basis: "DOMAIN_KNOWLEDGE", speechRefs: null, stateRefs: null };
    type TestProvenance = { basis: string; speechRefs: Array<{ checkpointId: string; quote: string }> | null; stateRefs: null };
    const board = (mode: string, provenance: TestProvenance = speechProvenance) => ({ mode, content: { kind: "TEXT", text: "Bounded board content" }, provenance });
    const text = (mode: string, provenance: TestProvenance = speechProvenance) => ({ mode, content: "Bounded cue content", provenance });
    const raw = (boardDelta: unknown, cueDelta: unknown) => ({ requestId: "request-1", baseBoardRevision: 0, baseCueRevision: 0, steps: [{ consumesCheckpointIds: ["checkpoint-1"], boardDelta, cueDelta, evidenceRefs: [{ checkpointId: "checkpoint-1", quote: "Temperature increases" }], warnings: null }], warnings: null });
    const validate = (candidate: unknown, profile = ACTIVE_ALPHA_SEMANTIC_PROFILE) => {
      const parsed = createTeachingInterpretationSchema(profile).parse(candidate);
      const proposal = normalizeTeachingProposal(parsed);
      const request = { ...input, policyVersion: profile.policyVersion, semanticProfileId: profile.id };
      return validateAndNormalizeProposal({ proposal, request, allCheckpoints: input.newEvidence, state: createInitialTeachingState(), model: "test", profile });
    };

    for (const mode of ["RECONSTRUCT", "REPRESENT"]) expect(validate(raw({ action: "SET_ACTIVE", contribution: board(mode), continuity: "same_thread", retainPrevious: false, support: null, invalidatesBoardItemIds: null }, { action: "KEEP" })).ok).toBe(true);
    const augment = raw({ action: "SET_ACTIVE", contribution: board("AUGMENT", domainProvenance), continuity: "same_thread", retainPrevious: false, support: null, invalidatesBoardItemIds: null }, { action: "KEEP" });
    expect(teachingInterpretationSchema.safeParse(augment).success).toBe(false);
    expect(validate(augment, ALPHA_AUGMENT_CANDIDATE_P4).ok).toBe(true);
    for (const kind of ["NOTE", "QUESTION", "TASK", "HINT"] as const) expect(validate(raw({ action: "KEEP", reason: "no_board_value" }, { action: "SET", cueKind: kind, contribution: text("REPRESENT"), targetBoardItemId: null })).ok).toBe(true);

    const invalid = [
      raw({ action: "SET_ACTIVE", contribution: board("INITIATE"), continuity: "same_thread", retainPrevious: false, support: null, invalidatesBoardItemIds: null }, { action: "KEEP" }),
      raw({ action: "SET_ACTIVE", contribution: board("CORRECT"), continuity: "correction", retainPrevious: false, support: null, invalidatesBoardItemIds: ["existing"] }, { action: "KEEP" }),
      raw({ action: "KEEP", reason: "no_board_value" }, { action: "SET", cueKind: "NOTE", contribution: text("INITIATE"), targetBoardItemId: null }),
      raw({ action: "KEEP", reason: "no_board_value" }, { action: "SET", cueKind: "HINT", contribution: text("AUGMENT", domainProvenance), targetBoardItemId: null }),
    ];
    for (const candidate of invalid) expect(teachingInterpretationSchema.safeParse(candidate).success).toBe(false);
  });
});
