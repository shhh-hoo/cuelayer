import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "../evidence.mjs";
import { settleCandidateAttempt } from "../qualification/provider.mjs";
import {
  createNaturalScope,
  payloadProfile,
  NATURAL_IDENTITY,
  NATURAL_APPROVAL_IDENTITY,
  NATURAL_CAPTURE_IDENTITY,
  NATURAL_PROVIDER_URL,
} from "./guard.mjs";

// Authored guard fixtures only. This string is not a provider credential and
// these approvals never authorize an actual natural lesson manifest.
const offlineKey = "offline-natural-test";
function captured(id = "task-0", lane = "Live") {
  const evidence = { id: "source-1", sequence: 1, text: "An ideal gas law." };
  const origin = { evidenceId: null, sequence: 0, offset: 0 };
  const end = {
    evidenceId: evidence.id,
    sequence: 1,
    offset: evidence.text.length,
  };
  const request = {
    version: lane === "Live" ? "v2-live-request-5" : "v2-stage-request-6",
    scope: id,
    source: evidence.text,
  };
  const payload = {
    model: "gpt-6-astra",
    store: false,
    stream: true,
    reasoning: { effort: "medium" },
    max_output_tokens: 8192,
    service_tier: "default",
    text: { format: { type: "json_schema", strict: true, schema: { lane } } },
    input: [
      { role: "system", content: "Offline fixed " + lane + " policy." },
      { role: "user", content: JSON.stringify(request) },
    ],
  };
  const capture = {
    task: {
      id,
      lane,
      evidence: [evidence],
      [lane === "Live" ? "capture" : "review"]: {
        namespace: id,
        request,
        sources: { s0: { start: origin, end } },
        sourceBoundaries: { s0: { b0: origin, b1: end } },
      },
    },
    request,
    prestate: { evidence: [evidence], state: {} },
  };
  return {
    capture,
    payload,
    proof: {
      request: structuredClone(request),
      payload: structuredClone(payload),
      admission_ids: [evidence.id],
    },
  };
}
function fixture(change = () => {}) {
  const manifest = {
    identity: NATURAL_IDENTITY,
    paid_enabled: false,
    freeze_status: "FROZEN",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    product_sha: "product-frozen",
    candidate: {
      candidate_id: "astra-medium",
      provider: "openai",
      model: "gpt-6-astra",
      configuration: { reasoning: { effort: "medium" } },
      service_tier: "standard",
      max_output_tokens: 8192,
      context_window_tokens: 1050000,
      prices_usd_per_million: {
        input: 10,
        output: 50,
        cached_input: 1,
        cache_write: 12.5,
      },
      long_context_pricing: {
        threshold_input_tokens: 272000,
        input_multiplier: 2,
        output_multiplier: 1.5,
      },
    },
    dynamic_capture_policy: {
      identity: NATURAL_CAPTURE_IDENTITY,
      max_attempts_per_task: 3,
      max_request_bytes: 28000,
      profiles: {
        LIVE: payloadProfile(captured().payload),
        STAGE: payloadProfile(captured("stage", "Stage").payload),
      },
    },
    proposed_limits: {
      max_provider_attempts: 32,
      concurrency: 2,
      max_cost_usd: 60,
      max_input_tokens_per_attempt: 1050000,
      max_output_tokens_per_attempt: 8192,
      max_total_input_tokens: 33600000,
      max_total_output_tokens: 262144,
    },
  };
  change(manifest);
  const approval = {
    identity: NATURAL_APPROVAL_IDENTITY,
    approved: true,
    manifest_sha256: sha256(manifest),
    limits_sha256: sha256(manifest.proposed_limits),
  };
  return { manifest, approval };
}
function start(change) {
  const f = fixture(change),
    scope = createNaturalScope(f.manifest, f.approval, offlineKey);
  const register = (value = captured()) => {
    scope.registerCapture(value.capture, value.payload, value.proof);
    return value;
  };
  return {
    ...f,
    scope,
    budget: scope.budget,
    register,
    reserve: (value = register()) =>
      scope.reserve(
        value.capture,
        value.payload,
        NATURAL_PROVIDER_URL,
        "POST",
        JSON.stringify(value.payload),
      ),
  };
}
const usage = (
  input_tokens = 1000,
  output_tokens = 100,
  cached_tokens = 500,
) => ({
  input_tokens,
  output_tokens,
  input_tokens_details: { cached_tokens },
});
function complete(f, id, consumed = usage()) {
  f.budget.settle(id, consumed, "gpt-6-astra");
  f.scope.finish(id);
}

