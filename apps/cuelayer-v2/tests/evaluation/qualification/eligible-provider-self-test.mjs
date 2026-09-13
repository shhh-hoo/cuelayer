import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { evaluatorRoot } from "../manifest.mjs";
import { Provenance, git } from "../provenance.mjs";
import { loadSharedExecutionProduct } from "../shared-execution-manifest.mjs";
import { loadMicroCorpus } from "./contract.mjs";
import { generateMicroSnapshots } from "./capture.mjs";
import {
  buildCandidatePayload,
  providerResponseForCandidate,
  ELIGIBLE_MODEL_CONFIGURATIONS,
  validateEligibleCandidate,
} from "./provider.mjs";

// Exact researched snapshots, independently listed so a changed adapter cannot
// silently enlarge the cohort. Injected SSE is mechanical evidence only.
const reasoningModels = [
  "gpt-5.4-2026-03-05",
  "gpt-5.4-mini-2026-03-17",
  "gpt-5.4-nano-2026-03-17",
  "gpt-5.2-2025-12-11",
  "gpt-5.1-2025-11-13",
  "gpt-5-2025-08-07",
  "gpt-5-mini-2025-08-07",
  "gpt-5-nano-2025-08-07",
  "o1-2024-12-17",
  "o3-2025-04-16",
  "o3-mini-2025-01-31",
  "o4-mini-2025-04-16",
];
const nonreasoningModels = [
  "gpt-4.1-2025-04-14",
  "gpt-4o-2024-08-06",
  "gpt-4.1-mini-2025-04-14",
  "gpt-4.1-nano-2025-04-14",
  "gpt-4o-mini-2024-07-18",
];
const candidate = (model) => ({
  model,
  provider: "openai",
  service_tier: "standard",
  max_output_tokens: 8192,
  configuration: reasoningModels.includes(model)
    ? { reasoning: { effort: "medium" } }
    : {},
});
const semanticPayload = (payload) =>
  Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) =>
        !["model", "reasoning", "max_output_tokens", "service_tier"].includes(
          key,
        ),
    ),
  );
test("screening adapter permits exactly the reviewed dated snapshots and preserves semantic fields", () => {
  assert.deepEqual(
    Object.keys(ELIGIBLE_MODEL_CONFIGURATIONS).sort(),
    [...reasoningModels, ...nonreasoningModels].sort(),
  );
  const original = {
    model: "gpt-6-astra",
    reasoning: { effort: "low" },
    input: [{ role: "user", content: "Exact source punctuation: P = F/A." }],
    instructions: "Exact unchanged policy.",
    text: {
      format: { type: "json_schema", strict: true, schema: { type: "object" } },
    },
    stream: true,
    store: false,
  };
  for (const model of [...reasoningModels, ...nonreasoningModels]) {
    const payload = buildCandidatePayload(original, candidate(model));
    assert.deepEqual(semanticPayload(payload), semanticPayload(original));
    assert.equal(payload.model, model);
    assert.equal(payload.service_tier, "default");
    assert.equal(payload.max_output_tokens, 8192);
    if (reasoningModels.includes(model))
      assert.deepEqual(payload.reasoning, { effort: "medium" });
    else assert.equal(Object.hasOwn(payload, "reasoning"), false);
  }
  assert.deepEqual(original.reasoning, { effort: "low" });
});
test("screening rejects aliases, wrong efforts, nonreasoning none, tools and sampling overlays", () => {
  for (const model of [
    "gpt-5.4",
    "gpt-4o-2024-05-13",
    "gpt-6-astra",
    "unknown",
  ])
    assert.throws(
      () => validateEligibleCandidate(candidate(model)),
      /unsupported/,
    );
  for (const configuration of [
    { reasoning: { effort: "low" } },
    { reasoning: { effort: "medium", summary: "auto" } },
    { reasoning: { effort: "medium" }, temperature: 0 },
    { tools: [] },
  ])
    assert.throws(
      () =>
        buildCandidatePayload(
          {},
          {
            ...candidate(reasoningModels[0]),
            configuration,
          },
        ),
      /unsupported/,
    );
  for (const configuration of [
    { reasoning: { effort: "none" } },
    { reasoning: null },
  ])
    assert.throws(
      () =>
        buildCandidatePayload(
          {},
          {
            ...candidate(nonreasoningModels[0]),
            configuration,
          },
        ),
      /unsupported/,
    );
});

