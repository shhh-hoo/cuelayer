import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { validateScenario, expectations, profile } from "./contract.mjs";
import { loadScenarios, verifyLegacyInputs, checkNatural } from "./assets.mjs";
import {
  Budget,
  readiness,
  exclusive,
  EvidenceWriter,
  sha256,
  classifyFault,
  nextPhase,
  causalLatencies,
  calibrateClock,
  ExecutionDiscipline,
} from "./evidence.mjs";
import { predicate, scoreScenario, meaningMatch } from "./score.mjs";
import { Provenance, loadProduct } from "./provenance.mjs";
import { evaluatorRoot } from "./manifest.mjs";
import { generateCanaries } from "./canary.mjs";
import { assessResponse } from "./assessment.mjs";
import { assessProjection } from "./projection.mjs";
import { replayEvents } from "./replay.mjs";
import { fidelity, drive } from "./driver.mjs";
import { prohibitProviderEgress } from "./browser.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("live-attempt guard stops immediately on a hard semantic failure and forbids replacement or overwritten runs", () => {
  const g = new ExecutionDiscipline(
    [
      { run_id: "a", status: "NOT_RUN" },
      { run_id: "b", status: "NOT_RUN" },
    ],
    profile,
  );
  assert.throws(() => g.begin("a"));
  g.preflight("PASS");
  g.begin("a");
  g.reserve("a", { lane: "Stage", retry: true });
  g.observe("a", { hard_fail: true });
  assert.throws(() => g.reserve("a"));
  g.finish("a", { status: "FAIL", hard_fail: true });
  assert.throws(() => g.begin("b"));
  assert.throws(() => g.finish("a", { status: "PASS" }));
  assert.equal(g.runs[1].status, "NOT_RUN");
});

const scenarios = await loadScenarios(),
  math = scenarios.find((s) => s.scenario_id === "mathematics");
const productRoot =
  process.env.GATE3B_PRODUCT_ROOT ??
  resolve(evaluatorRoot, "../cuelayer-v2-frontier");
const clone = (x) => structuredClone(x);
const quantity = (
  expression = ["Equal", "A", ["Multiply", "l", "w"]],
  conditions = [],
) => ({
  id: "arbitrary-id",
  version: 1,
  evidence_refs: ["e0"],
  meaning: {
    kind: "quantity",
    expression,
    symbols: {
      A: { label: "area", unit: "m²" },
      l: { label: "length", unit: "m" },
      w: { label: "width", unit: "m" },
    },
    conditions,
  },
});
const p = (id) => expectations(math).find((p) => p.expectation_id === id);
const context = () => ({
  started: true,
  validity_verified: true,
  timeline: math.transcript_events.map((e) => ({
    ...e,
    evaluator_dispatch_at: e.at_ms,
    scheduled_at: e.at_ms,
    page_received_at: e.at_ms + 1,
    admitted_at: e.at_ms + 2,
  })),
  frontier: [
    { A: 0, R: 0 },
    { A: 111, R: 111 },
  ],
  observation_end: 12000,
  observations: {
    projection: { projection: { violations: [] } },
    "projection-meaning": { projection: { violations: [] } },
    schema: { schema_valid: true },
    meaning: {
      response_complete: true,
      model_units: [quantity()],
      location: {
        causal_order: 20,
        boundary: "model-decision",
        causal_event: "response-1",
      },
    },
    host: {
      host: {
        expected_accepted: true,
        actual_accepted: true,
        expected_state: { revision: 1 },
        actual_state: { revision: 1 },
      },
      location: {
        causal_order: 30,
        boundary: "host-acceptance",
        causal_event: "accepted-1",
      },
    },
    surface: {
      accepted: { causal_id: "q", version: 1 },
      frames: [100, 300].map((at) => ({
        at,
        version: 1,
        causal_id: "q",
        visible: true,
        readable: true,
        unoccluded: true,
        in_safe_area: true,
        content_matches: true,
        text: "A = l × w",
      })),
      location: {
        causal_order: 40,
        boundary: "surface",
        causal_event: "frame-1",
      },
    },
    "semantic-time": { accepted: { at: 1800, causal_id: "q", version: 1 } },
    "display-time": {
      accepted: { at: 1800, causal_id: "q", version: 1 },
      visible: { at: 1950, causal_id: "q", version: 1 },
    },
  },
});