test("only fresh exact natural authorization permits the first outbound boundary", () => {
  for (const change of [
    (f) => {
      f.approval = undefined;
    },
    (f) => {
      f.approval.identity =
        "cuelayer-v2-semantic-qualification-authorization-1";
    },
    (f) => {
      f.approval.approved = false;
    },
    (f) => {
      f.approval.manifest_sha256 = sha256("old58");
    },
    (f) => {
      f.approval.limits_sha256 = sha256("unused58budget");
    },
    (f) => {
      f.manifest.freeze_status = "DEVELOPMENT";
    },
    (f) => {
      f.manifest.paid_enabled = true;
    },
    (f) => {
      f.manifest.product_sha = "changed";
    },
  ]) {
    const f = fixture();
    change(f);
    let outbound = 0;
    assert.throws(() => {
      createNaturalScope(f.manifest, f.approval, offlineKey);
      outbound++;
    });
    assert.equal(outbound, 0);
  }
  const f = fixture((m) => {
    m.expires_at = "2000-01-01T00:00:00.000Z";
  });
  assert.throws(
    () => createNaturalScope(f.manifest, f.approval, offlineKey),
    /natural-manifest-expired/,
  );
});

test("credentials are required and exact outbound Authorization is checked without exposing it", () => {
  const f = fixture();
  for (const key of [undefined, "", " \t\n", 123])
    assert.throws(
      () => createNaturalScope(f.manifest, f.approval, key),
      /natural-provider-key-required/,
    );
  const { scope } = start();
  for (const value of [
    null,
    "Bearer other",
    offlineKey,
    "Bearer " + offlineKey + " ",
  ])
    assert.throws(
      () => scope.assertCredential(value),
      (error) =>
        error.message === "natural-credential-mismatch" &&
        !error.message.includes(offlineKey),
    );
  scope.assertCredential("Bearer " + offlineKey);
});

test("frozen candidate, dynamic policy, spending ceilings and tariff validity cannot be enlarged", () => {
  for (const change of [
    (m) => {
      m.candidate.model = "gpt-5.6-sol";
    },
    (m) => {
      m.candidate.configuration.reasoning.effort = "low";
    },
    (m) => {
      m.candidate.service_tier = "priority";
    },
    (m) => {
      m.proposed_limits.max_provider_attempts = 33;
    },
    (m) => {
      m.proposed_limits.max_cost_usd = 61;
    },
    (m) => {
      m.proposed_limits.concurrency = 3;
    },
    (m) => {
      m.proposed_limits.max_total_input_tokens = Infinity;
    },
    (m) => {
      m.dynamic_capture_policy.max_attempts_per_task = 4;
    },
    (m) => {
      m.dynamic_capture_policy.max_request_bytes = 30000;
    },
    (m) => {
      delete m.dynamic_capture_policy.profiles.STAGE;
    },
    (m) => {
      m.candidate.prices_usd_per_million.cache_write = NaN;
    },
    (m) => {
      m.candidate.prices_usd_per_million.output = -1;
    },
    (m) => {
      m.candidate.long_context_pricing.input_multiplier = 0.5;
    },
  ]) {
    const f = fixture(change);
    assert.throws(() => createNaturalScope(f.manifest, f.approval, offlineKey));
  }
});

test("dynamic Live and Stage requests bind real task source, prestate and product-recomputed bytes", () => {
  const f = start();
  for (const lane of ["Live", "Stage"]) {
    const data = f.register(captured("task-" + lane, lane));
    const id = f.reserve(data),
      call = f.budget.calls.at(-1);
    assert.equal(call.id, id);
    assert.equal(call.task_id, data.capture.task.id);
    assert.equal(call.request_sha256, sha256(data.capture.request));
    assert.equal(call.payload_sha256, sha256(JSON.stringify(data.payload)));
    assert.deepEqual(call.admitted_source_ids, ["source-1"]);
    complete(f, id);
  }
  assert.equal(f.scope.journalBindings.length, 2);
});

