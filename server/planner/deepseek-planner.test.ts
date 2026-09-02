import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannerInput, RuntimeDecision } from "../../src/planner/contracts";

const mocks = vi.hoisted(() => ({ constructor: vi.fn(), parse: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(options: unknown) { mocks.constructor(options); }
    responses = { parse: mocks.parse };
  },
}));

import { deepSeekPlannerFailureReason, requestDeepSeekPlannerDecision } from "./deepseek-planner";

const input: PlannerInput = {
  recentSpeech: [{ id: "committed-0", text: "temperature increases", words: [{ text: "temperature", startMs: 0, endMs: 100 }, { text: "increases", startMs: 110, endMs: 200 }] }],
};

const output: RuntimeDecision = {
  display: { kind: "QUIET", reason: "transition" },
  learner: { kind: "NONE" },
};

describe("DeepSeek planner boundary", () => {
  beforeEach(() => {
    mocks.constructor.mockReset();
    mocks.parse.mockReset();
  });

  it("feeds generated 9701 policy into exactly one structured inference call", async () => {
    mocks.parse.mockResolvedValue({ output_parsed: output });
    const controller = new AbortController();
    await expect(requestDeepSeekPlannerDecision(input, "test-key", "test-model", { signal: controller.signal })).resolves.toEqual(output);
    expect(mocks.constructor).toHaveBeenCalledWith({ apiKey: "test-key", baseURL: "https://api.deepseek.com" });
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    const request = mocks.parse.mock.calls[0]?.[0];
    expect(request.input[0].content).toContain("skills/9701-cuecaption");
    expect(request.input[0].content).toContain("skills/9701-cuecaption/live-policy.md");
    expect(request.input[0].content).toContain("explicit runtime operational subset");
    expect(request.input[0].content).toContain("references/ambiguity-policy.md");
    expect(request.input[0].content).toContain("data/notation.yaml");
    expect(request.reasoning).toEqual({ effort: "none" });
    expect(request.temperature).toBe(0);
    expect(request.max_output_tokens).toBe(1_024);
    expect(request.text.format).toBeDefined();
    expect(mocks.parse.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
  });

  it("classifies development failures without exposing provider messages", () => {
    expect(deepSeekPlannerFailureReason(new SyntaxError("Error reading response: invalid structured output JSON."))).toBe("planner-invalid-structured-output");
    expect(deepSeekPlannerFailureReason({ status: 401, message: "secret-bearing provider response" })).toBe("planner-provider-http-401");
    expect(deepSeekPlannerFailureReason(new Error("unexpected secret-bearing response"))).toBe("planner-provider-unavailable");
  });
});
