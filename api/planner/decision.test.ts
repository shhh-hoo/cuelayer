import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannerInput, RuntimeDecision } from "../../src/planner/contracts";

const mocks = vi.hoisted(() => ({ openAI: vi.fn(), trace: vi.fn() }));
vi.mock("./openai-planner.ts", () => ({ requestOpenAIPlannerResult: mocks.openAI }));
vi.mock("../trace/api-trace.ts", () => ({
  traceHeaders: () => ({ sessionId: "session-api-test", apiRequestId: "api-test", plannerRequestId: "planner-test", writeCapability: "w".repeat(43) }),
  traceExternalCall: (options: unknown, call: () => Promise<unknown>) => { mocks.trace(options); return call(); },
}));

import handler from "./decision";

const input: PlannerInput = { recentSpeech: [{ id: "speech-span-0", text: "A useful proposition.", words: [] }] };
const decision: RuntimeDecision = { display: { kind: "TEXT" }, learner: { kind: "NONE" } };
function responseCapture() { let code = 0; let body: unknown; return { response: { setHeader: vi.fn(), status(statusCode: number) { code = statusCode; return { json(value: unknown) { body = value; } }; } }, result: () => ({ code, body }) }; }

describe("live planner OpenAI contract", () => {
  const originalOpenAI = process.env.OPENAI_API_KEY; const originalModel = process.env.OPENAI_MODEL;
  beforeEach(() => { mocks.openAI.mockReset(); mocks.trace.mockReset(); delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_MODEL; });
  afterEach(() => { if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAI; if (originalModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = originalModel; });

  it("reports planner-not-configured without an OpenAI key", async () => {
    const captured = responseCapture(); await handler({ method: "POST", body: input }, captured.response);
    expect(captured.result()).toEqual({ code: 503, body: { error: "planner-not-configured" } }); expect(mocks.openAI).not.toHaveBeenCalled();
  });

  it("uses OpenAI Luna by default and traces the OpenAI provider", async () => {
    process.env.OPENAI_API_KEY = "openai-key"; mocks.openAI.mockResolvedValue({ decision }); const captured = responseCapture();
    await handler({ method: "POST", body: input }, captured.response);
    expect(mocks.openAI).toHaveBeenCalledWith(input, "openai-key", "gpt-5.6-luna", { signal: undefined });
    expect(mocks.trace).toHaveBeenCalledWith(expect.objectContaining({ provider: "openai", model: "gpt-5.6-luna", operation: "teaching_planner.decision" }));
    expect(captured.result()).toEqual({ code: 200, body: { decision } });
  });

  it("honours an explicit OpenAI model override", async () => {
    process.env.OPENAI_API_KEY = "openai-key"; process.env.OPENAI_MODEL = "gpt-5.6-sol"; mocks.openAI.mockResolvedValue({ decision }); const captured = responseCapture();
    await handler({ method: "POST", body: input }, captured.response);
    expect(mocks.openAI).toHaveBeenCalledWith(input, "openai-key", "gpt-5.6-sol", { signal: undefined });
  });
});