test("unadmitted, substituted or invalid source boundaries never register for provider egress", () => {
  for (const change of [
    (d) => {
      d.proof.admission_ids = [];
    },
    (d) => {
      d.capture.prestate.evidence.push({
        id: "future",
        sequence: 2,
        text: "Future.",
      });
    },
    (d) => {
      d.capture.task.evidence = [
        { id: "source-1", sequence: 1, text: "Substituted." },
      ];
    },
    (d) => {
      d.capture.task.capture.sourceBoundaries.s0.b1.evidenceId = "unadmitted";
    },
    (d) => {
      d.capture.task.capture.sourceBoundaries.s0.b1.sequence = 2;
    },
    (d) => {
      d.capture.task.capture.sourceBoundaries.s0.b1.offset = 999;
    },
    (d) => {
      d.proof.request.scope = "authored";
    },
    (d) => {
      d.proof.payload.input[1].content = "authored";
    },
  ]) {
    const f = start(),
      d = captured();
    change(d);
    assert.throws(() => f.register(d));
    assert.equal(f.budget.calls.length, 0);
  }
});

test("model, schema, system prompt, extra SDK settings and oversized requests cannot drift", () => {
  for (const change of [
    (d) => {
      d.payload.model = "gpt-6-astra-latest";
    },
    (d) => {
      d.payload.reasoning.effort = "low";
    },
    (d) => {
      d.payload.text.format.schema = {};
    },
    (d) => {
      d.payload.input[0].content = "Different policy";
    },
    (d) => {
      d.payload.tools = [];
    },
    (d) => {
      d.payload.service_tier = "auto";
    },
    (d) => {
      d.payload.input[1].extra = true;
    },
    (d) => {
      d.capture.request.source = "x".repeat(28000);
      d.payload.input[1].content = JSON.stringify(d.capture.request);
    },
  ]) {
    const f = start(),
      d = captured();
    change(d);
    d.proof.request = structuredClone(d.capture.request);
    d.proof.payload = structuredClone(d.payload);
    assert.throws(() => f.register(d));
    assert.equal(f.budget.calls.length, 0);
  }
});

test("registered identity, exact body, endpoint and method are checked at every reservation", () => {
  const f = start(),
    d = captured();
  assert.throws(() => f.reserve(d), /natural-unapproved-request/);
  f.register(d);
  for (const [url, method, body] of [
    ["https://example.invalid/v1/responses", "POST", JSON.stringify(d.payload)],
    [NATURAL_PROVIDER_URL + "?x=1", "POST", JSON.stringify(d.payload)],
    [NATURAL_PROVIDER_URL, "GET", JSON.stringify(d.payload)],
    [NATURAL_PROVIDER_URL, "POST", JSON.stringify(d.payload) + " "],
  ])
    assert.throws(
      () => f.scope.reserve(d.capture, d.payload, url, method, body),
      /natural-unapproved-request/,
    );
  d.capture.task.id = "unregistered";
  assert.throws(() => f.reserve(d), /natural-unapproved-request/);
  assert.equal(f.budget.calls.length, 0);
});

test("post-registration capture mutation and post-approval drift cannot authorize a request", () => {
  const f = start(),
    d = f.register();
  d.capture.prestate.state.extra = true;
  assert.throws(() => f.reserve(d), /natural-unapproved-request/);
  // Fresh proof can register a newer observed replay, but never change model input.
  f.register(d);
  d.capture.request.source += " Changed model input.";
  d.payload.input[1].content = JSON.stringify(d.capture.request);
  d.proof.request = structuredClone(d.capture.request);
  d.proof.payload = structuredClone(d.payload);
  assert.throws(() => f.register(d), /natural-capture-identity-drift/);
  for (const target of ["manifest", "approval"]) {
    const g = start(),
      original = structuredClone(g[target]);
    g[target].changed = true;
    assert.throws(() => g.scope.assertActive(), /natural-approval-drift/);
    delete g[target].changed;
    assert.deepEqual(g[target], original);
    assert.throws(() => g.reserve(), /natural-approval-drift/);
  }
});

