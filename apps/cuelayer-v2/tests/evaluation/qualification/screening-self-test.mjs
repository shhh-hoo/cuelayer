import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { evaluatorRoot } from "../manifest.mjs";
import { Provenance, git } from "../provenance.mjs";
import { loadSharedExecutionProduct } from "../shared-execution-manifest.mjs";
import { sha256 } from "../evidence.mjs";
import { loadMicroCorpus } from "./contract.mjs";
import { generateMicroSnapshots } from "./capture.mjs";
import {
  loadCandidateProposal,
  prepareQualification,
  verifyQualification,
  validateQualificationGrid,
  ELIGIBLE_PROPOSAL_IDENTITY,
} from "./manifest.mjs";
import {
  createQualificationScope,
  QUALIFICATION_APPROVAL_IDENTITY,
  ELIGIBLE_QUALIFICATION_IDENTITY,
  ELIGIBLE_QUALIFICATION_APPROVAL_IDENTITY,
} from "./guard.mjs";
import {
  buildCandidatePayload,
  ELIGIBLE_MODEL_CONFIGURATIONS,
} from "./provider.mjs";
import { inputTokenCountPayload, TOKEN_COUNT_ENDPOINT } from "./quota.mjs";
import { runQualification } from "./execute.mjs";

// Synthetic account/count data and injected HTTP responses are offline fixtures.
// No account entitlement, complimentary billing, or paid authorization is proved.
const productRoot =
  process.env.GATE3B_QUALIFICATION_PRODUCT_ROOT ??
  resolve(evaluatorRoot, "../cuelayer-v2-terminal-review57");
const productSha = git(productRoot, "rev-parse", "HEAD");
const encode = (value) => JSON.stringify(value, null, 2) + "\n";
const readJSON = async (path) => JSON.parse(await readFile(path, "utf8"));
let temporary, product, corpus, generated, historical, baseline;
const candidates = [
  ["gpt-5.4-mini-2026-03-17", "small", 400000, 0.75, 0.075, 4.5],
  ["gpt-4o-mini-2024-07-18", "small", 128000, 0.15, 0.075, 0.6],
].map(
  ([
    model,
    quota_group,
    context_window_tokens,
    input,
    cached_input,
    output,
  ]) => ({
    candidate_id: model,
    provider: "openai",
    model,
    quota_group,
    incentive_eligibility: "DOCUMENTED",
    context_window_tokens,
    configuration:
      ELIGIBLE_MODEL_CONFIGURATIONS[model] === null
        ? {}
        : {
            reasoning: { effort: ELIGIBLE_MODEL_CONFIGURATIONS[model] },
          },
    service_tier: "standard",
    max_output_tokens: 8192,
    prices_usd_per_million: { input, cached_input, output },
  }),
);

