import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannerInput, RuntimeDecision } from "../../src/planner/contracts";

const mocks = vi.hoisted(() => ({ constructor: vi.fn(), parse: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(options: unknown) { mocks.constructor(options); }
    responses = { parse: mocks.parse };
  },
}));

import { createOpenAIPlannerRequest, createOpenAIPlannerTraceRequest, requestOpenAIPlannerResult } from "./openai-planner";

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
      id: "resp_123",
      model: "gpt-5.6-luna",
      output_parsed: output,
      usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150, input_tokens_details: { cached_tokens: 20 } },
      service_tier: "priority",
    });
    const controller = new AbortController();
    const request = createOpenAIPlannerRequest(input, "gpt-5.6-luna", { serviceTier: "priority" });
    await expect(requestOpenAIPlannerResult(request, "test-key", { signal: controller.signal })).resolves.toEqual({
      decision: output,
      usage: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 30, totalTokens: 150 },
      serviceTier: "priority",
      providerResponse: {
        id: "resp_123", model: "gpt-5.6-luna", service_tier: "priority", output_parsed: output,
        usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150, input_tokens_details: { cached_tokens: 20 } },
      },
    });
    expect(mocks.constructor).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(mocks.parse.mock.calls[0]?.[0]).toBe(request);
    expect(request.model).toBe("gpt-5.6-luna");
    expect(request.service_tier).toBe("priority");
    expect(request.reasoning).toEqual({ effort: "none" });
    expect(request.temperature).toBe(0);
    expect(request.max_output_tokens).toBe(1_024);
    expect(request.input[0].content).toContain("skills/9701-cuecaption/live-policy.md");
    expect(request.input[0].content).toContain("RELATE requires two or more distinct targets");
    expect(request.input[0].content).toContain('TEXT is exactly { kind: "TEXT" }');
    expect(request.input[1].content).toBe(JSON.stringify(input));
    expect(request.text.format).toBeDefined();
    expect(mocks.parse.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
  });

  it("keeps the static policy out of each durable planner request fact", () => {
    const request = createOpenAIPlannerRequest(input, "gpt-5.6-luna");
    const trace = createOpenAIPlannerTraceRequest(input, request);
    expect(JSON.stringify(trace)).not.toContain("RELATE requires two or more distinct targets");
    expect(trace).toMatchObject({ model: "gpt-5.6-luna", plannerInput: input, policy: { sourceHash: expect.any(String), sourceFiles: expect.any(Array) } });
  });
});