test("a natural retry preserves captured input while retaining newly admitted dispatch prestate", () => {
  const f = start(),
    first = f.register(),
    reservation = f.reserve(first);
  // Known zero-token fixture completion releases the first reservation; this
  // guard test does not claim a real transport failure has observable usage.
  complete(f, reservation, usage(0, 0, 0));
  const retry = structuredClone(first);
  retry.capture.prestate.evidence.push({
    id: "source-2",
    sequence: 2,
    text: "New source during inference.",
  });
  retry.capture.prestate.state.concurrentStageRevision = 1;
  retry.capture.product_at = 900;
  retry.capture.attempt_id = "retry-browser-attempt";
  retry.proof.admission_ids.push("source-2");
  f.register(retry);
  const retryId = f.reserve(retry);
  assert.equal(retryId, "task-0:attempt-2");
  assert.equal(f.scope.journalBindings.length, 2);
  assert.equal(
    f.scope.journalBindings[0].task_sha256,
    f.scope.journalBindings[1].task_sha256,
  );
  assert.equal(
    f.scope.journalBindings[0].payload_sha256,
    f.scope.journalBindings[1].payload_sha256,
  );
  assert.notEqual(
    f.scope.journalBindings[0].prestate_sha256,
    f.scope.journalBindings[1].prestate_sha256,
  );
  assert.deepEqual(f.budget.calls[0].admitted_source_ids, ["source-1"]);
  assert.deepEqual(f.budget.calls[1].admitted_source_ids, [
    "source-1",
    "source-2",
  ]);
  complete(f, retryId);
});

test("the full context and long-context output tariff are reserved before concurrency begins", () => {
  const f = start(),
    first = f.reserve();
  assert.ok(Math.abs(f.budget.cost() - 26.8644) < 1e-10);
  f.reserve(f.register(captured("second", "Stage")));
  assert.ok(Math.abs(f.budget.cost() - 53.7288) < 1e-10);
  const third = f.register(captured("third"));
  assert.throws(() => f.reserve(third), /natural-concurrency-limit/);
  // Completion, not only headers or budget settlement, releases concurrency.
  f.budget.settle(first, usage(), "gpt-6-astra");
  assert.throws(() => f.reserve(third), /natural-concurrency-limit/);
  f.scope.finish(first);
  assert.doesNotThrow(() => f.reserve(third));
});

test("every retry is a separate reservation and there are at most three per captured task", () => {
  const f = start(),
    d = f.register();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const id = f.reserve(d);
    assert.equal(id, "task-0:attempt-" + attempt);
    complete(f, id);
  }
  assert.throws(() => f.reserve(d), /natural-retry-limit/);
  assert.equal(f.budget.calls.length, 3);
});

test("provider attempt, dollar and token ceilings account for pending calls", () => {
  for (const change of [
    (m) => {
      m.proposed_limits.max_provider_attempts = 1;
    },
    (m) => {
      m.proposed_limits.max_cost_usd = 30;
    },
    (m) => {
      m.proposed_limits.max_total_input_tokens = 1050001;
    },
    (m) => {
      m.proposed_limits.max_total_output_tokens = 8193;
    },
  ]) {
    const f = start(change),
      first = f.register(),
      second = captured("second");
    // Register both before spending: a reduced attempt cap may independently
    // reject surplus capture registrations.
    f.reserve(first);
    assert.throws(() => {
      f.register(second);
      f.reserve(second);
    }, /natural-budget-exceeded|natural-capture-limit/);
    assert.equal(f.budget.calls.length, 1);
  }
});

test("the 33rd provider attempt cannot spend even after known usage releases earlier reserves", () => {
  const f = start();
  let d;
  for (let index = 0; index < 32; index++) {
    if (index % 3 === 0) d = f.register(captured("task-" + index));
    complete(f, f.reserve(d));
  }
  assert.equal(f.budget.calls.length, 32);
  assert.throws(() => f.reserve(d), /natural-budget-exceeded/);
});

