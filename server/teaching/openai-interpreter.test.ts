import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeachingInterpretationRequest } from "../../src/lesson-stream/contracts";
import { createInitialTeachingState } from "../../src/lesson-stream/teaching-state";

const mocks = vi.hoisted(() => ({ constructor: vi.fn(), parse: vi.fn() }));
vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(options: unknown) { mocks.constructor(options); }
    responses = { parse: mocks.parse };
  },
}));

import { estimateTeachingCost, requestOpenAITeachingInterpretation } from "./openai-interpreter";
import { normalizeTeachingProposal } from "./provider-contract";
import { validateAndNormalizeProposal } from "../../src/lesson-stream/accepted-interpretations";

const input: TeachingInterpretationRequest = {
  requestId: "request-1",
  sessionId: "session-1",
  policyVersion: "bounded-agent-p4-bootstrap-v1",
  processedTimeline: [{ type: "evidence", checkpointId: "checkpoint-0", sequence: 1, text: "Activation energy is required.", warnings: [] }],
  currentState: createInitialTeachingState(),
  newEvidence: [{ checkpointId: "checkpoint-1", lessonSequence: 2, speechRunId: 1, startMs: 100, endMs: 200, text: "Temperature increases.", sourceFinalIds: ["provider-final-1"], warnings: [] }],
  expected: { firstUnconsumedSequence: 2, lastUnconsumedSequence: 2 },
};

describe("OpenAI Teaching State interpreter", () => {
  beforeEach(() => {
    mocks.constructor.mockReset();
    mocks.parse.mockReset();
  });

  it("uses one structured P4 request and exposes compact usage", async () => {
    mocks.parse.mockResolvedValue({
      output_parsed: {
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
      },
      usage: { input_tokens: 300, output_tokens: 40, total_tokens: 340, input_tokens_details: { cached_tokens: 80 } },
    });
    const controller = new AbortController();
    const result = await requestOpenAITeachingInterpretation(input, "test-key", "gpt-5.6-luna", { signal: controller.signal });
    expect(result).toMatchObject({ proposal: { requestId: "request-1", steps: [{ boardDelta: { action: "KEEP" } }] }, usage: { inputTokens: 300, cachedInputTokens: 80, outputTokens: 40, totalTokens: 340 } });
    const request = mocks.parse.mock.calls[0]![0];
    expect(request.reasoning).toEqual({ effort: "none" });
    expect(request.temperature).toBe(0);
    expect(request.input[0].content).toContain("currentState is current authority");
    expect(request.input[0].content).toContain("newEvidence is the only allowed trigger");
    expect(request.input[0].content).toContain("board-${requestId}-accepted-N");
    expect(request.input[0].content).toContain("zero-based earlier step index");
    expect(request.input[0].content).toContain("Cue SET targetBoardItemId is optional");
    expect(request.input[0].content).toContain("this step's own deterministic SET_ACTIVE ID");
    expect(request.input[1].content).toBe(JSON.stringify(input));
    expect(request.input[1].content).not.toContain('"words"');
    expect(request.input[1].content).not.toContain("providerEvidence");
    expect(mocks.parse.mock.calls[0]![1]).toEqual({ signal: controller.signal });
  });

  it("estimates cost only from explicitly configured rates", () => {
    const usage = { inputTokens: 300, cachedInputTokens: 80, outputTokens: 40, totalTokens: 340 };
    expect(estimateTeachingCost(usage, {})).toBeUndefined();
    expect(estimateTeachingCost(usage, { inputPerMillion: 1, cachedInputPerMillion: 0.25, outputPerMillion: 4 })).toBeCloseTo(0.0004);
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
});
