import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Provenance, git } from "../provenance.mjs";
import { evaluatorRoot } from "../manifest.mjs";
import { loadSharedExecutionProduct } from "../shared-execution-manifest.mjs";
import { runCaptured } from "../execute-canary.mjs";
import { exclusive, sha256 } from "../evidence.mjs";
import { loadMicroCorpus } from "./contract.mjs";
import { generateMicroSnapshots } from "./capture.mjs";
import { summarizeQualification } from "./report.mjs";
import { runQualification } from "./execute.mjs";
import {
  buildCandidatePayload,
  providerResponseForCandidate,
  settleCandidateAttempt,
} from "./provider.mjs";
import {
  createQualificationScope,
  QUALIFICATION_IDENTITY,
  QUALIFICATION_APPROVAL_IDENTITY,
} from "./guard.mjs";

// These tests exercise the real product SDK/executor with an injected, unpaid
// HTTP transport. Their fabricated usage is arithmetic evidence, never pricing.
const productRoot =
  process.env.GATE3B_QUALIFICATION_PRODUCT_ROOT ??
  resolve(evaluatorRoot, "../cuelayer-v2-terminal-review57");
const provenance = new Provenance(productRoot, evaluatorRoot, {
  productSha: git(productRoot, "rev-parse", "HEAD"),
  allowDirtyEvaluator: true,
});
const product = await loadSharedExecutionProduct(provenance);
const corpus = await loadMicroCorpus();
const snapshots = await generateMicroSnapshots(product, corpus);
const proposal = JSON.parse(
  await readFile(new URL("candidate-proposal.json", import.meta.url)),
);
const candidates = proposal.candidates;
const candidate = candidates.find((c) => c.candidate_id === "astra-medium");
const source = snapshots.find(
  (s) => s.task.lane === "Live" && s.generation.recipe.length === 1,
);
const stageSource = snapshots.find((s) => s.task.lane === "Stage");
const providerURL = "https://api.openai.com/v1/responses";
const usage = {
  input_tokens: 100,
  output_tokens: 50,
  input_tokens_details: { cached_tokens: 20 },
  output_tokens_details: { reasoning_tokens: 12 },
};
const noChange = (snapshot) =>
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
const sse = (snapshot, options = {}) => {
  const terminal = options.terminal ?? "response.completed";
  const response = {
    id: "resp-qualification-offline",
    model: options.model ?? candidate.model,
    status: terminal === "response.completed" ? "completed" : "incomplete",
    usage: "usage" in options ? options.usage : usage,
    ...(options.service_tier === null
      ? {}
      : { service_tier: options.service_tier ?? "default" }),
    ...(terminal === "response.incomplete"
      ? { incomplete_details: { reason: "max_output_tokens" } }
      : {}),
  };
  const events = [
    {
      type: "response.created",
      response: { ...response, status: "in_progress" },
    },
    {
      type: "response.output_text.delta",
      delta: options.text ?? JSON.stringify(noChange(snapshot)),
    },
    ...(options.disconnected ? [] : [{ type: terminal, response }]),
  ];
  return new Response(
    events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") +
      (options.disconnected ? "" : "data: [DONE]\n\n"),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "x-request-id": "req-qualification-offline",
      },
    },
  );
};
const httpError = (status) =>
  new Response(
    JSON.stringify({
      error: {
        type: "server_error",
        code: "offline-server-error",
        message: "Unpaid failure fixture",
      },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
async function waitFor(predicate) {
  const end = performance.now() + 3000;
  while (!predicate() && performance.now() < end)
    await new Promise(setImmediate);
  assert(predicate(), "expected asynchronous boundary was not reached");
}

async function context(
  snapshot = source,
  selected = candidate,
  overrides = {},
) {
  snapshot = {
    ...structuredClone(snapshot),
    payload: buildCandidatePayload(snapshot.payload, selected),
  };
  const limits = {
    max_trials: 1,
    max_provider_attempts: 3,
    max_input_tokens_per_attempt: 65536,
    max_output_tokens_per_attempt: 8192,
    max_total_input_tokens: 196608,
    max_total_output_tokens: 24576,
    max_cost_usd: 20,
  };
  const manifest = {
    identity: QUALIFICATION_IDENTITY,
    paid_enabled: false,
    freeze_status: "FROZEN",
    candidates: [structuredClone(selected)],
    proposed_limits: limits,
    trials: [
      {
        trial_id: snapshot.snapshot_id,
        snapshot_id: snapshot.snapshot_id,
        candidate_id: selected.candidate_id,
        provider_url: providerURL,
        lane: snapshot.task.lane,
        schema_sha256: sha256(snapshot.payload.text.format.schema),
        payload_sha256: sha256(snapshot.payload),
        input_tokens_upper_bound: 65536,
      },
    ],
    profile: {
      model_requested: selected.model,
      provider_deadline_ms: 30000,
      host_deadline_ms: 35000,
      transport_retries: 2,
      retry_min_ms: 20,
      retry_factor: 2,
    },
    actual_model_allowlist: [selected.model],
  };
  const approval = {
    identity: QUALIFICATION_APPROVAL_IDENTITY,
    approved: true,
    manifest_sha256: sha256(manifest),
    limits_sha256: sha256(limits),
  };
  const scope = createQualificationScope(manifest, approval, {
    openai: "offline-test-key",
  });
  const verified = {
    manifest,
    product: overrides.product ?? product,
    scenarios: [],
    out: await mkdtemp(resolve(tmpdir(), "cuelayer-qualification-executor-")),
  };
  const hooks = {
    reserveAttempt: (id, url, method, body) =>
      scope.reserve(id, url, method, body),
    providerResponse: (capture, options) =>
      providerResponseForCandidate(snapshot.payload, selected, {
        ...options,
        product: verified.product,
        capture,
      }),
    settleAttempt: settleCandidateAttempt,
    assess: () => ({
      results: [{ owner_layer: "D", required: true, status: "PASS" }],
      hard_fail: false,
      adjudication_status: "NOT_REQUIRED",
      first_violated_boundary: null,
    }),
  };
  return {
    snapshot,
    manifest,
    scope,
    verified,
    run: (transport, writer = exclusive) =>
      runCaptured(
        verified,
        snapshot,
        scope,
        transport,
        "offline-test-key",
        "STUB",
        writer,
        hooks,
      ),
  };
}

test("OpenAI candidate configurations preserve every product prompt, source and strict schema byte", () => {
  assert.deepEqual(
    candidates.map((c) => [
      c.provider,
      c.model,
      c.configuration.reasoning.effort,
    ]),
    [
      ["openai", "gpt-6-astra", "medium"],
      ["openai", "gpt-6-astra", "low"],
      ["openai", "gpt-5.6-sol", "none"],
      ["openai", "gpt-5.6-luna", "none"],
    ],
  );
  for (const snapshot of snapshots)
    for (const selected of candidates) {
      const before = structuredClone(snapshot.payload);
      const payload = buildCandidatePayload(snapshot.payload, selected);
      assert.deepEqual(
        snapshot.payload,
        before,
        "builder mutated captured product input",
      );
      assert.equal(payload.model, selected.model);
      assert.deepEqual(payload.reasoning, selected.configuration.reasoning);
      assert.equal(payload.max_output_tokens, 8192);
      const permitted = {
        ...before,
        model: payload.model,
        reasoning: payload.reasoning,
        max_output_tokens: payload.max_output_tokens,
        service_tier: "default",
      };
      assert.equal(JSON.stringify(payload), JSON.stringify(permitted));
      assert.equal(JSON.stringify(payload.input), JSON.stringify(before.input));
      assert.equal(
        JSON.stringify(payload.text.format),
        JSON.stringify(before.text.format),
      );
      assert.equal(payload.text.format.strict, true);
      assert.equal(payload.store, false);
      assert.equal(payload.stream, true);
      assert.equal(payload.service_tier, "default");
    }
});

test("all candidate settings reach the actual product SDK and shared parser without envelope drift", async () => {
  for (const selected of candidates)
    for (const snapshot of [source, stageSource]) {
      const payload = buildCandidatePayload(snapshot.payload, selected),
        observed = [];
      let requests = 0;
      const result = await product.execution.executeCapturedRequest(
        product.execution.capturedRequest(snapshot.task),
        {
          signal: new AbortController().signal,
          observe: (event) => observed.push(event),
          clockId: "qualification-offline-clock",
          transport: (capture, signal) =>
            providerResponseForCandidate(payload, selected, {
              product,
              capture,
              apiKey: "offline-test-key",
              signal,
              clockId: "qualification-offline-clock",
              timeoutMs: 30000,
              fetch: async (url, init) => {
                requests++;
                assert.equal(String(url), providerURL);
                assert.equal(init.method, "POST");
                assert.equal(init.body, JSON.stringify(payload));
                return sse(snapshot, { model: selected.model });
              },
            }),
        },
      );
      assert.equal(requests, 1);
      assert.equal(result.provider.actualModel, selected.model);
      assert.equal(result.provider.completed, true);
      assert.deepEqual(result.provider.usage, usage);
      assert.equal(result.outputText, JSON.stringify(noChange(snapshot)));
      assert(
        observed.some(
          (e) => e.phase === "parser-complete" && e.details.succeeded,
        ),
      );
      assert.equal(
        observed.find((e) => e.phase === "provider-payload").details
          .serializedProviderRequestBytes,
        Buffer.byteLength(JSON.stringify(payload)),
      );
    }
});

test("semantic payload changes are rejected before HTTP dispatch", async () => {
  const payload = buildCandidatePayload(source.payload, candidate);
  payload.input[0].content += " altered";
  let calls = 0;
  await assert.rejects(
    product.execution.executeCapturedRequest(
      product.execution.capturedRequest(source.task),
      {
        signal: new AbortController().signal,
        transport: (capture, signal) =>
          providerResponseForCandidate(payload, candidate, {
            product,
            capture,
            apiKey: "offline-test-key",
            signal,
            fetch: async () => {
              calls++;
              return sse(source);
            },
          }),
      },
    ),
  );
  assert.equal(calls, 0);
});

test("transient retry preserves frozen capture, settles each reservation and publishes once", async () => {
  const c = await context();
  let calls = 0;
  const bodies = [];
  const result = await c.run(async (_input, init) => {
    assert(
      c.scope.discipline.budget.calls
        .slice(0, -1)
        .every((call) => call.settled),
    );
    bodies.push(init.body);
    return ++calls === 1 ? httpError(429) : sse(c.snapshot);
  });
  assert.equal(calls, 2);
  assert.equal(new Set(bodies).size, 1);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].execution_failure.category, "transport");
  assert.equal(result.attempts[0].provider_completed, false);
  assert.equal(result.attempts[1].provider_completed, true);
  assert.equal(result.attempts[1].parser_succeeded, true);
  assert.equal(result.attempts[1].host_accepted, true);
  assert.deepEqual(result.attempts[1].usage, usage);
  assert.equal(
    result.budget[0].cost,
    null,
    "missing usage retains the first reservation",
  );
  assert.equal(result.budget[1].cached_input_tokens, 20);
  const dispatches = result.attempts.map(
    (a) => a.phases.find((p) => p.phase === "request-dispatch").details,
  );
  assert.equal(dispatches[0].taskId, dispatches[1].taskId);
  assert.notEqual(dispatches[0].attemptId, dispatches[1].attemptId);
  assert.equal(result.events.filter((e) => e.type === "accepted").length, 1);
  for (const attempt of result.attempts) {
    assert.equal(
      attempt.phases.filter((p) => p.phase === "request-dispatch").length,
      1,
    );
    assert.equal(
      attempt.phases.filter((p) => p.phase === "attempt-finished").length,
      1,
    );
    assert(
      attempt.phases.every(
        (p) => p.clockId === result.clock_id && Number.isFinite(p.at),
      ),
    );
    assert(
      attempt.phases.every(
        (p, i, phases) => i === 0 || p.at >= phases[i - 1].at,
      ),
    );
  }
});

test("real SDK, captured execution and durable host result feed the report without inferred semantics", async () => {
  const c = await context();
  let calls = 0;
  const result = await c.run(async () =>
    ++calls === 1 ? httpError(429) : sse(c.snapshot),
  );
  const report = summarizeQualification(c.manifest, [
    {
      ...result,
      trial_id: c.snapshot.snapshot_id,
      case_id: c.snapshot.snapshot_id,
      candidate_id: candidate.candidate_id,
    },
  ]);
  assert.equal(report.complete_cohort, true);
  assert.equal(report.totals.attempts, 2);
  assert.equal(report.totals.host_accepted, 1);
  assert.equal(
    report.totals.latency_ms.provider_complete_per_attempt.samples,
    1,
  );
  assert.equal(
    report.totals.latency_ms.provider_complete_per_attempt.endpoint_not_reached,
    1,
  );
  assert.equal(
    report.totals.latency_ms.host_accepted_from_first_request.samples,
    1,
  );
  assert(
    report.totals.latency_ms.host_accepted_from_first_request.p50_ms >=
      report.totals.latency_ms.provider_complete_per_attempt.p50_ms,
  );
  assert.equal(report.totals.usage_and_cost.usage_observed_attempts, 1);
  assert.equal(report.totals.service_tier.returned.default, 1);
  assert.equal(report.totals.service_tier.missing, 1);
  assert(report.totals.usage_and_cost.retained_reservations_usd > 0);
  assert.equal(report.totals.semantics.disposition.pending, 1);
  assert.equal(report.totals.semantics.disposition.accuracy.value, null);
  assert.equal(
    report.schema_use.first_observed_model_schema_requests[0].actual_model,
    candidate.model,
  );
  assert.equal(
    report.schema_use.first_observed_model_schema_requests[0]
      .first_attempt_number,
    2,
  );
  assert.equal(
    report.schema_use.first_observed_model_schema_requests[0]
      .observed_cached_input_tokens,
    20,
  );
});

test("returned service tier settles default usage, retains unknown cost and rejects priority before host acceptance", async () => {
  for (const tier of ["default", null, "priority"]) {
    const c = await context();
    const result = await c.run(async () =>
      sse(c.snapshot, { service_tier: tier }),
    );
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].service_tier, tier);
    assert.equal(result.attempts[0].provider_completed, true);
    assert.deepEqual(result.attempts[0].usage, usage);
    assert.equal(result.budget[0].cost === null, tier !== "default");
    assert.equal(result.attempts[0].host_accepted, tier !== "priority");
    if (tier === "priority")
      assert.equal(
        result.operational.reason,
        "qualification-unexpected-service-tier",
      );
  }
});