function proposalFor(selected, caseIds, repetitions) {
  const trials = selected.length * caseIds.length * repetitions;
  return {
    ...structuredClone(historical),
    identity: ELIGIBLE_PROPOSAL_IDENTITY,
    test_only: true,
    candidates: structuredClone(selected),
    selected_case_ids: caseIds,
    repetitions,
    execution_profile: {
      transport_retries: 0,
      retry_min_ms: 20,
      retry_factor: 2,
      sdk_retries: 0,
    },
    complimentary_policy: {
      utc_reset: "00:00",
      input_token_margin: 512,
      daily_caps: { large: 250000, small: 2500000 },
      run_caps: { large: 250000, small: 2500000 },
    },
    proposed_limits: {
      max_trials: trials,
      max_provider_attempts: trials,
      max_input_tokens_per_attempt: 4096,
      max_output_tokens_per_attempt: 8192,
      max_total_input_tokens: trials * 4096,
      max_total_output_tokens: trials * 8192,
      max_cost_usd: 20,
    },
  };
}
function countRecords(proposal, snapshots = generated) {
  return proposal.selected_case_ids.flatMap((id) =>
    proposal.candidates.map((candidate) => {
      const snapshot = snapshots.find((s) => s.snapshot_id === id);
      const payload = buildCandidatePayload(snapshot.payload, candidate);
      return {
        test_only: true,
        model: candidate.model,
        status: 200,
        object: "response.input_tokens",
        input_tokens: 1000,
        endpoint: TOKEN_COUNT_ENDPOINT,
        checked_at: new Date().toISOString(),
        payload_sha256: sha256(JSON.stringify(payload)),
        count_request_sha256: sha256(
          JSON.stringify(inputTokenCountPayload(payload)),
        ),
      };
    }),
  );
}
async function prepare(label, selected = candidates, caseIds, repetitions = 2) {
  caseIds ??= [
    "ordinary-administration",
    generated.find((s) => s.task.lane === "Stage").snapshot_id,
  ];
  const proposal = proposalFor(selected, caseIds, repetitions);
  const proposalPath = resolve(temporary, label + "-source-proposal.json");
  await writeFile(proposalPath, encode(proposal));
  const out = resolve(temporary, label);
  const availability = selected.map((c) => ({
    requested: c.model,
    returned_model: c.model,
    status: 200,
    test_only: true,
  }));
  const inputTokenCounts = countRecords(proposal);
  const inputSnapshots = caseIds.map((id) =>
    generated.find((s) => s.snapshot_id === id),
  );
  const { manifest } = await prepareQualification({
    productRoot,
    productSha,
    out,
    proposalPath,
    availability,
    inputTokenCounts,
    inputSnapshots,
    development: true,
  });
  const path = resolve(out, "qualification-manifest.json");
  const verified = await verifyQualification(path, { allowDevelopment: true });
  return {
    out,
    path,
    proposal,
    proposalPath,
    manifest,
    verified,
    inputTokenCounts,
    inputSnapshots,
    availability,
  };
}
before(async () => {
  temporary = await mkdtemp(resolve(tmpdir(), "cuelayer-screening-test-"));
  historical = await loadCandidateProposal();
  const provenance = new Provenance(productRoot, evaluatorRoot, {
    productSha,
    allowDirtyEvaluator: true,
  });
  product = await loadSharedExecutionProduct(provenance);
  corpus = await loadMicroCorpus();
  generated = await generateMicroSnapshots(product, corpus);
  baseline = await prepare("baseline");
});
after(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});
async function seal(path, manifest) {
  const bytes = encode(manifest);
  await writeFile(path, bytes);
  await writeFile(
    resolve(path, "../qualification-manifest-seal.json"),
    encode({
      object_sha256: sha256(manifest),
      file_sha256: sha256(bytes),
    }),
  );
}
async function copyFixture(label) {
  const out = resolve(temporary, label);
  await mkdir(resolve(out, "snapshots"), { recursive: true });
  const manifest = structuredClone(baseline.manifest);
  manifest.execution_directory = out;
  for (const file of manifest.snapshots) {
    const bytes = await readFile(file.path);
    file.path = resolve(out, "snapshots", file.snapshot_id + ".json");
    await writeFile(file.path, bytes);
  }
  const proposalBytes = await readFile(manifest.proposal_file.path);
  manifest.proposal_file.path = resolve(out, "qualification-proposal.json");
  await writeFile(manifest.proposal_file.path, proposalBytes);
  const path = resolve(out, "qualification-manifest.json");
  await seal(path, manifest);
  return { out, path, manifest };
}
const verify = (path) => verifyQualification(path, { allowDevelopment: true });
function approvalFor(manifest) {
  const now = new Date().toISOString();
  return {
    identity: ELIGIBLE_QUALIFICATION_APPROVAL_IDENTITY,
    approved: true,
    manifest_sha256: sha256(manifest),
    limits_sha256: sha256(manifest.proposed_limits),
    complimentary_usage: {
      enrolled: true,
      project_confirmed: true,
      sharing_authorized: true,
      exclusive_org_usage: true,
      source: "Synthetic offline account fixture",
      checked_at: now,
      utc_date: now.slice(0, 10),
      remaining_tokens: { large: 250000, small: 2500000 },
    },
  };
}
async function executionFixture(prepared, out) {
  await mkdir(out);
  const manifest = {
    ...structuredClone(prepared.manifest),
    freeze_status: "FROZEN",
  };
  return { ...prepared.verified, manifest, out };
}

