import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { evaluatorRoot } from "../manifest.mjs";
import { git } from "../provenance.mjs";
import { sha256 } from "../evidence.mjs";
import { readHarnessBody } from "../browser.mjs";
import { prepareNatural } from "./manifest.mjs";
import {
  runNatural,
  naturalMechanicalChecks,
  naturalPerformance,
  verifyNaturalResultArtifacts,
} from "./execute.mjs";
import { NATURAL_APPROVAL_IDENTITY } from "./guard.mjs";
import {
  acquireNaturalAssets,
  verifyNaturalAssets,
  NATURAL_RENDERER_URLS,
} from "./assets.mjs";
import { naturalCheckpoint } from "./observer.mjs";

const productRoot =
  process.env.GATE3B_NATURAL_PRODUCT_ROOT ??
  resolve(evaluatorRoot, "../cuelayer-v2-latency59");
const directory = await mkdtemp(resolve(tmpdir(), "natural60-offline-"));
const prepared = await prepareNatural({
  productRoot,
  productSha: git(productRoot, "rev-parse", "HEAD"),
  out: resolve(directory, "prepared"),
  development: true,
  assets:
    process.env.GATE3B_NATURAL_ASSETS ??
    resolve(
      evaluatorRoot,
      ".cuelayer/v2/natural60-assets/renderer-assets.json",
    ),
});
function stubVerified(id) {
  const lesson = {
    ...structuredClone(prepared.lesson),
    duration_ms: 2100,
    transcript_events: [
      { event_id: "unfinished", at_ms: 0, text: "The membrane allows..." },
      { event_id: "admin", at_ms: 500, text: "Please open page twelve." },
    ],
    checkpoints: [
      { id: "observed", at_ms: 2000, why: "Offline runtime observation" },
    ],
  };
  const manifest = {
    ...structuredClone(prepared.manifest),
    freeze_status: "FROZEN",
    test_only: true,
    lesson,
    lesson_sha256: sha256(lesson),
    execution_directory: resolve(directory, id),
    execution_policy: {
      ...prepared.manifest.execution_policy,
      post_input_observation_ms: 1600,
      reload_observation_ms: 500,
    },
  };
  return { ...prepared, manifest, lesson, out: manifest.execution_directory };
}
const approvalFor = (manifest) => ({
  identity: NATURAL_APPROVAL_IDENTITY,
  approved: true,
  manifest_sha256: sha256(manifest),
  limits_sha256: sha256(manifest.proposed_limits),
  test_only: true,
});
const responseFor = (request) =>
  request.version.includes("stage")
    ? {
        scope: request.scope,
        results: request.items.map((item) => ({
          item: item.id,
          outcome: "STILL_OPEN",
        })),
      }
    : {
        scope: request.scope,
        groups: [{ outcome: "NO_CHANGE", throughBoundary: request.source.end }],
        continuation: "NONE",
        reviewRequests: [],
        attentionCandidate: null,
      };