test("reported usage releases measured reserve and preserves conservative and published cost", () => {
  const f = start(),
    id = f.reserve();
  complete(f, id);
  assert.ok(Math.abs(f.budget.cost() - 0.01175) < 1e-12);
  assert.ok(
    Math.abs(f.budget.calls[0].published_rate_estimate_usd - 0.0105) < 1e-12,
  );
  assert.equal(f.budget.calls[0].cache_state, "HIT");
  const altered = f.budget.calls;
  altered[0].cost = -100;
  assert.ok(f.budget.cost() > 0);
  const g = start(),
    longId = g.reserve();
  complete(g, longId, usage(272001, 10, 10000));
  assert.ok(Math.abs(g.budget.cost() - 6.570775) < 1e-10);
});

test("unknown or malformed usage retains its reserve, stops new dispatch and still settles concurrent facts", () => {
  for (const consumed of [null, {}, usage(-1), usage(1.5), usage(10, 1, 11)]) {
    const f = start(),
      first = f.reserve(),
      second = f.reserve(f.register(captured("second", "Stage")));
    f.budget.settle(first, consumed, "gpt-6-astra");
    f.scope.finish(first);
    assert.throws(() => f.scope.assertActive(), /natural-usage-unavailable/);
    assert.ok(Math.abs(f.budget.calls[0].reserved - 26.8644) < 1e-10);
    assert.equal(f.budget.calls[0].cost, null);
    complete(f, second);
    assert.equal(f.budget.calls[1].cost, 0.01175);
    assert.throws(() => f.reserve(), /natural-usage-unavailable/);
  }
});

test("model drift, unavailable identity, token overflow, and explicit halt stop new dispatch", () => {
  for (const [actual, consumed, expected] of [
    ["other-model", usage(), /natural-model-drift/],
    [null, usage(), /natural-model-unavailable/],
    ["gpt-6-astra", usage(1050001), /natural-provider-token-bound-exceeded/],
    ["gpt-6-astra", usage(1000, 8193), /natural-provider-token-bound-exceeded/],
  ]) {
    const f = start(),
      id = f.reserve();
    try {
      f.budget.settle(id, consumed, actual);
    } catch (error) {
      assert.match(error.message, expected);
    }
    assert.throws(() => f.scope.assertActive(), expected);
    assert.equal(f.budget.calls[0].cost, null);
    f.scope.finish(id);
  }
  const f = start();
  f.scope.halt("natural-raw-evidence-truncated");
  assert.throws(() => f.reserve(), /natural-raw-evidence-truncated/);
});

test("shared provider tier settlement retains unknown/nonstandard costs and prevents more calls", () => {
  for (const tier of [undefined, "priority", "default"]) {
    const f = start(),
      reservation = f.reserve();
    const raw = Buffer.from(
      "data: " +
        JSON.stringify({
          type: "response.completed",
          response: { service_tier: tier },
        }) +
        "\n",
    );
    const attempt = {
      reservation,
      usage: usage(),
      actual_model: "gpt-6-astra",
    };
    if (tier === "priority")
      assert.throws(
        () => settleCandidateAttempt(attempt, raw, f.scope),
        /unexpected-service-tier/,
      );
    else settleCandidateAttempt(attempt, raw, f.scope);
    assert.equal(attempt.service_tier, tier ?? null);
    if (tier === "default") assert.doesNotThrow(() => f.scope.assertActive());
    else {
      assert.equal(f.budget.calls[0].cost, null);
      assert.throws(() => f.scope.assertActive(), /natural-usage-unavailable/);
    }
    f.scope.finish(reservation);
  }
});

test("settlement and finish cannot overwrite or invent attempt accounting", () => {
  const f = start(),
    id = f.reserve();
  assert.throws(
    () => f.budget.settle("unissued", usage(), "gpt-6-astra"),
    /natural-unknown-reservation/,
  );
  complete(f, id);
  assert.throws(
    () => f.budget.settle(id, usage(), "gpt-6-astra"),
    /natural-already-settled/,
  );
  assert.throws(() => f.scope.finish(id), /natural-reservation-not-in-flight/);
});