test("shared assets preserve all original eight inputs and timelines; natural 600s has 1408 words and 12 features", async () => {
  await verifyLegacyInputs(scenarios, productRoot);
  assert.equal(
    checkNatural(
      scenarios.find((s) => s.scenario_id === "natural-semantic-load"),
    ).words,
    1408,
  );
  assert.equal(scenarios.length, 9);
  assert(
    scenarios.every((s) =>
      expectations(s).every((p) => p.owner_layer && p.predicate_id),
    ),
  );
});
test("contract rejects missing owner, dangling refs, cycles, contradictory activation and unfrozen timing", () => {
  for (const mutate of [
    (s) => delete s.semantic_checkpoints[0].owner_layer,
    (s) =>
      s.semantic_checkpoints[0].prerequisites.push({
        id: "absent",
        condition: "pass",
      }),
    (s) =>
      s.projection_expectations
        .find((p) => p.expectation_id === "projection-meaning")
        .prerequisites.push({ id: "meaning", condition: "pass" }),
    (s) => (s.semantic_checkpoints[0].activation_rule = "stage_required"),
    (s) => delete s.semantic_checkpoints[0].sufficient_evidence_sets,
    (s) => delete s.timing_expectations[0].parameters.budget_ms,
    (s) =>
      (s.semantic_checkpoints[0].sufficient_evidence_sets[0].event_ids = [
        "future",
      ]),
    (s) =>
      (s.semantic_checkpoints[0].sufficient_evidence_sets[0].invalidated_by = [
        "e0",
      ]),
    (s) => (s.timing_expectations[0].parameters.checkpoint_id = "host"),
  ]) {
    const s = clone(math);
    mutate(s);
    assert.throws(() => validateScenario(s));
  }
});
test("D FAIL / E PASS for semantically wrong, mechanically admissible proposal; H remains independently testable", () => {
  const c = context();
  c.observations.meaning.model_units = [
    quantity(["Equal", "A", ["Add", "l", "w"]]),
  ];
  const s = clone(math),
    h = s.surface_expectations.find((p) => p.expectation_id === "surface");
  h.prerequisites = [{ id: "host", condition: "pass" }];
  const r = scoreScenario(s, c);
  assert.equal(r.status, "FAIL");
  assert.equal(
    r.results.find((p) => p.expectation_id === "host").status,
    "PASS",
  );
  assert.equal(
    r.results.find((p) => p.expectation_id === "surface").status,
    "PASS",
  );
  assert.equal(r.first_violated_boundary.boundary, "model-decision");
});
test("D PASS / E FAIL blocks the required expected surface without duplicating the host failure", () => {
  const c = context();
  c.observations.host.host.actual_accepted = false;
  const r = scoreScenario(math, c);
  assert.equal(
    r.results.find((p) => p.expectation_id === "meaning").status,
    "PASS",
  );
  const h = r.results.find((p) => p.expectation_id === "surface");
  assert.equal(h.status, "NOT_EXERCISED");
  assert(h.blocked_by.includes("host"));
  assert(r.coverage.blocked > 0);
});
test("an independent H violation survives D failure; first violated boundary follows causal evidence rather than A-H order", () => {
  const c = context(),
    s = clone(math);
  c.observations.meaning.model_units = [];
  s.surface_expectations.find(
    (p) => p.expectation_id === "surface",
  ).prerequisites = [];
  c.observations.surface.frames = [];
  c.observations.surface.location.causal_order = 10;
  const r = scoreScenario(s, c);
  assert.equal(r.violations.length, 2);
  assert.equal(r.first_violated_boundary.boundary, "surface");
});
test("scheduler stall F FAIL leaves unobserved C/D/E and expected H NOT_EXERCISED", () => {
  const c = context();
  c.stall_proven = true;
  c.observations = {};
  const r = scoreScenario(math, c);
  assert.equal(
    r.results.find((p) => p.expectation_id === "progress").status,
    "FAIL",
  );
  for (const layer of ["C", "D", "E"])
    assert(r.layers[layer].every((p) => p.status === "NOT_EXERCISED"));
});
test("readiness earliest sufficient set, frozen-order tie, late admission and retry cannot move the driver anchor", () => {
  const cp = {
    sufficient_evidence_sets: [
      { set_id: "first", event_ids: ["a", "b"], invalidated_by: [] },
      { set_id: "second", event_ids: ["c"], invalidated_by: [] },
    ],
  };
  const t = [
    { event_id: "a", evaluator_dispatch_at: 1, admitted_at: 100 },
    { event_id: "b", evaluator_dispatch_at: 10, admitted_at: 900 },
    { event_id: "c", evaluator_dispatch_at: 10, admitted_at: 11 },
  ];
  assert.deepEqual(readiness(cp, t), {
    set_id: "first",
    index: 0,
    ready_at_driver: 10,
    ready_at_product: 900,
    evidence_refs: ["a", "b"],
  });
  t[2].evaluator_dispatch_at = 9;
  assert.equal(readiness(cp, t).set_id, "second");
  t[2].admitted_at = 2000;
  assert.equal(readiness(cp, t).ready_at_driver, 9);
  const a = { at: 2500, causal_id: "retry2", version: 1 },
    f = { at: 2600, causal_id: "retry2", version: 1 };
  assert.equal(causalLatencies(cp, t, a, f).source_to_visible, 2591);
  assert.throws(() =>
    causalLatencies(cp, t, a, { ...f, causal_id: "unrelated" }),
  );
});
test("cross-clock calibration preserves error; hard timing overlapping uncertainty is pending, not PASS", () => {
  assert.equal(
    calibrateClock([{ driver_before: 100, driver_after: 110, product_at: 5 }])
      .offset,
    -100,
  );
  assert.throws(() =>
    calibrateClock([{ driver_before: 0, driver_after: 300, product_at: 0 }]),
  );
  const c = context();
  c.observations["display-time"] = {
    accepted: { at: 0, causal_id: "x", version: 1, uncertainty_ms: 10 },
    visible: { at: 995, causal_id: "x", version: 1, uncertainty_ms: 10 },
  };
  assert.equal(
    predicate(p("display-time"), { ...c, scenario: math }).adjudication_status,
    "ADJUDICATION_REQUIRED",
  );
});
test("semantic counterexamples: missing fact, wrong arithmetic, wrong/missing units, missing condition, swapped endpoints, duplicate meaning", () => {
  const rule = { product_equation: { units: ["m²", "m", "m"] } };
  assert.equal(meaningMatch(quantity(), rule).status, "PASS");
  for (const u of [
    quantity(["Equal", "A", ["Add", "l", "w"]]),
    quantity(["Equal", "A", ["Multiply", "A", "w"]]),
  ])
    assert.equal(meaningMatch(u, rule).status, "FAIL");
  const wrong = quantity();
  wrong.meaning.symbols.A.unit = "m";
  assert.equal(meaningMatch(wrong, rule).status, "FAIL");
  delete wrong.meaning.symbols.A.unit;
  assert.equal(meaningMatch(wrong, rule).status, "FAIL");
  assert.equal(
    meaningMatch(quantity(), { ...rule, conditions: ["fixed length"] }).status,
    "FAIL",
  );
  assert.equal(
    meaningMatch(
      {
        meaning: { kind: "relation", relation: "dependency" },
        endpoint_roles: ["effect", "cause"],
      },
      { relation: { kind: "dependency", endpoint_roles: ["cause", "effect"] } },
    ).status,
    "FAIL",
  );
  for (const units of [[], [quantity(), quantity()]]) {
    const c = context();
    c.observations.meaning.model_units = units;
    assert.equal(
      predicate(p("meaning"), { ...c, scenario: math }).status,
      "FAIL",
    );
  }
});
test("negation false predicate is hard; unknown paraphrase requires frozen adjudication", () => {
  const params = {
    exact_claims: ["The narrator need not be the author."],
    false_claims: ["The narrator is always the author."],
  };
  assert.equal(
    meaningMatch({ meaning: { text: params.false_claims[0] } }, params).status,
    "FAIL",
  );
  assert.equal(
    meaningMatch(
      { meaning: { text: "Narrative voice differs in some cases." } },
      params,
    ).adjudication_status,
    "ADJUDICATION_REQUIRED",
  );
  assert.equal(
    meaningMatch(
      {
        meaning: {
          kind: "quantity",
          expression: ["Equal", "P", 200],
          symbols: { P: { unit: "m" } },
        },
      },
      { scalar: { value: 200, unit: "Pa" } },
    ).status,
    "FAIL",
  );
});
test("all NO_CHANGE/CARRY can account every source character and still fail required understanding; drain cannot rescue timing", () => {
  for (const outcome of ["NO_CHANGE", "CARRY"]) {
    const c = context();
    c.observations.meaning = {
      response_complete: true,
      model_units: [],
      outcomes: [outcome],
    };
    const r = scoreScenario(math, c);
    assert.equal(r.status, "FAIL");
    assert.equal(
      r.results.find((p) => p.expectation_id === "progress").status,
      "PASS",
    );
  }
  const c = context();
  c.observations["semantic-time"].accepted.at = 15000;
  assert.equal(
    predicate(p("semantic-time"), { ...c, scenario: math }).status,
    "FAIL",
  );
});
test("stale DOM and deleted CARRY are rejected; absent withdrawal observation cannot silently pass", () => {
  const w = {
    expectation_id: "withdraw",
    predicate_id: "surface.withdrawn",
    parameters: { budget_ms: 1000 },
  };
  assert.equal(
    predicate(w, {
      observations: {
        withdraw: {
          invalidated_at: 0,
          old_version: 1,
          observer_complete: true,
          frames: [{ at: 1200, version: 1, visible: true }],
        },
      },
    }).status,
    "FAIL",
  );
  assert.equal(
    predicate(w, {
      observations: {
        withdraw: { invalidated_at: 0, old_version: 1, frames: [] },
      },
    }).status,
    "NOT_EXERCISED",
  );
  assert.equal(
    predicate(
      {
        expectation_id: "carry",
        predicate_id: "carry.preserved",
        parameters: {},
      },
      {
        observations: {
          carry: { carry: { deleted_without_resolution: true } },
        },
      },
    ).status,
    "FAIL",
  );
});
test("INVALID attribution is restricted: independent quota/outage vs product 429/crash; unknown cause stays pending", () => {
  for (const kind of ["429", "browser-crash"]) {
    assert.equal(classifyFault({ kind, product_induced: true }).status, "FAIL");
    assert.equal(
      classifyFault({ kind, independent_external: true }).status,
      "INVALID",
    );
    assert.equal(classifyFault({ kind }).status, null);
  }
});
test("absolute driver measures evaluator lateness; product delay never changes ingress fidelity to INVALID", async () => {
  const r = await drive(
    [
      { event_id: "a", at_ms: 0, text: "a" },
      { event_id: "b", at_ms: 50, text: "b" },
    ],
    150,
    async (row) => {
      await new Promise((r) => setTimeout(r, 100));
      return {
        page_received_at: row.evaluator_dispatch_at + 100,
        admitted_at: row.evaluator_dispatch_at + 200,
      };
    },
  );
  assert.equal(r.fidelity.status, "PASS", JSON.stringify(r.fidelity));
  assert(
    r.rows.every((r) => r.page_received_at - r.evaluator_dispatch_at >= 100),
  );
  assert.equal(
    fidelity([{ scheduled_at: 0, evaluator_dispatch_at: 600 }], 600000, 600000)
      .status,
    "INVALID",
  );
});
test("budget reservations are synchronous under concurrency, count retry/Stage, retain missing usage and cache details", async () => {
  const b = new Budget({ ...profile, max_cost_usd: 1 });
  const r = await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      Promise.resolve().then(() => b.reserve({ lane: "Stage", retry: true })),
    ),
  );
  assert.equal(r.filter((r) => r.status === "fulfilled").length, 1);
  b.settle(1, null, "alias");
  assert.equal(b.cost(), 0.54);
  assert.equal(b.calls[0].cache_state, "unknown");
  const c = new Budget(profile),
    id = c.reserve();
  c.settle(
    id,
    {
      input_tokens: 100,
      output_tokens: 10,
      input_tokens_details: { cached_tokens: 50 },
    },
    "returned-model",
  );
  assert.equal(c.calls[0].cached_input_tokens, 50);
  assert.throws(() => c.settle(id, null));
  const capped = new Budget({ ...profile, max_requests: 1 });
  capped.reserve();
  assert.throws(() => capped.reserve());
});
test("sequential preregistration stops after hard fail, INVALID or pending; unstarted runs retain NOT_RUN", () => {
  assert.equal(
    nextPhase(profile.phases, { "3b-0": { status: "PASS" } }),
    "3b-1",
  );
  for (const status of ["FAIL", "INVALID", null, "NOT_EXERCISED"])
    assert.equal(
      nextPhase(profile.phases, {
        "3b-0": { status: "PASS" },
        "3b-1": { status },
      }),
      null,
    );
  assert.equal(scoreScenario(math, { started: false }).status, "NOT_RUN");
});
test("manifest/run artifacts use exclusive writes and append-only hash-linked evidence", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "gate3b-evidence-")),
    path = resolve(dir, "manifest.json");
  await exclusive(path, { frozen: true });
  await assert.rejects(exclusive(path, { frozen: false }), /EEXIST/);
  const w = new EvidenceWriter(resolve(dir, "events"));
  await Promise.all([w.append("a", 1), w.append("b", 2)]);
  const a = JSON.parse(await readFile(resolve(dir, "events/000001.json"))),
    b = JSON.parse(await readFile(resolve(dir, "events/000002.json")));
  assert.equal(b.previous, a.hash);
});
test("sealed manifest verification rejects edited identity fields before any execution", async () => {
  const temp = await mkdtemp(resolve(tmpdir(), "gate3b-manifest-")),
    out = resolve(temp, "run"),
    cli = resolve(
      evaluatorRoot,
      "apps/cuelayer-v2/scripts/evaluate-frontier.mjs",
    ),
    run = promisify(execFile);
  await run(
    process.execPath,
    [
      cli,
      "prepare",
      `--product=${productRoot}`,
      `--out=${out}`,
      "--development",
    ],
    { cwd: evaluatorRoot },
  );
  await run(
    process.execPath,
    [cli, "verify", `--manifest=${out}/manifest.json`],
    { cwd: evaluatorRoot },
  );
  const path = resolve(out, "manifest.json"),
    manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.model_requested = "drifted-alias";
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(
    run(process.execPath, [cli, "verify", `--manifest=${path}`], {
      cwd: evaluatorRoot,
    }),
    /manifest-drift/,
  );
});