test("qualification driver stops the planned cohort after an unexpected service tier and retains its reservation", async () => {
  const c = await context();
  const manifest = {
    ...structuredClone(c.manifest),
    proposed_limits: { ...c.manifest.proposed_limits, max_trials: 2 },
    trials: [
      { ...c.manifest.trials[0], repetition: 1 },
      {
        ...c.manifest.trials[0],
        trial_id: c.snapshot.snapshot_id + "--second",
        repetition: 2,
      },
    ],
    runtime_reference: proposal.runtime_reference,
    observation_profile: proposal.observation_profile,
    corpus: { oracle_sha256: sha256(corpus) },
  };
  const approval = {
    identity: QUALIFICATION_APPROVAL_IDENTITY,
    approved: true,
    manifest_sha256: sha256(manifest),
    limits_sha256: sha256(manifest.proposed_limits),
  };
  let calls = 0;
  const summary = await runQualification(
    { ...c.verified, manifest, snapshots: [source], corpus },
    approval,
    async () => {
      calls++;
      return sse(source, { service_tier: "priority" });
    },
    { openai: "offline-test-key" },
    { mode: "STUB" },
  );
  const saved = JSON.parse(
    await readFile(
      resolve(c.verified.out, "execution", "qualification-results.json"),
      "utf8",
    ),
  );
  assert.equal(calls, 1);
  assert.equal(saved.rows.length, 2);
  assert.equal(saved.rows[0].status, "INVALID");
  assert.equal(
    saved.rows[0].operational.reason,
    "qualification-unexpected-service-tier",
  );
  assert.equal(saved.rows[0].attempts[0].host_accepted, false);
  assert.equal(saved.rows[1].status, "NOT_RUN");
  assert.equal(saved.rows[1].provider_attempt_count, 0);
  assert.equal(saved.budget.length, 1);
  assert.equal(saved.budget[0].cost, null);
  assert(saved.budget[0].reserved > 0);
  assert.equal(summary.complete_cohort, false);
  assert.equal(summary.totals.not_run, 1);
  assert.equal(
    summary.totals.usage_and_cost.retained_reservations_usd,
    saved.budget[0].reserved,
  );
});

