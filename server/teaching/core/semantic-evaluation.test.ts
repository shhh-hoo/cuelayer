import { interpretCore } from "./openai-interpreter.ts";
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

it("retains proposal and call diagnostics when semantic validation rejects", async () => {
  const item = loadCoreCorpus().cases[0]!;
  const output = { outcome: { kind: "PROPOSE", steps: [{ consumes: ["e0"], knowledgeOps: [{ action: "SET_CURRENT_CORE", core: { existing: "missing" } }], cueDelta: { action: "KEEP" }, evidenceRefs: ["e0"], readRefs: [], reads: { knowledge: false, cue: false }, warnings: [] }] } };
  const response = { output_text: JSON.stringify(output), model: "offline-test", usage: { output_tokens: 50 } };
  const result = await evaluateCoreCase(item, async (_request, _id, _turn, record) => {
    record({ requestedModel: "offline-test", startedAt: "2026-09-07T00:00:00Z", elapsedMs: 12, response });
    return output;
  });
  expect(result.pass).toBe(false);
  expect(result.results[0]!.proposal).toEqual(output);
  expect(result.results[0]!.diagnostic?.response).toEqual(response);
  expect(result.results[0]!.failures[0]).toContain("capability-denied");
});

it("keeps the original corpus frozen and validates a disjoint fresh holdout without model calls", async () => {
  const baseline = loadCoreCorpus(), fresh = loadCoreCorpus(undefined, "fresh-holdout");
  expect(baseline.hash).toBe("0deb20adc39df55e3d63231404e0f2ba4eb7660db86e53e9a678314132afcf9e");
  expect(fresh.cases).toHaveLength(8);
  expect(fresh.cases.every(c => c.split === "holdout" && !baseline.cases.some(b => b.id === c.id))).toBe(true);
  const validation = await validateCoreCorpus("fresh-holdout");
  expect(validation.failures).toEqual([]);
  expect(validation.modelCalls).toBe(0);
});

it("preserves raw diagnostic output when parsing fails before a proposal is returned", async () => {
  const item = loadCoreCorpus().cases[0]!;
  const result = await evaluateCoreCase(item, async (request, _id, _turn, record) => (await interpretCore(request, "offline-test", async () => ({ output_text: "not JSON", model: "offline-actual" }), undefined, record)).proposal);
  expect(result.pass).toBe(false);
  expect(result.results[0]!.proposal).toBeUndefined();
  expect(result.results[0]!.diagnostic?.response?.output_text).toBe("not JSON");
});

// Authored examples exercise the existing scorer; neither frozen corpus is edited.
function predicateFixture(sentence: string, all: string[][], none: string[] = [], forbidden: string[] = []) {
  const provenance = { speech: ["e0"], state: [], domain: null };
  return { id: "authoring-components", split: "development", tags: ["predicate-authoring"], rationale: "Deterministic authoring checks, not a model benchmark.", turns: [{
    speech: [sentence], references: {}, domainRules: [], partial: false,
    exemplar: { outcome: { kind: "PROPOSE", steps: [{ consumes: ["e0"], knowledgeOps: [
      { action: "CREATE_CORE", as: "main", provenance },
      { action: "ADD_OBJECT", core: { created: "main" }, as: "claim", value: { text: sentence, provenance } },
      { action: "SET_CURRENT_CORE", core: { created: "main" } },
    ], cueDelta: { action: "KEEP" }, evidenceRefs: ["e0"], readRefs: [], reads: { knowledge: false, cue: false }, warnings: [] }] } },
    expected: { outcome: "PROPOSE", cores: 1, currentContains: null, cueKind: null, facts: [{ location: "OBJECT", all, none, status: "valid" }], forbidden, minSteps: 1, minOperations: 0, sameCurrent: false, domainFacts: 0 },
  }] };
}
it.each(["Pressure must be adequate for the pump.", "The pump requires sufficient pressure."])("accepts compositional predicates across reviewed surface variation: %s", paraphrase => {
  const fixture = predicateFixture("The pump needs adequate pressure.", [["pump"], ["pressure"], ["adequate", "sufficient"]]);
  const output = predicateFixture(paraphrase, []).turns[0]!.exemplar;
  return evaluateCoreCase(fixture, async () => output).then(result => expect(result.pass).toBe(true));
});
it.each([
  { distinction: "missing component", good: "The pump needs adequate pressure.", bad: "The pump needs adequate cooling.", all: [["pump"], ["pressure"], ["adequate"]], none: [], forbidden: [] },
  { distinction: "negation", good: "The valve does not open below ten degrees.", bad: "The valve does open below ten degrees.", all: [["valve"], ["below ten degrees"], ["does not open", "stays closed"]], none: ["does open"], forbidden: [] },
  { distinction: "quantity", good: "The tank holds ten litres.", bad: "The tank holds nine litres.", all: [["tank"], ["ten litres", "10 litres"]], none: ["nine litres"], forbidden: [] },
  { distinction: "direction", good: "Water flows from inlet to outlet.", bad: "Water flows from outlet to inlet.", all: [["water"], ["from inlet to outlet"]], none: ["from outlet to inlet"], forbidden: [] },
  { distinction: "condition", good: "The motor runs only when power is on.", bad: "The motor runs even when power is off.", all: [["motor"], ["only when power is on"]], none: ["even when power is off"], forbidden: [] },
  { distinction: "prohibited content", good: "The pump circulates water.", bad: "The pump circulates water. The secret answer is forty-two.", all: [["pump"], ["water"]], none: [], forbidden: ["secret answer"] },
])("keeps $distinction testable with explicit authored constraints", async ({ good, bad, all, none, forbidden }) => {
  const fixture = predicateFixture(good, all, none, forbidden);
  expect((await evaluateCoreCase(fixture)).pass).toBe(true);
  const result = await evaluateCoreCase(fixture, async () => predicateFixture(bad, []).turns[0]!.exemplar);
  expect(result.pass).toBe(false);
  expect(result.results[0]!.failures).toContain(forbidden.length ? "forbidden:secret answer" : "fact:0");
});
it("enforces explicit exclusions even when all positive components are present", async () => {
  const fixture = predicateFixture("The valve stays closed below ten degrees.", [["valve"], ["stays closed"], ["below ten degrees"]], ["opens regardless"]);
  const result = await evaluateCoreCase(fixture, async () => predicateFixture("The valve stays closed below ten degrees, but opens regardless of temperature.", []).turns[0]!.exemplar);
  expect(result.results[0]!.failures).toContain("fact:0");
});
