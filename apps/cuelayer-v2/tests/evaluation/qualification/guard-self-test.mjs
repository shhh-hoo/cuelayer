import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "../evidence.mjs";
import {
  createQualificationScope,
  QUALIFICATION_IDENTITY,
  QUALIFICATION_APPROVAL_IDENTITY,
} from "./guard.mjs";

// Small authored arithmetic fixtures; these are never provider credentials or
// authorization for the real qualification manifest.
const apiKeys = { openai: "offline-openai" };
const endpoints = {
  openai: "https://api.openai.com/v1/responses",
};
function fixture(change = () => {}) {
  const candidates = [0, 1, 2].map((index) => ({
    candidate_id: "openai-test-" + index,
    provider: "openai",
    model: "openai-offline-model-" + index,
    configuration: { test: "fixed" },
    service_tier: "standard",
    max_output_tokens: 20,
    prices_usd_per_million: {
      input: 1,
      output: 2,
      cached_input: 0.25,
      cache_write: 3,
    },
  }));
  const bodies = candidates.map((c) =>
    JSON.stringify({
      model: c.model,
      configuration: c.configuration,
      input: "authored offline input",
    }),
  );
  const manifest = {
    identity: QUALIFICATION_IDENTITY,
    paid_enabled: false,
    freeze_status: "FROZEN",
    product: { sha: "product-a", modules_sha256: sha256("modules-a") },
    corpus_sha256: sha256("corpus-a"),
    oracle_sha256: sha256("oracle-a"),
    schema_sha256: sha256("schema-a"),
    prompt_sha256: sha256("prompt-a"),
    observation_profile: {
      provider_deadline_ms: 30000,
      host_deadline_ms: 35000,
      concurrency: 1,
    },
    runtime_reference: { transport_retries: 2, sdk_retries: 0 },
    repetitions: 1,
    candidates,
    trials: candidates.map((c, i) => ({
      trial_id: "trial-" + i,
      snapshot_id: "snapshot-0",
      candidate_id: c.candidate_id,
      repetition: 0,
      provider_url: endpoints[c.provider],
      payload_sha256: sha256(bodies[i]),
      input_tokens_upper_bound: 10,
    })),
    proposed_limits: {
      max_trials: 3,
      max_provider_attempts: 9,
      max_input_tokens_per_attempt: 10,
      max_output_tokens_per_attempt: 20,
      max_total_input_tokens: 90,
      max_total_output_tokens: 180,
      max_cost_usd: 1,
    },
  };
  change(manifest);
  const approval = {
    identity: QUALIFICATION_APPROVAL_IDENTITY,
    approved: true,
    manifest_sha256: sha256(manifest),
    limits_sha256: sha256(manifest.proposed_limits),
  };
  return { manifest, approval, bodies };
}
function start(change) {
  const data = fixture(change);
  const scope = createQualificationScope(data.manifest, data.approval, apiKeys);
  return {
    ...data,
    scope,
    budget: scope.discipline.budget,
    reserve: (index = 0) =>
      scope.reserve(
        data.manifest.trials[index].trial_id,
        data.manifest.trials[index].provider_url,
        "POST",
        data.bodies[index],
      ),
  };
}
const usage = (input_tokens = 10, output_tokens = 20, cached_tokens = 0) => ({
  input_tokens,
  output_tokens,
  input_tokens_details: { cached_tokens },
});

test("the OpenAI phase requires its key before the first dispatch and no unincluded provider keys", () => {
  const { manifest, approval, bodies } = fixture();
  assert.doesNotThrow(() =>
    createQualificationScope(manifest, approval, apiKeys),
  );
  for (const provider of Object.keys(endpoints)) {
    for (const absent of [undefined, "", " \t\n"]) {
      let dispatched = 0;
      const keys = { ...apiKeys, [provider]: absent };
      assert.throws(
        () => {
          const scope = createQualificationScope(manifest, approval, keys);
          scope.reserve("trial-0", endpoints.openai, "POST", bodies[0]);
          dispatched++;
        },
        (error) => {
          assert.equal(
            error.message,
            "qualification-provider-key-required:" + provider,
          );
          assert.ok(
            Object.values(apiKeys).every(
              (value) => !error.message.includes(value),
            ),
          );
          return true;
        },
      );
      assert.equal(dispatched, 0);
    }
  }
});