test("completed provider, parser rejection and host rejection remain distinct with no repair retry", async () => {
  for (const [text, parsed] of [
    ["{", false],
    ["{}", false],
    [JSON.stringify({ ...noChange(source), scope: "wrong-scope" }), true],
  ]) {
    const c = await context();
    const result = await c.run(async () => sse(c.snapshot, { text }));
    assert.equal(result.attempts.length, 1);
    const attempt = result.attempts[0];
    assert.equal(attempt.attempt_finished, true);
    assert.equal(attempt.provider_completed, true);
    assert.equal(attempt.parser_succeeded, parsed);
    assert.equal(attempt.host_accepted, false);
    assert.deepEqual(attempt.usage, usage);
    assert.equal(
      attempt.phases.some((p) => p.phase === "host-rejected"),
      parsed,
    );
    assert.equal(result.events.filter((e) => e.type === "accepted").length, 0);
    assert.deepEqual(result.poststate.accounted, source.prestate.accounted);
  }
});

test("incomplete output retains terminal reason/usage and never reaches schema parsing or acceptance", async () => {
  const c = await context();
  const result = await c.run(async () =>
    sse(c.snapshot, { terminal: "response.incomplete" }),
  );
  const attempt = result.attempts[0];
  assert.equal(result.attempts.length, 1);
  assert.equal(attempt.provider_completed, false);
  assert.equal(attempt.parser_succeeded, false);
  assert.equal(attempt.terminal_type, "response.incomplete");
  assert.deepEqual(attempt.usage, usage);
  const raw = await readFile(
    resolve(c.verified.out, c.snapshot.snapshot_id, attempt.raw_response_file),
    "utf8",
  );
  assert.match(raw, /max_output_tokens/);
  assert.equal(attempt.phase_latency_ms.parse_ms, null);
  assert.equal(attempt.phase_latency_ms.provider_completion_ms, null);
});

