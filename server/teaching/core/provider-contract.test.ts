import { expect, it, vi } from "vitest";
import { buildCoreInterpretationContext } from "../../../src/lesson-stream/core/interpretation-context.ts";
import { evidence, start } from "../../../src/lesson-stream/core/test-fixtures.ts";
import { coreProviderRequest } from "./provider-contract.ts";
import { interpretCore } from "./openai-interpreter.ts";
import { CORE_INTERPRETATION_POLICY } from "./semantic-policy.ts";

const request = () => { const base = evidence(start()); return buildCoreInterpretationContext(base, { requestId: "provider", newEvidence: base.checkpoints }); };
it("uses a strict Core schema with no legacy identity or display ontology", () => {
  const wire = coreProviderRequest(request());
  const schema = JSON.stringify(wire.text.format);
  for (const forbidden of ["SET_ACTIVE", "BOARD_ITEM", "targetBoardItemId", "Retained", "TRANSFORM", "ATTACH_HINT", "baseKnowledgeRevision", "acceptedAt"]) expect(schema).not.toContain(forbidden);
  expect(schema).toContain("NEEDS_CONTEXT"); expect(schema).toContain("CREATE_CORE"); expect(schema).toContain("aiCorrection");
  expect(wire.input[1]!.content).not.toContain("synthetic-lesson");
  expect(CORE_INTERPRETATION_POLICY).toContain("Autonomous factual correction is allowed only");
  expect(CORE_INTERPRETATION_POLICY).toContain("correction threshold is deliberately higher");
});
it("parses injected provider output without a model call and rejects incomplete/invalid output", async () => {
  const transport = vi.fn(async () => ({ output_text: JSON.stringify({ outcome: { kind: "NEEDS_CONTEXT", evidence: ["e0"], query: "Compare A" } }), status: "completed" }));
  expect((await interpretCore(request(), "test-model", transport)).proposal.outcome.kind).toBe("NEEDS_CONTEXT");
  await expect(interpretCore(request(), "test-model", async () => ({ output_text: "{}", status: "incomplete" }))).rejects.toThrow("incomplete");
  await expect(interpretCore(request(), "test-model", async () => ({ output_text: "not json" }))).rejects.toThrow();
  const controller = new AbortController(); controller.abort();
  await expect(interpretCore(request(), "test-model", transport, controller.signal)).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each(["invalid-json", "invalid-schema", "incomplete"])("records raw %s response before normalization rejects it", async failure => {
  const output_text = failure === "invalid-json" ? "{broken" : '{"unknown":true}';
  const response = { output_text, status: failure === "incomplete" ? "incomplete" : "completed", model: "actual-test-model", id: "response-test", requestId: "request-test", usage: { input_tokens: 10, output_tokens: 4 }, output: [{ type: "message", content: output_text }] };
  const record = vi.fn();
  await expect(interpretCore(request(), "requested-test-model", async () => response, undefined, record)).rejects.toThrow();
  expect(record).toHaveBeenCalledTimes(1);
  expect(record.mock.calls[0]![0]).toMatchObject({ requestedModel: "requested-test-model", response });
  expect(record.mock.calls[0]![0].elapsedMs).toBeGreaterThanOrEqual(0);
});
it("records transport timing without inventing raw output or retrying", async () => {
  const transport = vi.fn(async () => { throw new Error("offline transport failure"); }), record = vi.fn();
  await expect(interpretCore(request(), "test-model", transport, undefined, record)).rejects.toThrow("offline transport failure");
  expect(transport).toHaveBeenCalledTimes(1);
  expect(record.mock.calls[0]![0]).toMatchObject({ transportError: "offline transport failure" });
  expect(record.mock.calls[0]![0].response).toBeUndefined();
});
