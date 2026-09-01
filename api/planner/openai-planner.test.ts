import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannerInput, RuntimeDecision } from "../../src/planner/contracts";

const mocks = vi.hoisted(() => ({ constructor: vi.fn(), parse: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(options: unknown) { mocks.constructor(options); }
    responses = { parse: mocks.parse };
  },
}));

import { requestOpenAIPlannerResult } from "./openai-planner";

const input: PlannerInput = {
  recentSpeech: [{ id: "speech-span-0", text: "temperature increases", words: [{ text: "temperature", startMs: 0, endMs: 100 }, { text: "increases", startMs: 110, endMs: 200 }] }],
};

const output: RuntimeDecision = {
  display: { kind: "QUIET", reason: "transition" },
  learner: { kind: "NONE" },
};

describe("OpenAI planner boundary", () => {
  beforeEach(() => {
    mocks.constructor.mockReset();
    mocks.parse.mockReset();
  });

  it("uses one native structured-output Responses call and exposes token usage", async () => {
    mocks.parse.mockResolvedValue({
      output_parsed: output,
      usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150, input_tokens_details: { cached_tokens: 20 } },
      service_tier: "priority",
    });
    const controller = new AbortController();
    await expect(requestOpenAIPlannerResult(input, "test-key", "gpt-5.6-luna", { signal: controller.signal, serviceTier: "priority" })).resolves.toEqual({
      decision: output,
      usage: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 30, totalTokens: 150 },
      serviceTier: "priority",
    });
    expect(mocks.constructor).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    const request = mocks.parse.mock.calls[0]?.[0];
    expect(request.model).toBe("gpt-5.6-luna");
    expect(request.service_tier).toBe("priority");
    expect(request.reasoning).toEqual({ effort: "none" });
    expect(request.temperature).toBe(0);
    expect(request.max_output_tokens).toBe(1_024);
    expect(request.input[0].content).toContain("skills/9701-cuecaption/live-policy.md");
    expect(request.input[0].content).toContain("RELATE requires two or more distinct targets");
    expect(request.input[0].content).toContain('TEXT is exactly { kind: "TEXT" }');
    expect(request.text.format).toBeDefined();
    expect(mocks.parse.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
  });
});