test("only explicit approval for the frozen manifest and its exact limits starts a scope", () => {
  for (const field of [
    "identity",
    "approved",
    "manifest_sha256",
    "limits_sha256",
  ]) {
    const { manifest, approval } = fixture();
    approval[field] = field === "approved" ? false : "changed";
    assert.throws(
      () => createQualificationScope(manifest, approval, apiKeys),
      /qualification-approval-mismatch/,
    );
  }
  for (const change of [
    (m) => (m.freeze_status = "AUTHORED"),
    (m) => (m.paid_enabled = true),
    (m) => (m.identity = "other"),
  ]) {
    const { manifest, approval } = fixture(change);
    assert.throws(
      () => createQualificationScope(manifest, approval, apiKeys),
      /qualification-not-frozen/,
    );
  }
});

const identityChanges = [
  ["product commit", (m) => (m.product.sha = "product-b")],
  ["product modules", (m) => (m.product.modules_sha256 = sha256("modules-b"))],
  ["corpus", (m) => (m.corpus_sha256 = sha256("corpus-b"))],
  ["oracle", (m) => (m.oracle_sha256 = sha256("oracle-b"))],
  ["schema", (m) => (m.schema_sha256 = sha256("schema-b"))],
  ["prompt", (m) => (m.prompt_sha256 = sha256("prompt-b"))],
  ["model", (m) => (m.candidates[0].model = "changed-model")],
  ["configuration", (m) => (m.candidates[0].configuration.test = "changed")],
  ["pricing", (m) => (m.candidates[0].prices_usd_per_million.input = 0)],
  ["deadline", (m) => (m.observation_profile.provider_deadline_ms = 60000)],
  ["retry policy", (m) => (m.runtime_reference.transport_retries = 4)],
  [
    "trial payload",
    (m) => (m.trials[0].payload_sha256 = sha256("changed-body")),
  ],
  ["trial repetition", (m) => (m.trials[0].repetition = 2)],
  ["spending ceiling", (m) => (m.proposed_limits.max_cost_usd = 100)],
];
test("changing any frozen product, corpus, model, protocol or trial identity requires new approval", () => {
  for (const [label, change] of identityChanges) {
    const { manifest, approval } = fixture();
    change(manifest);
    assert.throws(
      () => createQualificationScope(manifest, approval, apiKeys),
      /qualification-approval-mismatch/,
      label,
    );
  }
});

test("retrospective mutation invalidates an already-created scope before another attempt", () => {
  for (const [label, change] of identityChanges) {
    const f = start();
    change(f.manifest);
    assert.throws(
      () => f.scope.assertActive(),
      /qualification-approval-drift/,
      label,
    );
    assert.throws(() => f.reserve(), /qualification-approval-drift/, label);
    assert.equal(f.budget.calls.length, 0);
  }
  const f = start();
  f.approval.approved = false;
  assert.throws(() => f.reserve(), /qualification-approval-drift/);
});

test("detecting approval drift remains terminal even if the caller restores the old bytes", () => {
  const f = start(),
    id = f.reserve(),
    original = f.manifest.product.sha;
  f.manifest.product.sha = "changed-after-dispatch";
  assert.throws(
    () => f.budget.settle(id, usage(), f.manifest.candidates[0].model),
    /qualification-approval-drift/,
  );
  f.manifest.product.sha = original;
  assert.throws(() => f.reserve(1), /qualification-approval-drift/);
  assert.equal(f.budget.calls.length, 1);
  assert.equal(f.budget.calls[0].settled, false);
});

test("all price fields and limits must be finite and valid before reserving cost", () => {
  for (const field of ["input", "output", "cached_input", "cache_write"]) {
    for (const invalid of ["invalid", NaN, Infinity, -1, null]) {
      const { manifest, approval } = fixture(
        (m) => (m.candidates[0].prices_usd_per_million[field] = invalid),
      );
      assert.throws(
        () => createQualificationScope(manifest, approval, apiKeys),
        /qualification-invalid-pricing/,
        field,
      );
    }
  }
  for (const [field, invalid] of [
    ["max_trials", 2],
    ["max_provider_attempts", 0],
    ["max_input_tokens_per_attempt", 1.5],
    ["max_output_tokens_per_attempt", -1],
    ["max_total_input_tokens", NaN],
    ["max_total_output_tokens", Infinity],
    ["max_cost_usd", 0],
  ]) {
    const { manifest, approval } = fixture(
      (m) => (m.proposed_limits[field] = invalid),
    );
    assert.throws(
      () => createQualificationScope(manifest, approval, apiKeys),
      /qualification-invalid-limit/,
      field,
    );
  }
});

