import { expect, it } from "vitest";
import { evaluateCoreCase, loadCoreCorpus, materializeCoreExemplar, validateCoreCorpus } from "./semantic-evaluation.ts";

it("validates the independent Core corpus through the real offline interpretation boundary", async () => {
  const result = await validateCoreCorpus();
  expect(result.failures).toEqual([]); expect(result.passed).toBe(result.cases); expect(result.cases).toBeGreaterThanOrEqual(21);
  expect(result.modelCalls).toBe(0);
});
it("does not give a semantic pass to an always-noop provider", async () => {
  const item = loadCoreCorpus().cases.find(c => c.tags.includes("faithful-teacher-claim"))!;
  const result = await evaluateCoreCase(item, async request => ({ outcome: { kind: "PROPOSE", steps: [{ consumes: request.context.evidence.filter(e => e.consumption === "new").map(e => e.handle), knowledgeOps: [], cueDelta: { action: "KEEP" }, evidenceRefs: [], readRefs: [], reads: { knowledge: false, cue: false }, warnings: [] }] } }));
  expect(result.pass).toBe(false); expect(result.results[0]!.failures).toContain("core-count");
});
it("rejects provider truth substitution and malformed outputs independently of schema success", async () => {
  const item = loadCoreCorpus().cases.find(c => c.tags.includes("faithful-teacher-claim"))!;
  const result = await evaluateCoreCase(item, async request => {
    const exemplar = materializeCoreExemplar(item.turns[0]!, request);
    return JSON.parse(JSON.stringify(exemplar).replaceAll("All prime numbers are odd.", "Two is prime; all other prime numbers are odd."));
  });
  expect(result.pass).toBe(false); expect(result.results[0]!.failures.some(f => f.startsWith("forbidden:"))).toBe(true);
  expect((await evaluateCoreCase(item, async () => ({ madeUp: true }))).pass).toBe(false);
});
it("detects lifecycle and topic-identity mistakes in otherwise accepted outputs", async () => {
  const item = loadCoreCorpus().cases.find(c => c.id === "CORE1-refocus")!;
  const result = await evaluateCoreCase(item, async (request, _id, turn) => {
    const exemplar = materializeCoreExemplar(item.turns[turn]!, request) as { outcome: { steps: Array<{ knowledgeOps: unknown[] }> } };
    if (turn === 2) exemplar.outcome.steps[0]!.knowledgeOps = [];
    return exemplar;
  });
  expect(result.pass).toBe(false); expect(result.results.at(-1)!.failures).toContain("current-core");
});

it("detects answer leakage in an intermediate step even when the final answer is correct", async () => {
  const item = loadCoreCorpus().cases.find(c => c.id === "CORE1-answer-order")!;
  const result = await evaluateCoreCase(item, async request => {
    const exemplar = materializeCoreExemplar(item.turns[0]!, request);
    return JSON.parse(JSON.stringify(exemplar).replace("Predict six times seven.", "Predict six times seven. The answer is forty-two."));
  });
  expect(result.pass).toBe(false);
  expect(result.results[0]!.failures).toContain("premature-content:forty-two");
});
