import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpSemanticPlanner } from "./semantic-planner";

describe("HTTP planner observability isolation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the planner decision without waiting for trace persistence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ decision: { display: { kind: "QUIET", reason: "filler" }, learner: { kind: "NONE" } }, traceEvents: [{ id: "fact" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const neverSettles = vi.fn(() => new Promise(() => undefined));
    const decision = await createHttpSemanticPlanner().decide({ recentSpeech: [{ id: "span", text: "hello", words: [] }] }, { onTraceEvents: neverSettles });
    expect(decision).toMatchObject({ display: { kind: "QUIET" } });
    expect(neverSettles).toHaveBeenCalledOnce();
  });
});