test("selected cases, candidate count and repetitions define the complete rotating grid", async () => {
  for (const fixture of [
    baseline,
    await prepare(
      "one-row",
      candidates.slice(0, 1),
      ["ordinary-administration"],
      1,
    ),
  ]) {
    const { manifest, proposal, verified } = fixture;
    const expectedCount =
      proposal.candidates.length *
      proposal.selected_case_ids.length *
      proposal.repetitions;
    assert.equal(manifest.identity, ELIGIBLE_QUALIFICATION_IDENTITY);
    assert.equal(manifest.freeze_status, "DEVELOPMENT");
    assert.equal(manifest.paid_enabled, false);
    assert.equal(manifest.product_sha, productSha);
    assert.deepEqual(
      verified.snapshots.map((s) => s.snapshot_id),
      proposal.selected_case_ids,
    );
    assert.deepEqual(
      verified.snapshots,
      fixture.inputSnapshots,
      "freeze must preserve the same captured scope and request bytes that were counted",
    );
    assert.equal(
      validateQualificationGrid(manifest, verified.snapshots).length,
      expectedCount,
    );
    const expectedIds = [];
    for (let repetition = 1; repetition <= proposal.repetitions; repetition++)
      for (let index = 0; index < proposal.selected_case_ids.length; index++)
        for (let slot = 0; slot < proposal.candidates.length; slot++) {
          const candidate =
            proposal.candidates[
              (slot + index + repetition - 1) % proposal.candidates.length
            ];
          expectedIds.push(
            `${proposal.selected_case_ids[index]}--${candidate.candidate_id}--${repetition}`,
          );
        }
    assert.deepEqual(
      manifest.trials.map((t) => t.trial_id),
      expectedIds,
    );
    assert.equal(new Set(expectedIds).size, expectedCount);
    assert(manifest.trials.every((t) => t.input_tokens_upper_bound === 1512));
    assert(
      verified.snapshots.every(
        (s) =>
          s.generation.production_capture &&
          s.generation.production_builder &&
          s.provider_invocations === 0,
      ),
    );
  }
});

test("preparation rejects missing, duplicate, extra and altered frozen snapshots", async () => {
  const other = generated.find(
    (s) => !baseline.proposal.selected_case_ids.includes(s.snapshot_id),
  );
  for (const [index, inputSnapshots] of [
    undefined,
    [],
    [baseline.inputSnapshots[0], baseline.inputSnapshots[0]],
    [...baseline.inputSnapshots, other],
    baseline.inputSnapshots.map((s, i) =>
      i
        ? s
        : {
            ...structuredClone(s),
            request: { ...s.request, scope: "changed-scope" },
          },
    ),
  ].entries()) {
    await assert.rejects(
      () =>
        prepareQualification({
          productRoot,
          productSha,
          out: resolve(temporary, "invalid-snapshots-" + index),
          proposalPath: baseline.proposalPath,
          availability: baseline.availability,
          inputTokenCounts: baseline.inputTokenCounts,
          inputSnapshots,
          development: true,
        }),
      /qualification-(frozen-snapshots-required|unknown-selected-case|snapshot-grid|product-binding-drift)/,
    );
  }
});

test("independently captured scopes pass while their original request and count bytes remain unchanged", async () => {
  const fresh = await generateMicroSnapshots(product, corpus);
  const inputSnapshots = baseline.proposal.selected_case_ids.map((id) =>
    fresh.find((s) => s.snapshot_id === id),
  );
  for (const s of inputSnapshots)
    assert.notEqual(
      s.request.scope,
      baseline.inputSnapshots.find((old) => old.snapshot_id === s.snapshot_id)
        .request.scope,
    );
  const out = resolve(temporary, "fresh-scopes");
  await prepareQualification({
    productRoot,
    productSha,
    out,
    proposalPath: baseline.proposalPath,
    availability: baseline.availability,
    inputSnapshots,
    inputTokenCounts: countRecords(baseline.proposal, inputSnapshots),
    development: true,
  });
  assert.deepEqual(
    (await verify(resolve(out, "qualification-manifest.json"))).snapshots,
    inputSnapshots,
  );
});

