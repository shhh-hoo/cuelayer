import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannerInput, RuntimeDecision } from "../../src/planner/contracts";

const mocks = vi.hoisted(() => ({ openAI: vi.fn() }));
vi.mock("./openai-planner.ts", () => ({ requestOpenAIPlannerDecision: mocks.openAI }));

import handler from "./decision";

const input: PlannerInput = { recentSpeech: [{ id: "speech-span-0", text: "A useful proposition.", words: [] }] };
const decision: RuntimeDecision = { display: { kind: "TEXT" }, learner: { kind: "NONE" } };

function responseCapture() {
  let code = 0;
  let body: unknown;
  return {
    response: {
      setHeader: vi.fn(),
      status(statusCode: number) { code = statusCode; return { json(value: unknown) { body = value; } }; },
    },
    result: () => ({ code, body }),
  };
}

describe("live planner provider selection", () => {
  const originalDeepSeek = process.env.DEEPSEEK_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;
  const originalOpenAIModel = process.env.OPENAI_MODEL;

  beforeEach(() => {
    mocks.openAI.mockReset();
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
  });

  afterEach(() => {
    if (originalDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = originalDeepSeek;
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAI;
    if (originalOpenAIModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = originalOpenAIModel;
  });

  it("requires the validated OpenAI runtime even when a stale DeepSeek key remains configured", async () => {
    process.env.DEEPSEEK_API_KEY = "stale-deepseek-key";
    const captured = responseCapture();

    await handler({ method: "POST", body: input }, captured.response);

    expect(mocks.openAI).not.toHaveBeenCalled();
    expect(captured.result()).toEqual({ code: 503, body: { error: "planner-not-configured" } });
  });

  it("uses OpenAI Luna and ignores a stale DeepSeek key", async () => {
    process.env.DEEPSEEK_API_KEY = "stale-deepseek-key";
    process.env.OPENAI_API_KEY = "openai-key";
    mocks.openAI.mockResolvedValue(decision);
    const captured = responseCapture();

    await handler({ method: "POST", body: input }, captured.response);

    expect(mocks.openAI).toHaveBeenCalledWith(input, "openai-key", "gpt-5.6-luna", { signal: expect.any(AbortSignal) });
    expect(captured.result()).toEqual({ code: 200, body: { decision } });
  });

  it("honours an explicit OpenAI model override", async () => {
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.OPENAI_MODEL = "gpt-5.6-sol";
    mocks.openAI.mockResolvedValue(decision);
    const captured = responseCapture();

    await handler({ method: "POST", body: input }, captured.response);

    expect(mocks.openAI).toHaveBeenCalledWith(input, "openai-key", "gpt-5.6-sol", { signal: expect.any(AbortSignal) });
  });

  it("returns a controlled provider failure instead of an unhandled function error", async () => {
    process.env.OPENAI_API_KEY = "openai-key";
    mocks.openAI.mockRejectedValue(Object.assign(new Error("provider failed"), { status: 429 }));
    const captured = responseCapture();

    await handler({ method: "POST", body: input }, captured.response);

    expect(captured.result()).toEqual({ code: 502, body: { error: "planner-provider-http-429" } });
  });
});