test("a disconnected stream cannot inherit completion or release an unknown usage reservation", async () => {
  const c = await context();
  const result = await c.run(async () =>
    sse(c.snapshot, { disconnected: true }),
  );
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].provider_completed, false);
  assert.equal(result.attempts[0].usage, null);
  assert.equal(result.attempts[0].parser_succeeded, false);
  assert.equal(result.budget[0].cost, null);
  assert(result.budget[0].reserved > 0);
});

test("HTTP authentication failures retain exact candidate request bytes and do not retry", async () => {
  const c = await context();
  const result = await c.run(async () => httpError(401));
  assert.equal(result.attempts.length, 1);
  const attempt = result.attempts[0];
  assert.equal(attempt.provider_error.status, 401);
  assert.equal(attempt.provider_completed, false);
  assert.equal(attempt.parser_succeeded, false);
  assert.equal(
    attempt.phases.find((p) => p.phase === "provider-payload").details
      .serializedProviderRequestBytes,
    Buffer.byteLength(JSON.stringify(c.snapshot.payload)),
  );
});

test("observer exceptions do not change the candidate stream or acceptance proposal", async () => {
  for (const observe of [
    () => {
      throw Error("offline-observer");
    },
    async () => {
      throw Error("offline-observer-async");
    },
  ]) {
    const payload = buildCandidatePayload(source.payload, candidate);
    const result = await product.execution.executeCapturedRequest(
      product.execution.capturedRequest(source.task),
      {
        signal: new AbortController().signal,
        observe,
        transport: (capture, signal) =>
          providerResponseForCandidate(payload, candidate, {
            product,
            capture,
            apiKey: "offline-test-key",
            signal,
            observe,
            fetch: async () => sse(source),
          }),
      },
    );
    assert.equal(result.provider.completed, true);
    assert.equal(result.outputText, JSON.stringify(noChange(source)));
  }
});