test("preflight rejects duplicate identity, unknown candidate, wrong endpoint and unsafe token bounds", () => {
  for (const change of [
    (m) => (m.candidates[1].candidate_id = m.candidates[0].candidate_id),
    (m) => (m.trials[1].trial_id = m.trials[0].trial_id),
    (m) => (m.trials[0].candidate_id = "unknown"),
    (m) => (m.trials[0].provider_url = "https://example.invalid/responses"),
    (m) => (m.trials[0].payload_sha256 = "not-a-hash"),
    (m) => (m.trials[0].input_tokens_upper_bound = 11),
    (m) => (m.trials[0].input_tokens_upper_bound = 0),
    (m) => (m.candidates[0].max_output_tokens = 21),
  ]) {
    const { manifest, approval } = fixture(change);
    assert.throws(
      () => createQualificationScope(manifest, approval, apiKeys),
      /qualification-duplicate-identity|qualification-invalid-trial|qualification-output-limit-mismatch/,
    );
  }
});

test("exact trial, endpoint, method and serialized request bytes bind every attempt", () => {
  const f = start(),
    trial = f.manifest.trials[0];
  for (const args of [
    ["unplanned", trial.provider_url, "POST", f.bodies[0]],
    [trial.trial_id, "https://example.invalid/responses", "POST", f.bodies[0]],
    [trial.trial_id, trial.provider_url, "GET", f.bodies[0]],
    [trial.trial_id, trial.provider_url, "POST", f.bodies[0] + " "],
    [trial.trial_id, trial.provider_url, "POST", f.bodies[1]],
  ])
    assert.throws(
      () => f.scope.reserve(...args),
      /qualification-unapproved-request/,
    );
  assert.equal(f.budget.calls.length, 0);
  assert.equal(f.reserve(), "trial-0:attempt-1");
});

test("failed and retried calls remain separate attempts within their original trial", () => {
  const f = start();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const id = f.reserve();
    assert.equal(id, "trial-0:attempt-" + attempt);
    f.budget.settle(id, null, f.manifest.candidates[0].model);
  }
  assert.throws(() => f.reserve(), /qualification-retry-limit/);
  assert.equal(f.reserve(1), "trial-1:attempt-1");
  assert.deepEqual(
    f.budget.calls.map((c) => c.run_id),
    ["trial-0", "trial-0", "trial-0", "trial-1"],
  );
  assert.equal(f.budget.calls.length, 4);
  assert.equal(f.manifest.trials.length, 3);
});