test("consistent source, event, task, payload and count rebinding cannot substitute the frozen corpus", async () => {
  const inputSnapshots = baseline.inputSnapshots.map((s) =>
    JSON.parse(JSON.stringify(s).replaceAll("twelve", "twenty")),
  );
  for (const s of inputSnapshots) {
    s.prestate = s.generation.precondition_events.reduce(
      product.contract.fold,
      product.contract.emptyReplay(),
    );
    s.payload = await product.provider.liveRequest(s.request);
    s.payload_sha256 = sha256(s.payload);
  }
  assert.notEqual(
    inputSnapshots[0].request.source.text,
    baseline.inputSnapshots[0].request.source.text,
  );
  assert.equal(
    inputSnapshots[0].specification_sha256,
    baseline.inputSnapshots[0].specification_sha256,
  );
  assert.deepEqual(inputSnapshots[0].oracle, baseline.inputSnapshots[0].oracle);
  const counts = countRecords(baseline.proposal, inputSnapshots);
  await assert.rejects(
    () =>
      prepareQualification({
        productRoot,
        productSha,
        out: resolve(temporary, "forged-source"),
        proposalPath: baseline.proposalPath,
        availability: baseline.availability,
        inputSnapshots,
        inputTokenCounts: counts,
        development: true,
      }),
    /qualification-imported-corpus-capture-drift/,
  );
  const f = await copyFixture("resealed-forged-source");
  f.manifest.input_token_counts = counts;
  for (const file of f.manifest.snapshots) {
    const s = inputSnapshots.find((s) => s.snapshot_id === file.snapshot_id);
    const bytes = encode(s);
    await writeFile(file.path, bytes);
    file.file_sha256 = sha256(bytes);
    file.object_sha256 = sha256(s);
  }
  for (const trial of f.manifest.trials) {
    const c = f.manifest.candidates.find(
      (c) => c.candidate_id === trial.candidate_id,
    );
    const s = inputSnapshots.find((s) => s.snapshot_id === trial.snapshot_id);
    trial.payload_sha256 = sha256(
      JSON.stringify(buildCandidatePayload(s.payload, c)),
    );
    trial.input_token_count_sha256 = sha256(
      counts.find(
        (record) =>
          record.model === c.model &&
          record.payload_sha256 === trial.payload_sha256,
      ),
    );
  }
  await seal(f.path, f.manifest);
  await assert.rejects(
    () => verify(f.path),
    /qualification-imported-corpus-capture-drift/,
  );
});

test("copied proposal bytes are frozen independently of the caller's source file", async () => {
  const copied = await readFile(baseline.manifest.proposal_file.path, "utf8");
  assert.equal(copied, encode(baseline.proposal));
  assert.equal(sha256(copied), baseline.manifest.proposal_file.file_sha256);
  await writeFile(baseline.proposalPath, "{}\n");
  assert.equal(
    (await verify(baseline.path)).manifest.proposal_sha256,
    sha256(baseline.proposal),
  );
  await assert.rejects(
    () =>
      verifyQualification(baseline.path, {
        allowDevelopment: true,
        proposalPath: baseline.proposalPath,
      }),
    /qualification-.*proposal/,
  );
  assert.equal(
    await readFile(baseline.manifest.proposal_file.path, "utf8"),
    copied,
  );
});

test("grid and exact count bindings reject candidate, case, repetition and count drift", () => {
  for (const mutate of [
    (m) => m.trials.pop(),
    (m) => m.trials.reverse(),
    (m) => {
      m.trials[1] = { ...m.trials[0] };
    },
    (m) => {
      m.trials[0].repetition = 7;
    },
    (m) => {
      m.trials[0].input_tokens_upper_bound++;
    },
    (m) => {
      m.trials[0].input_token_count_sha256 = sha256("different-count");
    },
    (m) => {
      m.input_token_counts[0].input_tokens++;
    },
    (m) => {
      m.input_token_counts[0].count_request_sha256 = sha256("different-input");
    },
    (m) => {
      m.selected_case_ids.reverse();
    },
    (m) => {
      m.candidates.pop();
    },
    (m) => {
      m.proposed_limits.max_provider_attempts++;
    },
  ]) {
    const changed = structuredClone(baseline.manifest);
    mutate(changed);
    assert.throws(
      () => validateQualificationGrid(changed, baseline.verified.snapshots),
      /qualification-.*drift|quota-/,
    );
  }
});

test("resealed artifacts cannot substitute proposal bytes, paths or token counts", async () => {
  for (const [label, mutate, expected] of [
    [
      "proposal-content",
      async (f) => {
        await writeFile(f.manifest.proposal_file.path, "{}\n");
      },
      /qualification-corpus-or-proposal-drift/,
    ],
    [
      "proposal-path",
      async (f) => {
        f.manifest.proposal_file.path = baseline.manifest.proposal_file.path;
      },
      /qualification-proposal-path-drift/,
    ],
    [
      "count-content",
      async (f) => {
        f.manifest.input_token_counts[0].input_tokens++;
      },
      /qualification-trial-grid-drift/,
    ],
  ]) {
    const fixture = await copyFixture(label);
    await mutate(fixture);
    await seal(fixture.path, fixture.manifest);
    await assert.rejects(() => verify(fixture.path), expected, label);
  }
});

