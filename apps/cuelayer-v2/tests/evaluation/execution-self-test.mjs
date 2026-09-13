import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { profile as historicalProfile } from "./contract.mjs";
import { evaluatorRoot } from "./manifest.mjs";
import { Provenance, git } from "./provenance.mjs";
import { loadScenarios, loadCanaryContracts } from "./assets.mjs";
import { generateCanaries } from "./canary.mjs";
import { sha256, exclusive, ExecutionDiscipline } from "./evidence.mjs";
import {
  CANARIES,
  PROVIDER_URL,
  validateAuthorization,
} from "./execution-manifest.mjs";
import {
  exerciseExecution,
  reserveApprovedAttempt,
} from "./execute-canary.mjs";
import { prohibitProviderEgress } from "./browser.mjs";
import {
  loadSharedExecutionProduct,
  sharedProfile,
  SHARED_EXECUTION_IDENTITY,
  assertSharedPolicy,
} from "./shared-execution-manifest.mjs";
import {
  recordResponse,
  executionCounts,
  executionPhaseDurations,
} from "./evidence.mjs";
const productRoot =
  process.env.GATE3B_SHARED_PRODUCT_ROOT ??
  resolve(evaluatorRoot, "../cuelayer-v2-execution-contract53");
const PRODUCT_SHA = git(productRoot, "rev-parse", "HEAD");
const provenance = new Provenance(productRoot, evaluatorRoot, {
  productSha: PRODUCT_SHA,
  allowDirtyEvaluator: true,
});
const product = await loadSharedExecutionProduct(provenance),
  snapshots = await generateCanaries(product, undefined, {
    generationContract: SHARED_EXECUTION_IDENTITY,
  });
// Synthetic rates exercise reservation arithmetic; they are never current pricing evidence.
const profile = sharedProfile(product.provider.modelProfile, {
  max_requests: historicalProfile.max_requests,
  max_cost_usd: historicalProfile.max_cost_usd,
  reservation_per_request_usd: historicalProfile.reservation_per_request_usd,
  prices_per_million: historicalProfile.prices_per_million,
  pricing_evidence: "unpaid synthetic fixture only",
});
const scenarios = [
  ...(await loadScenarios()),
  ...(await loadCanaryContracts()),
];
const clone = (x) => structuredClone(x);
function manifest() {
  return {
    identity: SHARED_EXECUTION_IDENTITY,
    paid_enabled: false,
    provider_profile: product.provider.modelProfile,
    product_sha: PRODUCT_SHA,
    evaluator_sha: provenance.snapshot().evaluator_sha,
    profile,
    profile_sha256: sha256(profile),
    provider_url: PROVIDER_URL,
    actual_model_allowlist: [profile.model_requested],
    canaries: snapshots.map((s) => ({
      snapshot_id: s.snapshot_id,
      request_sha256: sha256(s.payload),
    })),
    cohort: CANARIES.map((id) => ({
      run_id: id,
      phase: "3b-1",
      status: "NOT_RUN",
    })),
  };
}
function authorization(m) {
  return {
    identity: "gate3b-execution-authorization-1",
    authorization_id: "unpaid-self-test",
    allow_real_provider: true,
    manifest_sha256: sha256(m),
    product_sha: m.product_sha,
    evaluator_sha: m.evaluator_sha,
    profile_sha256: m.profile_sha256,
    model: m.profile.model_requested,
    canaries: CANARIES,
    issued_at: new Date(Date.now() - 1000).toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString(),
  };
}
async function context() {
  const m = manifest();
  return {
    manifest: m,
    product,
    provenance,
    scenarios,
    snapshots: snapshots.map((snapshot) => ({ snapshot })),
    out: await mkdtemp(resolve(tmpdir(), "gate3b-paid-path-STUB-")),
  };
}
const read = async (v, p) =>
  JSON.parse(await readFile(resolve(v.out, p), "utf8"));