test("synchronous reservations enforce the attempt cap even when callers start together", async () => {
  const f = start((m) => (m.proposed_limits.max_provider_attempts = 1));
  const results = await Promise.allSettled(
    [0, 1, 2].map(async (index) => f.reserve(index)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.filter(
      (r) =>
        r.status === "rejected" &&
        /qualification-budget-exceeded/.test(r.reason.message),
    ).length,
    2,
  );
  assert.equal(f.budget.calls.length, 1);
});

test("input, output and dollar ceilings count pending and missing-usage reservations", () => {
  for (const [field, limit] of [
    ["max_total_input_tokens", 19],
    ["max_total_output_tokens", 39],
    ["max_cost_usd", 0.000139],
  ]) {
    const f = start((m) => (m.proposed_limits[field] = limit));
    const id = f.reserve();
    assert.ok(Math.abs(f.budget.cost() - 0.00007) < 1e-12);
    assert.throws(() => f.reserve(1), /qualification-budget-exceeded/, field);
    f.budget.settle(id, null, f.manifest.candidates[0].model);
    assert.ok(Math.abs(f.budget.cost() - 0.00007) < 1e-12);
    assert.throws(() => f.reserve(1), /qualification-budget-exceeded/, field);
    assert.equal(f.budget.calls.length, 1);
  }
});

test("known usage releases only the measured reserve and reports conservative versus published cost", () => {
  const f = start((m) => (m.proposed_limits.max_cost_usd = 0.0001));
  const id = f.reserve();
  f.budget.settle(id, usage(4, 2, 2), f.manifest.candidates[0].model);
  // Two uncached tokens at max input rate3, two cached at0.25, two output at2.
  assert.ok(Math.abs(f.budget.cost() - 0.0000105) < 1e-12);
  assert.ok(
    Math.abs(f.budget.calls[0].published_rate_estimate_usd - 0.0000065) < 1e-12,
  );
  assert.equal(f.budget.calls[0].cache_state, "HIT");
  assert.equal(f.reserve(1), "trial-1:attempt-1");
});

function longContextFixture() {
  return start((m) => {
    m.proposed_limits.max_cost_usd = 20;
    m.proposed_limits.max_input_tokens_per_attempt = 1050000;
    m.proposed_limits.max_total_input_tokens = 9450000;
    for (const candidate of m.candidates)
      candidate.long_context_pricing = {
        threshold_input_tokens: 272000,
        input_multiplier: 2,
        output_multiplier: 1.5,
      };
    for (const trial of m.trials) trial.input_tokens_upper_bound = 1050000;
  });
}

test("long-context reserve covers the maximum input and output tariffs before dispatch", () => {
  const f = longContextFixture();
  f.reserve();
  // 1.05M input at rate3 ×2 plus20 output at rate2 ×1.5.
  assert.ok(Math.abs(f.budget.cost() - 6.30006) < 1e-12);
});

test("long-context settlement multiplies cached input and all output above the threshold", () => {
  const f = longContextFixture(),
    id = f.reserve();
  f.budget.settle(id, usage(272001, 10, 10000), f.manifest.candidates[0].model);
  // 262001 uncached at3 plus10000 cached at0.25, all ×2;10 output at2 ×1.5.
  assert.ok(Math.abs(f.budget.cost() - 1.577036) < 1e-12);
  assert.ok(
    Math.abs(f.budget.calls[0].published_rate_estimate_usd - 0.529032) < 1e-12,
  );
});

test("actual usage at the threshold releases the unused long-context premium", () => {
  const f = longContextFixture(),
    id = f.reserve();
  f.budget.settle(id, usage(272000, 10, 10000), f.manifest.candidates[0].model);
  assert.ok(Math.abs(f.budget.cost() - 0.78852) < 1e-12);
  assert.ok(
    Math.abs(f.budget.calls[0].published_rate_estimate_usd - 0.26452) < 1e-12,
  );
});

test("invalid long-context tariffs cannot enter the approved cost calculation", () => {
  for (const [field, value] of [
    ["threshold_input_tokens", 0],
    ["threshold_input_tokens", NaN],
    ["input_multiplier", 0.5],
    ["input_multiplier", Infinity],
    ["output_multiplier", -1],
    ["output_multiplier", "invalid"],
  ]) {
    const { manifest, approval } = fixture(
      (m) =>
        (m.candidates[0].long_context_pricing = {
          threshold_input_tokens: 272000,
          input_multiplier: 2,
          output_multiplier: 1.5,
          [field]: value,
        }),
    );
    assert.throws(
      () => createQualificationScope(manifest, approval, apiKeys),
      /qualification-invalid-pricing/,
      field,
    );
  }
});

test("malformed usage cannot make a failed attempt free or release its reservation", () => {
  for (const badUsage of [
    usage(-1),
    usage(1.5),
    usage(10, NaN),
    usage(10, 20, 11),
    {},
    { input_tokens: 10 },
  ]) {
    const f = start((m) => (m.proposed_limits.max_cost_usd = 0.0001));
    f.budget.settle(f.reserve(), badUsage, f.manifest.candidates[0].model);
    assert.ok(Math.abs(f.budget.cost() - 0.00007) < 1e-12);
    assert.throws(() => f.reserve(1), /qualification-budget-exceeded/);
  }
});

test("model drift or underestimated token bounds stop every subsequent provider attempt", () => {
  for (const [settlement, error] of [
    [
      (f, id) => f.budget.settle(id, usage(), "unexpected-model"),
      /qualification-model-drift/,
    ],
    [
      (f, id) => f.budget.settle(id, usage(11), f.manifest.candidates[0].model),
      /qualification-provider-token-bound-exceeded/,
    ],
    [
      (f, id) =>
        f.budget.settle(id, usage(10, 21), f.manifest.candidates[0].model),
      /qualification-provider-token-bound-exceeded/,
    ],
  ]) {
    const f = start(),
      id = f.reserve();
    assert.throws(() => settlement(f, id), error);
    assert.throws(() => f.scope.assertActive(), error);
    assert.throws(() => f.reserve(1), error);
    assert.equal(f.budget.calls.length, 1);
  }
});

test("settlements cannot overwrite earlier accounting or invent a reservation", () => {
  const f = start(),
    id = f.reserve();
  assert.throws(
    () => f.budget.settle("unissued", usage(), null),
    /qualification-unknown-reservation/,
  );
  f.budget.settle(id, null, f.manifest.candidates[0].model);
  assert.throws(
    () => f.budget.settle(id, usage(0, 0), f.manifest.candidates[0].model),
    /qualification-already-settled/,
  );
  assert.ok(Math.abs(f.budget.cost() - 0.00007) < 1e-12);
});