test("screening requires its exact new approval and enforces one reservation per trial", () => {
  const manifest = {
    ...structuredClone(baseline.manifest),
    freeze_status: "FROZEN",
  };
  const approval = approvalFor(manifest);
  for (const changed of [
    undefined,
    { ...approval, identity: QUALIFICATION_APPROVAL_IDENTITY },
    { ...approval, manifest_sha256: sha256("old-manifest") },
    { ...approval, approved: false },
  ])
    assert.throws(
      () =>
        createQualificationScope(manifest, changed, { openai: "offline-only" }),
      /qualification-approval-mismatch/,
    );
  assert.throws(
    () =>
      createQualificationScope(
        baseline.manifest,
        approvalFor(baseline.manifest),
        { openai: "offline-only" },
      ),
    /qualification-not-frozen/,
  );
  const scope = createQualificationScope(manifest, approval, {
    openai: "offline-only",
  });
  const trial = manifest.trials[0];
  const snapshot = baseline.verified.snapshots.find(
    (s) => s.snapshot_id === trial.snapshot_id,
  );
  const candidate = manifest.candidates.find(
    (c) => c.candidate_id === trial.candidate_id,
  );
  const body = JSON.stringify(
    buildCandidatePayload(snapshot.payload, candidate),
  );
  const reserve = () =>
    scope.reserve(trial.trial_id, trial.provider_url, "POST", body);
  const id = reserve();
  scope.discipline.budget.settle(
    id,
    { input_tokens: 100, output_tokens: 20 },
    candidate.model,
  );
  assert.throws(reserve, /qualification-retry-limit/);
  assert.equal(scope.discipline.budget.calls.length, 1);
  approval.complimentary_usage.remaining_tokens.small--;
  assert.throws(() => scope.assertActive(), /qualification-approval-drift/);
});

test("actual shared executor receives zero retries even when historical runtime reference says two", async () => {
  const prepared = await prepare(
    "transient-plan",
    candidates.slice(0, 1),
    ["ordinary-administration"],
    1,
  );
  const fixture = await executionFixture(
    prepared,
    resolve(temporary, "transient-execution"),
  );
  let forwardedCalls = 0,
    executorCalls = 0;
  // Fault at the forwarder boundary: the real captured executor creates its
  // genuine TransientFailure. No reservation/unknown-usage quota stop can mask
  // an erroneous p-retry configuration in this test.
  fixture.product = {
    ...product,
    execution: {
      ...product.execution,
      executeCapturedRequest: (...args) => {
        executorCalls++;
        return product.execution.executeCapturedRequest(...args);
      },
    },
    providerExecution: {
      ...product.providerExecution,
      providerResponse: async () => {
        forwardedCalls++;
        return new Response(JSON.stringify({ error: "model-transient" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  };
  assert.equal(fixture.manifest.runtime_reference.transport_retries, 2);
  assert.equal(fixture.manifest.execution_profile.transport_retries, 0);
  await runQualification(
    fixture,
    approvalFor(fixture.manifest),
    () => {
      throw Error("offline-unexpected-egress");
    },
    { openai: "offline-only" },
    { mode: "STUB" },
  );
  const saved = await readJSON(
    resolve(fixture.out, "execution/qualification-results.json"),
  );
  assert.equal(executorCalls, 1);
  assert.equal(forwardedCalls, 1);
  assert.equal(saved.rows[0].execution_failure.category, "transport");
  assert.equal(saved.rows[0].provider_attempt_count, 0);
  assert.equal(saved.rows[0].status, "NOT_RUN");
  assert.equal(saved.budget.length, 0);
});

test("real SDK HTTP failure retains one reservation and every planned unrun row", async () => {
  const fixture = await executionFixture(
    baseline,
    resolve(temporary, "http-execution"),
  );
  let calls = 0;
  await runQualification(
    fixture,
    approvalFor(fixture.manifest),
    async (_url, init) => {
      calls++;
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      return new Response(
        JSON.stringify({
          error: {
            type: "rate_limit_error",
            code: "rate_limit_exceeded",
            message: "Offline HTTP fixture",
          },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    },
    { openai: "offline-only" },
    { mode: "STUB" },
  );
  const saved = await readJSON(
    resolve(fixture.out, "execution/qualification-results.json"),
  );
  assert.equal(calls, 1);
  assert.equal(saved.rows.length, fixture.manifest.trials.length);
  assert.equal(saved.rows[0].provider_attempt_count, 1);
  assert.equal(saved.rows[0].attempts[0].http_status, 429);
  assert.equal(saved.rows[0].attempts[0].host_accepted, false);
  assert(
    saved.rows
      .slice(1)
      .every((r) => r.status === "NOT_RUN" && r.provider_attempt_count === 0),
  );
  assert.equal(saved.budget.length, 1);
  assert.equal(saved.budget[0].cost, null);
  assert(saved.budget[0].reserved > 0);
  assert.equal(saved.summary.complete_cohort, false);
  assert.equal(saved.summary.provider_invocations, 0);
});