function sse(
  snapshot,
  {
    text = JSON.stringify(snapshot.fixture_response),
    terminal = "response.completed",
    model = profile.model_requested,
    usage = {
      input_tokens: 100,
      output_tokens: 50,
      input_tokens_details: { cached_tokens: 20 },
    },
  } = {},
) {
  const response = {
    id: "resp-unpaid-test",
    model,
    status: terminal === "response.completed" ? "completed" : "incomplete",
    usage,
  };
  const events = [
    {
      type: "response.created",
      response: { ...response, status: "in_progress" },
    },
    { type: "response.output_text.delta", delta: text },
    { type: terminal, response },
  ];
  return new Response(
    events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") +
      "data: [DONE]\n\n",
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "x-request-id": "req-unpaid-test",
      },
    },
  );
}
const httpError = (status, code) =>
  new Response(
    JSON.stringify({
      error: {
        message: "unpaid provider error fixture",
        type: "invalid_request_error",
        code,
      },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
const firstThenAuthError = (fn) => {
  let calls = 0;
  return async (...args) =>
    ++calls === 1 ? fn(...args) : httpError(401, "invalid_api_key");
};

test("unpaid mode rejects real-provider fetch/socket with no credentials required", () => {
  const restore = prohibitProviderEgress();
  try {
    assert.throws(() => fetch(PROVIDER_URL), /egress-blocked/);
    assert.equal(process.env.OPENAI_API_KEY, undefined);
  } finally {
    restore();
  }
});
test("paid execution has no dispatch or evidence-start without explicit authorization", async () => {
  const v = await context();
  let calls = 0;
  await assert.rejects(
    exerciseExecution(v, null, async () => {
      calls++;
    }),
    /authorization-required/,
  );
  assert.equal(calls, 0);
  await assert.rejects(access(resolve(v.out, "execution-start.json")));
  await assert.rejects(
    exerciseExecution(v, authorization(v.manifest)),
    /simulated-transport-required/,
  );
});
test("canonical paid entry rejects absent authorization and unapproved command options before loading a manifest", async () => {
  const run = promisify(execFile);
  for (const options of [
    ["--manifest=unused"],
    ["--manifest=unused", "--authorization=unused", "--model=other"],
  ])
    await assert.rejects(
      run(
        process.execPath,
        [
          "apps/cuelayer-v2/scripts/evaluate-frontier.mjs",
          "execute-canary",
          ...options,
        ],
        { cwd: evaluatorRoot },
      ),
      /unapproved-execution-option/,
    );
});
test("authorization binds product/evaluator/manifest/profile/model/cohort and expiry", () => {
  const m = manifest(),
    good = authorization(m);
  assert.equal(validateAuthorization(m, good), true);
  for (const [key, value] of [
    ["product_sha", "bad"],
    ["evaluator_sha", "bad"],
    ["manifest_sha256", "bad"],
    ["profile_sha256", "bad"],
    ["model", "other"],
    ["canaries", ["other"]],
    ["allow_real_provider", false],
    ["expires_at", "2000-01-01"],
  ])
    assert.throws(
      () => validateAuthorization(m, { ...good, [key]: value }),
      undefined,
      key,
    );
});
test("even a matching authorization cannot approve an unregistered model, endpoint, cohort or config", () => {
  for (const mutate of [
    (m) => (m.profile.model_requested = "other"),
    (m) => (m.profile.host_deadline_ms = 9000),
    (m) => (m.provider_url = "https://example.com"),
    (m) => m.canaries.pop(),
    (m) =>
      m.cohort.push({ run_id: "sustained", phase: "3b-4", status: "NOT_RUN" }),
  ]) {
    const m = clone(manifest());
    mutate(m);
    m.profile_sha256 = sha256(m.profile);
    assert.throws(
      () => validateAuthorization(m, authorization(m)),
      /unapproved-model-cohort-or-config/,
    );
  }
});
test("request and US$ caps reserve synchronously before dispatch; body/model/fallback drift is blocked", () => {
  const m = manifest(),
    a = authorization(m),
    d = new ExecutionDiscipline(m.cohort, m.profile);
  d.preflight("PASS");
  d.begin(CANARIES[0]);
  for (let i = 0; i < 400; i++) {
    const id = d.reserve(CANARIES[0]);
    d.budget.settle(
      id,
      { input_tokens: 0, output_tokens: 0 },
      m.profile.model_requested,
    );
  }
  assert.throws(
    () =>
      reserveApprovedAttempt(
        m,
        a,
        d,
        CANARIES[0],
        PROVIDER_URL,
        "POST",
        JSON.stringify(snapshots[0].payload),
      ),
    /budget-exhausted/,
  );
  const cost = new ExecutionDiscipline(m.cohort, m.profile);
  cost.preflight("PASS");
  cost.begin(CANARIES[0]);
  for (let i = 0; i < 18; i++)
    reserveApprovedAttempt(
      m,
      a,
      cost,
      CANARIES[0],
      PROVIDER_URL,
      "POST",
      JSON.stringify(snapshots[0].payload),
    );
  assert.throws(
    () =>
      reserveApprovedAttempt(
        m,
        a,
        cost,
        CANARIES[0],
        PROVIDER_URL,
        "POST",
        JSON.stringify(snapshots[0].payload),
      ),
    /budget-exhausted/,
  );
  for (const [url, body] of [
    ["https://example.com", JSON.stringify(snapshots[0].payload)],
    [PROVIDER_URL, "{}"],
  ])
    assert.throws(
      () => reserveApprovedAttempt(m, a, cost, CANARIES[0], url, "POST", body),
      /unapproved-provider-request/,
    );
});
test("authorized paid path reaches shared product SDK/parser/acceptance using only injected unpaid transport and persists success", async () => {
  const v = await context();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const result = await exerciseExecution(
    v,
    authorization(v.manifest),
    async (url, init) => {
      assert.equal(globalThis.fetch, originalFetch);
      const snapshot = snapshots[calls++];
      assert.equal(url, PROVIDER_URL);
      assert.equal(init.body, JSON.stringify(snapshot.payload));
      if (calls > 1)
        await access(
          resolve(v.out, snapshots[calls - 2].snapshot_id, "result.json"),
        );
      // Reservation is already durable at the moment the mock network is reached.
      const row = await read(v, snapshot.snapshot_id + "/evidence/000002.json");
      assert.equal(row.kind, "attempt-reserved");
      return sse(snapshot);
    },
  );
  assert.equal(calls, 6);
  assert.equal(result.real_provider_attempts, 0);
  assert.equal(result.dependency_mode, "STUB");
  const r = await read(v, "quantitative/result.json");
  assert.equal(r.status, "PASS");
  assert.equal(r.layers.E, "PASS");
  assert.equal(r.attempts[0].response_id, "resp-unpaid-test");
  assert.equal(r.attempts[0].actual_model, profile.model_requested);
  assert.equal(r.attempts[0].cached_input_tokens, 20);
  assert.equal(r.attempts[0].cache_state, "cached");
  assert(r.attempts[0].latency_ms >= 0);
  assert.deepEqual(
    [
      r.attempts[0].attempt_finished,
      r.attempts[0].provider_completed,
      r.attempts[0].parser_succeeded,
      r.attempts[0].host_accepted,
    ],
    [true, true, true, true],
  );
  assert.equal(r.semantic_score_available, true);
  assert.equal(result.execution_counts.attempts_started, 6);
  assert.equal(result.execution_counts.provider_completed, 6);
  assert.equal(globalThis.fetch, originalFetch);
  const phases = r.attempts[0].phases;
  assert(phases.some((p) => p.phase === "first-upstream-byte"));
  assert(phases.some((p) => p.phase === "parser-complete"));
  assert(phases.some((p) => p.phase === "persistence-complete"));
  for (let i = 1; i < phases.length; i++) {
    assert.equal(phases[i].clockId, phases[0].clockId);
    assert(phases[i].at >= phases[i - 1].at);
  }
  assert(
    r.events.some(
      (e) =>
        e.type === "accepted" && e.accepted.taskId === snapshots[0].task.id,
    ),
  );
  assert(
    (
      await readFile(
        resolve(v.out, "quantitative/attempt-1-raw-response.bin"),
        "utf8",
      )
    ).includes("response.completed"),
  );
  await assert.rejects(
    exerciseExecution(v, authorization(v.manifest), async () =>
      sse(snapshots[0]),
    ),
    /EEXIST/,
  );
});
test("provider error preserves raw body and attempt before stop; missing usage retains its cost reservation", async () => {
  const v = await context();
  let calls = 0;
  await exerciseExecution(v, authorization(v.manifest), async () => {
    calls++;
    return httpError(401, "invalid_api_key");
  });
  assert.equal(calls, 1);
  const r = await read(v, "quantitative/result.json");
  assert.equal(r.status, "INVALID");
  assert.equal(r.layers.E, "NOT_EXERCISED");
  assert(
    !r.events.some(
      (e) =>
        e.type === "accepted" && e.accepted.taskId === snapshots[0].task.id,
    ),
  );
  assert.equal(r.attempts[0].reserved_cost_usd, 0.54);
  assert.equal(r.attempts[0].usage, null);
  assert.deepEqual(
    [
      r.attempts[0].attempt_finished,
      r.attempts[0].provider_completed,
      r.attempts[0].parser_succeeded,
      r.attempts[0].host_accepted,
    ],
    [true, false, false, false],
  );
  assert.equal(r.semantic_score_available, false);
  assert(
    (
      await readFile(
        resolve(v.out, "quantitative/attempt-1-raw-response.bin"),
        "utf8",
      )
    ).includes("invalid_api_key"),
  );
});
test("incomplete response and malformed JSON preserve stream, parser error and fail-closed host state with no parser retry", async () => {
  for (const options of [
    { terminal: "response.incomplete", usage: null },
    { text: "{broken" },
  ]) {
    const v = await context();
    let calls = 0;
    await exerciseExecution(v, authorization(v.manifest), async () => {
      calls++;
      return calls === 1
        ? sse(snapshots[0], options)
        : httpError(401, "invalid_api_key");
    });
    const r = await read(v, "quantitative/result.json");
    assert.equal(r.parser.success, false);
    assert.equal(r.attempts.length, 1);
    assert(
      !r.events.some(
        (e) =>
          e.type === "accepted" && e.accepted.taskId === snapshots[0].task.id,
      ),
    );
    assert.equal(r.layers.E, "PASS");
    assert(
      (
        await readFile(
          resolve(v.out, "quantitative/attempt-1-raw-response.bin"),
        )
      ).length > 0,
    );
  }
});
test("hard semantic failure remains D FAIL/E PASS, persists evidence and stops all later canaries", async () => {
  const v = await context(),
    response = clone(snapshots[0].fixture_response);
  const op = response.groups[0].operations.find((o) => o.type === "put");
  const meaning = clone(
    snapshots[0].fixture_poststate.state.units[
      Object.keys(snapshots[0].fixture_poststate.state.units)[0]
    ].meaning,
  );
  meaning.expression = ["Equal", "A", ["Add", "l", "w"]];
  op.meaning = product.wire.projectMeaning(meaning, (x) => x);
  let calls = 0;
  const report = await exerciseExecution(
    v,
    authorization(v.manifest),
    async () => {
      calls++;
      return sse(snapshots[0], { text: JSON.stringify(response) });
    },
  );
  assert.equal(calls, 1);
  const r = await read(v, "quantitative/result.json");
  assert.equal(r.layers.D, "FAIL");
  assert.equal(r.layers.E, "PASS");
  assert.equal(r.hard_fail, true);
  assert(report.canaries.slice(1).every((r) => r.status === "NOT_RUN"));
});
test("only frozen product transport retries occur, every attempt is reserved and identical bytes are retained", async () => {
  const v = await context();
  let calls = 0;
  const bodies = [];
  await exerciseExecution(v, authorization(v.manifest), async (url, init) => {
    bodies.push(init.body);
    calls++;
    // Diagnostic files are deferred, while each guard reservation is durable before dispatch.
    if (calls <= 3)
      await assert.rejects(
        access(resolve(v.out, "quantitative/parser-1.json")),
      );
    return calls <= 2
      ? httpError(500, "server_error")
      : calls === 3
        ? sse(snapshots[0])
        : httpError(401, "invalid_api_key");
  });
  const r = await read(v, "quantitative/result.json");
  assert.equal(r.status, "PASS");
  assert.equal(r.attempts.length, 3);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(bodies[1], bodies[2]);
  assert.equal(calls, 4);
  assert.equal(r.budget.length, 3);
  assert.equal(r.budget.filter((b) => b.usage === null).length, 2);
});
test("returned model drift is retained as A INVALID without hiding the independent semantic/host assessment", async () => {
  const v = await context();
  let calls = 0;
  await exerciseExecution(v, authorization(v.manifest), async () => {
    calls++;
    return sse(snapshots[0], { model: "unapproved-alias" });
  });
  assert.equal(calls, 1);
  const r = await read(v, "quantitative/result.json");
  assert.equal(r.layers.A, "INVALID");
  assert.equal(r.layers.D, "PASS");
  assert.equal(r.layers.E, "PASS");
});
test("pending semantic adjudication persists the unchanged rubric and stops subsequent canaries", async () => {
  const v = await context(),
    response = clone(snapshots[2].fixture_response);
  const meaning = clone(
    Object.values(snapshots[2].fixture_poststate.state.units).find(
      (u) => u.meaning.kind === "quantity",
    ).meaning,
  );
  for (const symbol of Object.values(meaning.symbols))
    symbol.label = "Unrecognized physical role";
  response.groups[0].operations.push({
    ...clone(response.groups[0].operations[0]),
    change: {
      field: "symbols",
      value: product.wire.projectMeaning(meaning, (x) => x).symbols,
    },
  });
  let calls = 0;
  const report = await exerciseExecution(
    v,
    authorization(v.manifest),
    async () => {
      const index = calls++;
      return sse(
        snapshots[index],
        index === 2 ? { text: JSON.stringify(response) } : {},
      );
    },
  );
  assert.equal(calls, 3);
  const r = await read(v, "correction-authority/result.json");
  assert.equal(r.adjudication_status, "ADJUDICATION_REQUIRED");
  assert.equal(r.layers.D, null);
  const p = await read(v, "correction-authority/adjudication-package.json");
  assert.deepEqual(
    p.adjudication_rules,
    scenarios.find((s) => s.scenario_id === "correction").adjudication_rules,
  );
  assert(report.canaries.slice(3).every((r) => r.status === "NOT_RUN"));
});

test("new preparation policy has no inherited paid budget or historical pricing", () => {
  const m = manifest();
  m.profile = sharedProfile(product.provider.modelProfile);
  m.profile_sha256 = sha256(m.profile);
  assert.equal(m.profile.max_cost_usd, null);
  assert.equal(m.profile.prices_per_million, null);
  assert.doesNotThrow(() => assertSharedPolicy(m, { requireBudget: false }));
  assert.throws(
    () => validateAuthorization(m, authorization(m)),
    /budget-and-current-pricing-required/,
  );
});

test("canonical shared preparation entry requires an explicit full product SHA before loading product code", async () => {
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [
        "apps/cuelayer-v2/scripts/evaluate-frontier.mjs",
        "prepare-shared-canary",
        `--product=${productRoot}`,
        "--product-sha=bad",
        "--out=/private/tmp/uncreated-shared-canary",
      ],
      { cwd: evaluatorRoot },
    ),
    /explicit-full-product-sha-required/,
  );
});

test("bounded raw recording preserves forwarded bytes and reports discarded evidence", async () => {
  const bytes = new TextEncoder().encode("abcdefghijklmnop");
  const recording = recordResponse(new Response(bytes), { maxBytes: 5 });
  assert.equal(await recording.response.text(), "abcdefghijklmnop");
  assert.equal(recording.bytes().toString(), "abcde");
  assert.equal(recording.evidence.observed_bytes, 16);
  assert.equal(recording.evidence.retained_bytes, 5);
  assert.equal(recording.evidence.truncated, true);
  assert.equal(recording.evidence.complete, false);
});

test("missing terminal event finishes an attempt without provider completion or semantic scoring", async () => {
  const v = await context();
  await exerciseExecution(
    v,
    authorization(v.manifest),
    firstThenAuthError(
      () =>
        new Response(
          'data: {"type":"response.output_text.delta","delta":"{}"}\n\ndata: [DONE]\n\n',
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    ),
  );
  const r = await read(v, "quantitative/result.json");
  assert.equal(r.attempts.length, 1);
  assert.deepEqual(
    [
      r.attempts[0].attempt_finished,
      r.attempts[0].provider_completed,
      r.attempts[0].parser_succeeded,
      r.attempts[0].host_accepted,
    ],
    [true, false, false, false],
  );
  assert.equal(r.semantic_score_available, false);
  assert.equal(r.execution_counts.terminal_failures, 1);
  assert.equal(r.parser.error, "model-disconnected-before-complete");
});

test("provider deadline before first answer retains failure denominator without a fabricated semantic score", async () => {
  const v = await context();
  await exerciseExecution(
    v,
    authorization(v.manifest),
    firstThenAuthError(
      (url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal.addEventListener(
                "abort",
                () =>
                  controller.error(new DOMException("aborted", "AbortError")),
                { once: true },
              );
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    ),
  );
  const r = await read(v, "quantitative/result.json");
  assert.equal(r.attempts.length, 1);
  assert.equal(r.attempts[0].attempt_finished, true);
  assert.equal(r.attempts[0].provider_completed, false);
  assert.equal(r.attempts[0].parser_succeeded, false);
  assert.equal(r.parser.output_text, null);
  assert.deepEqual(r.execution_failure, {
    category: "deadline",
    reason: "model-timeout",
  });
  assert.deepEqual(r.attempts[0].execution_failure, r.execution_failure);
  assert.equal(r.operational.reason, "model-timeout");
  assert.equal(r.semantic_score_available, false);
  assert.equal(r.execution_counts.attempts_started, 1);
  assert.equal(r.execution_counts.provider_completed, 0);
  assert.equal(r.execution_counts.terminal_failures, 1);
  assert(!r.attempts[0].phases.some((p) => p.phase === "parser-complete"));
  assert(r.attempts[0].latency_ms >= 5900);
});

test("empty-group WAIT persists the shared inspected payload without an accepted semantic event", async () => {
  const v = await context(),
    snapshot = snapshots[0];
  const response = {
    scope: snapshot.task.capture.namespace,
    groups: [],
    suffixStatus: "WAIT_MORE_INPUT",
    contextRequest: null,
    reviewRequests: [],
    attentionCandidate: null,
  };
  await exerciseExecution(
    v,
    authorization(v.manifest),
    firstThenAuthError(() => sse(snapshot, { text: JSON.stringify(response) })),
  );
  const r = await read(v, "quantitative/result.json");
  const appended = r.events.slice(
    snapshot.generation.precondition_events.length,
  );
  assert.equal(appended.length, 1);
  const expected = product.acceptanceEvent.decisionEventPayload(
    snapshot.task,
    product.acceptance.validate(snapshot.prestate, snapshot.task, response),
  );
  for (const [key, value] of Object.entries(expected))
    assert.deepEqual(appended[0][key], value);
  assert.equal(appended[0].type, "inspected");
  assert.equal(r.attempts[0].provider_completed, true);
  assert.equal(r.attempts[0].parser_succeeded, true);
  assert.equal(r.attempts[0].host_accepted, false);
  assert.equal(r.attempts[0].host_decision_persisted, true);
});

test("attempt counters include failures and do not turn cleanup into provider completion", () => {
  assert.deepEqual(
    executionCounts([
      {
        semantic_score_available: false,
        attempts: [
          {
            attempt_finished: true,
            provider_completed: false,
            parser_succeeded: false,
            host_accepted: false,
          },
        ],
      },
    ]),
    {
      attempts_started: 1,
      attempts_finished: 1,
      provider_completed: 0,
      parser_succeeded: 0,
      host_accepted: 0,
      terminal_failures: 1,
      semantic_score_unavailable: 1,
    },
  );
});

test("phase summaries separate parser work from terminal drain and incomplete provider endings", () => {
  const phases = [
    { phase: "network-dispatch", at: 0 },
    { phase: "upstream-terminal", at: 4, details: { completed: false } },
    { phase: "provider-terminal", at: 5 },
    { phase: "parser-start", at: 10 },
    { phase: "parser-complete", at: 12 },
  ].map((p) => ({ clockId: "test-clock", details: {}, ...p }));
  const result = executionPhaseDurations(phases);
  assert.equal(result.provider_terminal_ms, 4);
  assert.equal(result.provider_completion_ms, null);
  assert.equal(result.terminal_to_parser_ms, 7);
  assert.equal(result.parse_ms, 2);
  phases.at(-1).clockId = "other-clock";
  assert.equal(executionPhaseDurations(phases).parse_ms, null);
});

test("slow diagnostic storage starts after retries and durable host acceptance", async () => {
  const v = await context();
  let calls = 0;
  const diagnosticStarts = [];
  await exerciseExecution(
    v,
    authorization(v.manifest),
    async () => {
      calls++;
      if (calls <= 3) assert.equal(diagnosticStarts.length, 0);
      return calls <= 2
        ? httpError(500, "server_error")
        : calls === 3
          ? sse(snapshots[0])
          : httpError(401, "invalid_api_key");
    },
    {
      writeDiagnostic: async (path, value) => {
        diagnosticStarts.push(performance.now());
        await new Promise((resolve) => setTimeout(resolve, 30));
        return exclusive(path, value);
      },
    },
  );
  const r = await read(v, "quantitative/result.json");
  assert.equal(r.status, "PASS");
  assert.equal(r.attempts.length, 3);
  const acceptedAt = r.attempts[2].phases.find(
    (p) => p.phase === "host-accepted",
  ).at;
  assert(acceptedAt < diagnosticStarts[0]);
  assert(r.diagnostic_write_ms >= 180);
  assert(Math.abs(r.latency_ms - r.setup_ms - r.execution_ms) < 0.01);
  assert(r.attempts.every((a) => a.reservation_write_ms >= 0));
  assert(r.attempts.every((a) => a.raw_evidence.copy_ms >= 0));
  assert.equal(r.attempts[2].host_accepted, true);
  assert.equal(r.budget.filter((b) => b.usage === null).length, 2);
});

test("host rejection retains a monotonic boundary after a successful parser", async () => {
  const v = await context();
  const rejecting = {
    ...product,
    acceptance: {
      ...product.acceptance,
      validate() {
        throw Error("independent-host-rejection");
      },
    },
  };
  await exerciseExecution(
    { ...v, product: rejecting },
    authorization(v.manifest),
    firstThenAuthError(() => sse(snapshots[0])),
  );
  const r = await read(v, "quantitative/result.json");
  assert.equal(r.host_error, "independent-host-rejection");
  const a = r.attempts[0];
  assert.equal(a.provider_completed, true);
  assert.equal(a.parser_succeeded, true);
  assert.equal(a.host_accepted, false);
  assert(a.phases.some((p) => p.phase === "host-rejected"));
  assert(a.phase_latency_ms.host_rejection_ms >= 0);
});

// Advance orchestration timers while real file/IndexedDB promises remain observable.
async function waitFor(predicate) {
  const limit = performance.now() + 2000;
  while (!predicate() && performance.now() < limit)
    await new Promise(setImmediate);
  assert(predicate(), "expected asynchronous boundary was not reached");
}

test("precondition restoration does not consume the interpretation deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const v = await context();
  let entered = false,
    release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  class RestoringStore extends product.storage.EventStore {
    async append(event, sequence) {
      if (!entered) {
        entered = true;
        await held;
      }
      return super.append(event, sequence);
    }
  }
  const running = exerciseExecution(
    {
      ...v,
      product: {
        ...product,
        storage: { ...product.storage, EventStore: RestoringStore },
      },
    },
    authorization(v.manifest),
    firstThenAuthError(() => sse(snapshots[0])),
  );
  await waitFor(() => entered);
  t.mock.timers.tick(8001);
  release();
  await running;
  const r = await read(v, "quantitative/result.json");
  assert.equal(r.status, "PASS");
  assert.equal(r.attempts[0].host_accepted, true);
});

test("deadline during retry backoff retains overall deadline and prior transport failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const v = await context();
  let finished = 0,
    calls = 0;
  const observed = {
    ...product,
    execution: {
      ...product.execution,
      async executeCapturedRequest(...args) {
        try {
          return await product.execution.executeCapturedRequest(...args);
        } finally {
          finished++;
        }
      },
    },
  };
  const running = exerciseExecution(
    { ...v, product: observed },
    authorization(v.manifest),
    async () => {
      calls++;
      return httpError(500, "server_error");
    },
  );
  await waitFor(() => finished === 1);
  t.mock.timers.tick(20);
  await waitFor(() => finished === 2);
  t.mock.timers.tick(7980);
  await running;
  const r = await read(v, "quantitative/result.json");
  assert.equal(calls, 2);
  assert.equal(r.attempts.length, 2);
  assert.equal(r.budget.length, 2);
  assert.equal(r.execution_failure.category, "deadline");
  assert.match(r.execution_failure.reason, /deadline exceeded/);
  assert.equal(r.operational.failure_category, "deadline");
  assert.equal(r.attempts[1].execution_failure.category, "transport");
  assert.equal(r.attempts[1].execution_failure.reason, "model-transient");
  assert.equal(r.semantic_score_available, false);
});