let provenance, product, canaries;
test("actual frozen Node graph and six production-generated canary snapshots pass mechanical contracts", async () => {
  provenance = new Provenance(productRoot, evaluatorRoot, {
    allowDirtyEvaluator: true,
  });
  product = await loadProduct(provenance);
  canaries = await generateCanaries(product);
  assert.equal(canaries.length, 6);
  for (const s of canaries) {
    assert.equal(s.fixture_acceptance_error, null, s.snapshot_id);
    assert.deepEqual(s.projection.violations, []);
    assert.equal(s.payload_sha256, sha256(s.payload));
  }
  assert(
    provenance
      .snapshot()
      .modules.some((m) => m.path.endsWith("/server/live.ts")),
  );
});
test("recorded event recovery restores state and naturally dispatches a frozen scheduler request without a model response", async () => {
  const snapshot = canaries.find((s) => s.snapshot_id === "quantitative");
  const result = await replayEvents(product, snapshot.fixture_events);
  assert.equal(result.status, "PASS");
  assert.equal(result.scheduler.status, "PASS");
  assert.equal(result.scheduler.capture.task.lane, "Live");
  assert.equal(result.scheduler.semantic_state_unchanged, true);
  assert.equal(result.provider_invocations, 0);
});
test("provenance rejects evaluator same-name and identical-byte copies, wrong alias, hash mismatch and stale browser source metadata", async () => {
  const copy = resolve(evaluatorRoot, "apps/cuelayer-v2/src/session.ts");
  assert.throws(() => provenance.inspect(copy, "node"), /copy-forbidden/);
  await assert.rejects(
    import(new URL("../../src/session.ts", import.meta.url)),
    /copy-forbidden/,
  );
  const m = provenance
    .snapshot()
    .modules.find((m) => m.path.endsWith("/src/session.ts"));
  for (const bad of [
    { ...m, path: copy },
    { ...m, source_sha256: "bad" },
    { ...m, git_blob: "bad" },
  ])
    assert.throws(() => provenance.verifyRecorded({ modules: [bad] }));
  assert.throws(
    () =>
      provenance.verifyRecorded({
        modules: [],
        dependency_build_inputs: [
          {
            path: resolve(
              productRoot,
              "apps/cuelayer-v2/node_modules/react/index.js",
            ),
            source_sha256: "stale",
          },
        ],
      }),
    /stale-browser-build-input/,
  );
});
test("actual request counterexamples: future evidence, source change, missing required context, wrong modify/create scope, duplicate consumption", () => {
  const base = canaries.find((s) => s.snapshot_id === "correction-authority");
  for (const mutate of [
    (s) => (s.request.source.text += "future evidence"),
    (s) => s.request.writableUnits.push("unissued"),
    (s) => s.request.createWithin.push("unissued"),
    (s) => (s.task.capture.range.start = s.prestate.recorded),
  ]) {
    const s = clone(base);
    mutate(s);
    assert(
      assessProjection({ task: s.task, replay: s.prestate, request: s.request })
        .violations.length,
    );
  }
  const omitted = clone(base);
  omitted.request.units = [];
  assert(
    assessProjection(
      {
        task: omitted.task,
        replay: omitted.prestate,
        request: omitted.request,
      },
      { required_units: Object.keys(omitted.prestate.state.units) },
    ).violations.length,
  );
  assert.equal(
    assessProjection(
      {
        task: omitted.task,
        replay: omitted.prestate,
        request: omitted.request,
      },
      { required_units: ["missing"], allow_context_request: true },
    ).answerability,
    "CONTEXT_REQUIRED",
  );
  const stage = clone(
    canaries.find((s) => s.snapshot_id === "stage-insufficient"),
  );
  stage.request.source = {};
  assert(
    assessProjection({
      task: stage.task,
      replay: stage.prestate,
      request: stage.request,
    }).violations.includes("stage-source-consumption"),
  );
});
test("offline response replay applies the actual frozen executable acceptance contract and does not call a model", () => {
  for (const s of canaries) {
    const result = assessResponse(product, {
      task: s.task,
      prestate: s.prestate,
      response: s.fixture_response,
      events: s.fixture_events,
      poststate: s.fixture_poststate,
      validation_clock_interval: s.validation_clock_interval,
    });
    assert.equal(result.schema_valid, true);
    assert.equal(result.host.expected_accepted, result.host.actual_accepted);
    assert.deepEqual(
      result.host.expected_state,
      result.host.actual_state,
      s.snapshot_id,
    );
  }
});
test("production-valid wrong arithmetic gives D FAIL, E PASS; host rejection of a valid proposal gives E FAIL", () => {
  const s = canaries[0],
    response = clone(s.fixture_response),
    op = response.groups[0].operations.find((o) => o.type === "put");
  op.meaning = product.wire.projectMeaning(
    quantity(["Equal", "A", ["Add", "l", "w"]]).meaning,
    (x) => x,
  );
  const valid = product.acceptance.validate(s.prestate, s.task, response),
    event = {
      ...s.fixture_events.find((e) => e.type === "accepted"),
      accepted: valid.accepted,
    },
    poststate = product.contract.fold(s.prestate, event);
  const result = assessResponse(product, {
    task: s.task,
    prestate: s.prestate,
    response,
    events: [event],
    poststate,
  });
  assert.deepEqual(result.host.expected_state, result.host.actual_state);
  assert.equal(
    meaningMatch(result.model_units[0], p("meaning").parameters).status,
    "FAIL",
  );
  const rejected = assessResponse(product, {
    task: s.task,
    prestate: s.prestate,
    response: s.fixture_response,
    events: [],
    poststate: s.prestate,
  });
  assert.equal(rejected.host.expected_accepted, true);
  assert.equal(rejected.host.actual_accepted, false);
});
test("preflight blocks non-local fetch and socket paths without loading credentials", async () => {
  const restore = prohibitProviderEgress();
  try {
    assert.throws(
      () => fetch("https://api.openai.com/v1/responses"),
      /egress-blocked/,
    );
    const { Socket } = await import("node:net");
    assert.throws(
      () => new Socket().connect({ host: "api.openai.com", port: 443 }),
      /socket-blocked/,
    );
  } finally {
    restore();
    provenance.hooks.deregister();
  }
});