test("all seventeen exact configurations use real product Live and Stage SDK bytes and shared parser", async () => {
  const productRoot =
    process.env.GATE3B_QUALIFICATION_PRODUCT_ROOT ??
    resolve(evaluatorRoot, "../cuelayer-v2-terminal-review57");
  const provenance = new Provenance(productRoot, evaluatorRoot, {
    productSha: git(productRoot, "rev-parse", "HEAD"),
    allowDirtyEvaluator: true,
  });
  const product = await loadSharedExecutionProduct(provenance);
  const snapshots = await generateMicroSnapshots(
    product,
    await loadMicroCorpus(),
  );
  const selected = ["Live", "Stage"].map((lane) =>
    snapshots.find((s) => s.task.lane === lane),
  );
  let dispatches = 0;
  for (const snapshot of selected)
    for (const model of [...reasoningModels, ...nonreasoningModels]) {
      const c = candidate(model),
        payload = buildCandidatePayload(snapshot.payload, c);
      const answer =
        snapshot.task.lane === "Stage"
          ? {
              scope: snapshot.request.scope,
              results: snapshot.request.items.map((item) => ({
                item: item.id,
                outcome: "STILL_OPEN",
              })),
            }
          : {
              scope: snapshot.request.scope,
              groups: [
                {
                  outcome: "NO_CHANGE",
                  throughBoundary: snapshot.request.source.end,
                },
              ],
              continuation: "NONE",
              reviewRequests: [],
              attentionCandidate: null,
            };
      const terminal = {
        id: "resp-offline-screening",
        model,
        status: "completed",
        service_tier: "default",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          input_tokens_details: { cached_tokens: 20 },
          output_tokens_details: { reasoning_tokens: 10 },
        },
      };
      const capture = product.execution.capturedRequest(snapshot.task);
      const response = await providerResponseForCandidate(payload, c, {
        product,
        capture,
        apiKey: "offline-not-a-key",
        signal: new AbortController().signal,
        timeoutMs: 30000,
        fetch: async (url, init) => {
          dispatches++;
          assert.equal(String(url), "https://api.openai.com/v1/responses");
          assert.equal(init.body, JSON.stringify(payload));
          assert.deepEqual(
            semanticPayload(JSON.parse(init.body)),
            semanticPayload(snapshot.payload),
          );
          return new Response(
            [
              {
                type: "response.created",
                response: { ...terminal, status: "in_progress" },
              },
              {
                type: "response.output_text.delta",
                delta: JSON.stringify(answer),
              },
              { type: "response.completed", response: terminal },
            ]
              .map((event) => "data: " + JSON.stringify(event) + "\n\n")
              .join(""),
            {
              headers: { "Content-Type": "text/event-stream" },
            },
          );
        },
      });
      assert.equal(
        response.headers.get("X-V2-Provider-Request-Bytes"),
        String(Buffer.byteLength(JSON.stringify(payload))),
      );
      const result = await product.execution.executeCapturedRequest(capture, {
        signal: new AbortController().signal,
        transport: async () => response,
      });
      assert.equal(result.provider.completed, true);
      assert.equal(result.provider.actualModel, model);
      assert.equal(
        result.provider.usage.output_tokens_details.reasoning_tokens,
        10,
      );
      assert.equal(typeof result.proposal, "object");
    }
  assert.equal(dispatches, 34);
});