test("qualification waits beyond the unchanged 6s product deadline and expires at 30s", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const c = await context();
  let dispatch = false,
    aborted = false;
  const running = c.run(async (_input, init) => {
    dispatch = true;
    return new Promise((_resolve, reject) =>
      init.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(init.signal.reason);
        },
        { once: true },
      ),
    );
  });
  await waitFor(() => dispatch);
  t.mock.timers.tick(8001);
  await new Promise(setImmediate);
  assert.equal(aborted, false);
  t.mock.timers.tick(21999);
  const result = await running;
  assert.equal(aborted, true);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.execution_failure.category, "deadline");
  assert.equal(result.attempts[0].provider_completed, false);
  assert.equal(result.attempts[0].parser_succeeded, false);
  assert.equal(product.provider.modelProfile.providerTimeoutMs, 6000);
  assert.equal(product.provider.modelProfile.clientTimeoutMs, 8000);
});

test("35s overall qualification window cancels a later retry without granting another 30s", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const c = await context();
  let calls = 0,
    release,
    secondAborted = false;
  const running = c.run(async (_input, init) => {
    if (++calls === 1)
      return new Promise((resolve) => {
        release = () => resolve(httpError(500));
      });
    return new Promise((_resolve, reject) =>
      init.signal.addEventListener(
        "abort",
        () => {
          secondAborted = true;
          reject(init.signal.reason);
        },
        { once: true },
      ),
    );
  });
  await waitFor(() => release);
  t.mock.timers.tick(29990);
  release();
  await waitFor(() => c.scope.discipline.budget.calls[0].settled);
  // Allow p-retry to install its20ms backoff after attempt settlement.
  await new Promise(setImmediate);
  t.mock.timers.tick(20);
  await waitFor(() => calls === 2);
  t.mock.timers.tick(4990);
  const result = await running;
  assert.equal(secondAborted, true);
  assert.equal(calls, 2);
  assert.equal(result.execution_failure.category, "deadline");
  assert.equal(result.attempts[0].execution_failure.category, "transport");
  assert.equal(result.attempts[1].provider_completed, false);
  assert.equal(result.budget.length, 2);
});

test("diagnostic writes occur after the host timer is cleared and cannot consume retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const c = await context();
  let dispatch = 0,
    writes = 0,
    requestAborted = false;
  const result = await c.run(
    async (_input, init) => {
      dispatch++;
      init.signal.addEventListener("abort", () => {
        requestAborted = true;
      });
      return sse(c.snapshot);
    },
    async (path, value) => {
      writes++;
      t.mock.timers.tick(35001);
      return exclusive(path, value);
    },
  );
  assert(writes >= 2);
  assert.equal(dispatch, 1);
  assert.equal(requestAborted, false);
  assert.equal(result.attempts[0].host_accepted, true);
  assert.equal(result.execution_failure, null);
});
