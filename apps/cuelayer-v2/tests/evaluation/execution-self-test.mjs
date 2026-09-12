import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { profile, PRODUCT_SHA } from "./contract.mjs";
import { evaluatorRoot } from "./manifest.mjs";
import { Provenance } from "./provenance.mjs";
import { loadScenarios, loadCanaryContracts } from "./assets.mjs";
import { generateCanaries } from "./canary.mjs";
import { sha256, ExecutionDiscipline } from "./evidence.mjs";
import {
  CANARIES,
  PROVIDER_URL,
  loadExecutionProduct,
  validateAuthorization,
} from "./execution-manifest.mjs";
import {
  exerciseExecution,
  reserveApprovedAttempt,
} from "./execute-canary.mjs";
import { prohibitProviderEgress } from "./browser.mjs";
const productRoot =
  process.env.GATE3B_PRODUCT_ROOT ??
  resolve(evaluatorRoot, "../cuelayer-v2-frontier");
const provenance = new Provenance(productRoot, evaluatorRoot, {
  allowDirtyEvaluator: true,
});
const product = await loadExecutionProduct(provenance),
  snapshots = await generateCanaries(product);
const scenarios = [
  ...(await loadScenarios()),
  ...(await loadCanaryContracts()),
];
const clone = (x) => structuredClone(x);
function manifest() {
  return {
    identity: "gate3b-1-authorized-execution-1",
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
test("authorized paid path reaches real frozen SDK/parser/Session using only injected unpaid transport and persists success", async () => {
  const v = await context();
  let calls = 0;
  const result = await exerciseExecution(
    v,
    authorization(v.manifest),
    async (url, init) => {
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
    if (calls === 2) await access(resolve(v.out, "quantitative/parser-1.json"));
    if (calls === 3)
      await access(resolve(v.out, "quantitative/attempt-2.json"));
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