function sse(request, proposal = responseFor(request)) {
  return new Response(
    [
      { type: "response.output_text.delta", delta: JSON.stringify(proposal) },
      {
        type: "response.completed",
        response: {
          id: "stub-natural",
          model: "gpt-6-astra",
          status: "completed",
          service_tier: "default",
          usage: {
            input_tokens: 120,
            output_tokens: 40,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
      },
    ]
      .map((e) => "data: " + JSON.stringify(e) + "\n\n")
      .join(""),
    {
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

test("preparation cannot inherit the completed comparison's paid authorization", async () => {
  const verified = stubVerified("not-authorized");
  let dispatches = 0;
  await assert.rejects(
    runNatural(
      verified,
      {
        ...approvalFor(verified.manifest),
        identity: "cuelayer-v2-semantic-qualification-authorization-1",
      },
      () => {
        dispatches++;
      },
      "stub-key",
      { mode: "STUB" },
    ),
    /approval-mismatch/,
  );
  assert.equal(dispatches, 0);
  assert.equal(prepared.manifest.paid_enabled, false);
  assert.equal(prepared.manifest.freeze_status, "DEVELOPMENT");
  assert.equal(prepared.manifest.proposed_limits.max_provider_attempts, 32);
  assert.equal(prepared.manifest.proposed_limits.concurrency, 2);
  assert.equal(prepared.manifest.proposed_limits.max_cost_usd, 60);
});

test("body admission preserves split UTF-8 and aborts a stalled upload", async () => {
  const req = new PassThrough(),
    controller = new AbortController();
  const body = readHarnessBody(req, controller.signal),
    bytes = Buffer.from("膜");
  req.write(bytes.subarray(0, 1));
  req.end(bytes.subarray(1));
  assert.equal(await body, "膜");
  const stalled = new PassThrough(),
    stop = new AbortController();
  const pending = readHarnessBody(stalled, stop.signal);
  stop.abort();
  await assert.rejects(pending, /model-timeout/);
  assert.equal(stalled.listenerCount("data"), 0);
});

test("checkpoint captures synchronously and reads only its durable prefix after storage completes", async () => {
  const oldWindow = globalThis.window,
    oldDocument = globalThis.document;
  let release, readStarted;
  const begun = new Promise((r) => {
    readStarted = r;
  });
  const blocked = new Promise((r) => {
    release = r;
  });
  const s = {
    id: "offline-checkpoint",
    replay: { sequence: 1 },
    state: { cue: null },
    trace: { spans: [] },
    window: { revision: 1 },
    error: null,
    store: {
      async read() {
        readStarted();
        await blocked;
        return [{ sequence: 1 }, { sequence: 2 }];
      },
    },
  };
  globalThis.window = {
    v2: { session: s, handle: { frame: { revision: 1 } } },
    __gate: { clockId: "test-clock" },
  };
  globalThis.document = { body: { innerText: "at acquisition" } };
  try {
    const pending = naturalCheckpoint(
      { evaluate: (fn, arg) => fn(arg) },
      "input_end",
      97000,
    );
    await begun;
    s.replay = { sequence: 2 };
    s.window = { revision: 2 };
    globalThis.document.body.innerText = "later text";
    await new Promise((r) => setTimeout(r, 12));
    release();
    const checkpoint = await pending;
    assert.equal(checkpoint.snapshot.replay.sequence, 1);
    assert.equal(checkpoint.snapshot.window.revision, 1);
    assert.equal(checkpoint.snapshot.dom_text, "at acquisition");
    assert.deepEqual(checkpoint.snapshot.events, [{ sequence: 1 }]);
    assert.ok(
      checkpoint.storage_completed_at_browser -
        checkpoint.acquired_at_browser >=
        10,
    );
  } finally {
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
  }
});

test(
  "real Session admits a final during inference, naturally schedules Stage and replays its own history",
  { timeout: 60000 },
  async () => {
    const verified = stubVerified("browser-runtime");
    await mkdir(verified.out);
    const sent = [];
    const result = await runNatural(
      verified,
      approvalFor(verified.manifest),
      async (url, init) => {
        assert.equal(String(url), "https://api.openai.com/v1/responses");
        assert.equal(init.redirect, "error");
        const payload = JSON.parse(init.body),
          request = JSON.parse(payload.input[1].content);
        sent.push({ payload, request });
        if (sent.length === 1) await new Promise((r) => setTimeout(r, 1100));
        return sse(request);
      },
      "offline-no-provider-key",
      { mode: "STUB" },
    );
    assert.ok(
      sent.length >= 3,
      JSON.stringify({
        failures: result.failures,
        attempts: result.attempts,
        requests: result.requests.length,
      }),
    );
    assert.ok(result.requests.some((r) => r.task.lane === "Stage"));
    for (const id of [
      "complete-formal-admission",
      "durable-source-integrity",
      "reload-exact-history",
      "event-fold-integrity",
      "source-during-inference",
      "observer-integrity",
      "attempt-evidence",
    ])
      assert.equal(
        result.mechanical_checks.find((c) => c.id === id)?.status,
        "PASS",
        JSON.stringify({
          id,
          failures: result.failures,
          checks: result.mechanical_checks,
        }),
      );
    assert.equal(
      result.admissions[1].evidence[0].text,
      "Please open page twelve.",
    );
    assert.ok(
      result.observations.some(
        (o) => o.type === "observer-overhead" && o.samples > 0,
      ),
    );
    assert.equal(result.full_cohort, "BLOCKED");
    assert.notEqual(result.status, "PASS");
    for (const attempt of result.attempts) {
      assert.equal(attempt.dependency_mode, "STUB");
      assert.equal(
        sha256(await readFile(attempt.raw_path)),
        attempt.raw_sha256,
      );
      assert.equal(
        sha256(await readFile(attempt.forwarded_path)),
        attempt.forwarded_sha256,
      );
      assert.equal(attempt.service_tier, "default");
      assert.ok(
        result.budget.find((b) => b.id === attempt.reservation).cost !== null,
      );
      const artifact = JSON.parse(await readFile(attempt.request_path));
      assert.equal(sha256(artifact.sdk_body), attempt.payload_sha256);
      assert.ok(attempt.raw_provider_proposal);
    }
    assert.equal(
      await verifyNaturalResultArtifacts(verified.manifest, result),
      true,
    );
    const corruptedArtifact = structuredClone(result);
    corruptedArtifact.attempts[0].raw_sha256 = "0".repeat(64);
    await assert.rejects(
      verifyNaturalResultArtifacts(verified.manifest, corruptedArtifact),
      /artifact-drift/,
    );
    const corrupted = structuredClone(result);
    corrupted.checkpoints.find(
      (c) => c.id === "post_reload",
    ).snapshot.replay.evidence[0].text = "lost";
    assert.equal(
      naturalMechanicalChecks(
        prepared.product,
        verified.lesson,
        corrupted,
      ).find((c) => c.id === "durable-source-integrity").status,
      "FAIL",
    );
    const late = structuredClone(result);
    late.checkpoints.find(
      (c) => c.id === "input_end",
    ).within_observation_tolerance = false;
    const lateChecks = naturalMechanicalChecks(
      prepared.product,
      verified.lesson,
      late,
    );
    assert.equal(
      lateChecks.find((c) => c.id === "all-source-accounted").status,
      "PASS",
    );
    assert.equal(
      lateChecks.find((c) => c.id === "input-end-accounted").status,
      "FAIL",
    );
    assert.equal(
      lateChecks.find((c) => c.id === "checkpoint-coverage").status,
      "FAIL",
    );
  },
);

test("renderer acquisition is public-only, frozen by bytes, and verified without egress", async () => {
  const urls = [];
  const assets = await acquireNaturalAssets(
    resolve(directory, "fabricated-assets"),
    async (url, options) => {
      urls.push(url);
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers, undefined);
      return new Response("offline asset " + url, {
        headers: { "Content-Type": "text/plain" },
      });
    },
  );
  assert.deepEqual(urls, NATURAL_RENDERER_URLS);
  assert.equal((await verifyNaturalAssets(assets)).bytes.size, 36);
  const corrupt = structuredClone(assets);
  corrupt.assets[0].sha256 = "0".repeat(64);
  await assert.rejects(verifyNaturalAssets(corrupt), /asset-drift/);
});

test(
  "missing terminal usage retains the reservation and stops later provider dispatch without losing source",
  { timeout: 60000 },
  async () => {
    const verified = stubVerified("browser-unknown-usage");
    verified.lesson = {
      ...verified.lesson,
      transcript_events: [
        { event_id: "first", at_ms: 0, text: "Please open page twelve." },
        {
          event_id: "later",
          at_ms: 1500,
          text: "Please put your notes on the desk.",
        },
      ],
    };
    verified.manifest.lesson = verified.lesson;
    verified.manifest.lesson_sha256 = sha256(verified.lesson);
    await mkdir(verified.out);
    let dispatched = 0;
    const result = await runNatural(
      verified,
      approvalFor(verified.manifest),
      async (_url, init) => {
        dispatched++;
        const request = JSON.parse(JSON.parse(init.body).input[1].content);
        const bytes = (await sse(request).text()).replace(
          '"usage":{"input_tokens":120,"output_tokens":40,"input_tokens_details":{"cached_tokens":0}}',
          '"usage":null',
        );
        return new Response(bytes, {
          headers: { "Content-Type": "text/event-stream" },
        });
      },
      "offline-key",
      { mode: "STUB" },
    );
    assert.equal(dispatched, 1);
    assert.equal(result.budget.length, 1);
    assert.equal(result.budget[0].cost, null);
    assert.ok(result.cost_upper_bound_usd > 26);
    assert.ok(result.failures.some((f) => f.reason.includes("usage")));
    assert.equal(
      result.admissions.filter((a) => a.status === "ADMITTED").length,
      2,
    );
    assert.equal(result.status, "FAIL");
    assert.equal(result.full_cohort, "BLOCKED");
  },
);

test("latency reports retain missing and failed endpoints without semantic credit", () => {
  const result = naturalPerformance(
    {
      attempts: [
        {
          lane: "Live",
          provider_completed: true,
          attempt_finished: true,
          phases: [
            { phase: "network-dispatch", at: 0, clockId: "provider" },
            { phase: "provider-dispatch", at: 0, clockId: "provider" },
            {
              phase: "first-upstream-answer-text",
              at: 10,
              clockId: "provider",
            },
            {
              phase: "upstream-terminal",
              at: 40,
              clockId: "provider",
              details: { completed: true },
            },
          ],
        },
        { lane: "Live", provider_completed: false, attempt_finished: true },
      ],
      observations: [],
    },
    { duration_ms: 1000 },
  );
  assert.equal(result.lanes.Live.provider_complete_ms.samples, 1);
  assert.equal(result.lanes.Live.provider_complete_ms.denominator, 2);
  assert.equal(result.lanes.Live.provider_complete_ms.endpoint_not_reached, 1);
  assert.equal(result.lanes.Live.provider_complete_ms.p95_ms, 40);
});

test(
  "grounded quantity and teacher Cue use actual accepted versions and visible DOM",
  { timeout: 60000 },
  async () => {
    const verified = stubVerified("browser-quantity-cue");
    verified.lesson = {
      ...verified.lesson,
      duration_ms: 3800,
      transcript_events: [
        {
          event_id: "quantity",
          at_ms: 0,
          text: "Pressure P is ninety-five kilopascals.",
        },
        {
          event_id: "invitation",
          at_ms: 2000,
          text: "With your partner, explain what this pressure reading means.",
        },
      ],
      checkpoints: [
        {
          id: "observed",
          at_ms: 3600,
          why: "Observe rendered quantity and Cue",
        },
      ],
    };
    verified.manifest.lesson = verified.lesson;
    verified.manifest.lesson_sha256 = sha256(verified.lesson);
    await mkdir(verified.out);
    const result = await runNatural(
      verified,
      approvalFor(verified.manifest),
      async (_url, init) => {
        const request = JSON.parse(JSON.parse(init.body).input[1].content);
        const basis = [
          {
            source: request.source.source,
            start: request.source.start,
            end: request.source.end,
          },
        ];
        const operations = request.units.length
          ? [
              {
                type: "cue",
                value: {
                  text: verified.lesson.transcript_events[1].text,
                  targets: [request.units[0].id],
                },
                basis,
              },
            ]
          : [
              {
                type: "core",
                id: request.newCores[0],
                label: "Pressure",
                basis,
              },
              prepared.product.fixture.authoredPut({
                type: "put",
                id: request.newUnits[0],
                coreId: request.newCores[0],
                dependencies: [],
                basis,
                meaning: prepared.product.wire.projectMeaning(
                  {
                    kind: "quantity",
                    expression: ["Equal", "P", 95],
                    symbols: { P: { label: "pressure", unit: "kPa" } },
                    conditions: [],
                  },
                  (x) => x,
                ),
              }),
              { type: "mainline", coreId: request.newCores[0], basis },
            ];
        return sse(request, {
          scope: request.scope,
          groups: [
            {
              outcome: "APPLY",
              throughBoundary: request.source.end,
              operations,
              resolutions: [],
            },
          ],
          continuation: "NONE",
          reviewRequests: [],
          attentionCandidate: request.units.length
            ? null
            : { targets: [request.newUnits[0]], mode: "FOCUS" },
        });
      },
      "offline-key",
      { mode: "STUB" },
    );
    assert.deepEqual(result.failures, []);
    const accepted = result.observations.filter(
      (o) => o.type === "trace" && o.span.name === "semantic-accepted",
    );
    assert.equal(accepted.length, 2);
    const visible = result.observations.filter(
      (o) => o.type === "trace" && o.span.name === "learner-visible-dom",
    );
    const cue = result.observations.filter(
      (o) => o.type === "trace" && o.span.name === "cue-visible-dom",
    );
    assert.ok(
      visible.length && cue.length,
      JSON.stringify(
        result.observations
          .filter((o) => o.type === "trace")
          .map((o) => o.span.name),
      ),
    );
    const first = accepted[0],
      unit = Object.values(first.replay.state.units)[0];
    assert.equal(unit.meaning.kind, "quantity");
    assert.ok(
      visible.some(
        (o) =>
          o.span.attributes.versions?.[unit.id] === unit.version &&
          o.span.attributes.revision === first.replay.state.revision &&
          o.span.end >= first.span.end,
      ),
    );
    assert.ok(
      cue.some(
        (o) =>
          o.span.attributes.cueVersion === accepted[1].replay.state.cueVersion,
      ),
    );
    assert.ok(
      result.observations.some(
        (o) =>
          o.type === "frame" &&
          o.dom.some(
            (u) =>
              u.unit_id === unit.id && u.visible && u.readable && u.in_viewport,
          ),
      ),
    );
    // Product learner-visible-dom already checks its true Board safe rect, fonts,
    // complete target set and readable dimensions; this does not rely on viewport-only samples.
    assert.equal(result.full_cohort, "BLOCKED");
    assert.equal(result.performance.lanes.Live.host_accepted, 2);
    assert.equal(result.performance.lanes.Live.useful_dom_observed, 2);
    assert.equal(result.performance.unmatched_acceptances.length, 0);
    assert.equal(result.performance.arrival_fidelity.status, "PASS");
    const corruptedDom = structuredClone(result);
    for (const row of corruptedDom.observations.filter(
      (o) => o.type === "trace" && o.span.name === "learner-visible-dom",
    ))
      row.span.attributes.versions[unit.id] = unit.version + 1;
    assert.equal(
      naturalPerformance(corruptedDom, verified.lesson).lanes.Live
        .useful_dom_observed,
      1,
    );
    const missingCue = structuredClone(result);
    missingCue.observations = missingCue.observations.filter(
      (o) => o.span?.name !== "cue-visible-dom",
    );
    assert.equal(
      naturalPerformance(missingCue, verified.lesson).lanes.Live
        .useful_dom_observed,
      1,
    );
  },
);
