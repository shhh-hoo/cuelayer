import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ jwt: vi.fn(), trace: vi.fn(), headers: vi.fn() }));
vi.mock("@speechmatics/auth", () => ({ createSpeechmaticsJWT: mocks.jwt }));
vi.mock("./trace/api-trace.ts", () => ({
  TracedExternalCallError: class extends Error {},
  traceHeaders: mocks.headers,
  traceExternalCall: async (options: unknown, call: () => Promise<unknown> | unknown) => { mocks.trace(options); return { result: await call(), traceDelivery: { events: [] } }; },
}));

import handler from "../api/speechmatics/token";

function responseCapture() { let code = 0; let body: unknown; return { response: { setHeader: vi.fn(), status(statusCode: number) { code = statusCode; return { json(value: unknown) { body = value; } }; } }, result: () => ({ code, body }) }; }

describe("Speechmatics token endpoint observability isolation", () => {
  const original = process.env.SPEECHMATICS_API_KEY;
  beforeEach(() => { process.env.SPEECHMATICS_API_KEY = "speech-key"; mocks.jwt.mockReset(); mocks.jwt.mockResolvedValue("token"); mocks.trace.mockReset(); mocks.headers.mockReset(); mocks.headers.mockReturnValue({}); });
  afterEach(() => { if (original === undefined) delete process.env.SPEECHMATICS_API_KEY; else process.env.SPEECHMATICS_API_KEY = original; });

  it("issues a token without trace headers", async () => {
    const captured = responseCapture(); await handler({ method: "POST", headers: {} }, captured.response);
    expect(captured.result()).toEqual({ code: 200, body: { token: "token", traceEvents: [] } });
    expect(mocks.trace).toHaveBeenCalledWith(expect.objectContaining({ sessionId: undefined }));
  });
});
