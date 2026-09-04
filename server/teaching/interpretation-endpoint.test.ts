import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeachingInterpretationRequest } from "../../src/lesson-stream/contracts";
import { createInitialTeachingState } from "../../src/lesson-stream/teaching-state";
import { ACTIVE_ALPHA_SEMANTIC_PROFILE } from "../../src/lesson-stream/semantic-profile";

const mocks = vi.hoisted(() => ({ interpret: vi.fn() }));
vi.mock("./openai-interpreter.ts", () => ({ requestOpenAITeachingInterpretation: mocks.interpret, estimateTeachingCost: () => undefined }));

import handler from "../../api/teaching/interpretation";

const input: TeachingInterpretationRequest = {
  requestId: "request-1",
  sessionId: "session-1",
  policyVersion: ACTIVE_ALPHA_SEMANTIC_PROFILE.policyVersion,
  semanticProfileId: ACTIVE_ALPHA_SEMANTIC_PROFILE.id,
  processedTimeline: [],
  currentState: createInitialTeachingState(),
  newEvidence: [{ checkpointId: "checkpoint-1", lessonSequence: 1, speechRunId: 1, startMs: 0, endMs: 100, text: "A useful statement.", sourceFinalIds: ["final-1"], warnings: [] }],
  expected: { firstUnconsumedSequence: 1, lastUnconsumedSequence: 1 },
};

function responseCapture() {
  let code = 0;
  let body: unknown;
  return {
    response: { setHeader: vi.fn(), status(statusCode: number) { code = statusCode; return { json(value: unknown) { body = value; } }; } },
    result: () => ({ code, body }),
  };
}

describe("Teaching State interpretation endpoint", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    mocks.interpret.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.useRealTimers();
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it("forwards the bounded request to the configured model", async () => {
    const result = { proposal: { requestId: "request-1", baseBoardRevision: 0, baseCueRevision: 0, steps: [] } };
    mocks.interpret.mockResolvedValue(result);
    const captured = responseCapture();
    await handler({ method: "POST", body: input }, captured.response);
    expect(mocks.interpret).toHaveBeenCalledWith(input, "test-key", "gpt-5.6-luna", { signal: expect.any(AbortSignal) });
    expect(captured.result()).toEqual({ code: 200, body: result });
  });

  it("enforces the independent 6000 ms hard deadline", async () => {
    vi.useFakeTimers();
    mocks.interpret.mockImplementation((_input, _key, _model, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }));
    const captured = responseCapture();
    const pending = handler({ method: "POST", body: input }, captured.response);
    await vi.advanceTimersByTimeAsync(6_000);
    await pending;
    expect(captured.result()).toEqual({ code: 502, body: { error: "teaching-interpretation-timeout" } });
  });
});
