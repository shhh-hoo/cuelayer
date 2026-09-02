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

const input: TeachingInterpretationRequest = {
  requestId: "request-1",
  sessionId: "session-1",
  policyVersion: "live-state-p4-v1",
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
});
