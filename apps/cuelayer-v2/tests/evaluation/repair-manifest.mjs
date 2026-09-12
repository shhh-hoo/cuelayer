import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { profile } from "./contract.mjs";
import { sha256, exclusive, readJSON } from "./evidence.mjs";
import { evaluatorRoot, fingerprintFiles } from "./manifest.mjs";
import { Provenance, git } from "./provenance.mjs";
import { loadScenarios, loadCanaryContracts } from "./assets.mjs";
import { assessProjection } from "./projection.mjs";
import {
  CANARIES,
  PROVIDER_URL,
  loadExecutionProduct,
} from "./execution-manifest.mjs";

export const REPAIR_PRODUCT_SHA = "2957c337cee4c9e65be1d437a278b374a65a1d63";
export const REPAIR_IDENTITY = "gate3b-1-repair-cohort-1";
export const REPAIR_PROFILE = Object.freeze({
  ...profile,
  identity: "gate3b-six-canary-repair-1",
  max_cost_usd: 1,
  max_requests: 12,
});
const PARENT_SHA = "e84540e7a56bf9618e763faf2b8161595c28003d";
const PARENT_MANIFEST =
  "edbd7d09e3cddc249f0c8441a7f72c66d8b6f2c4be81d1afef000a425ad8bda8";
const revised = new Set(
  [
    "assessment.mjs",
    "score.mjs",
    "contract.mjs",
    "provenance.mjs",
    "execution-manifest.mjs",
    "execute-canary.mjs",
    "cli.mjs",
    "canaries/stage-clarified.json",
  ].map((f) => "apps/cuelayer-v2/tests/evaluation/" + f),
);
const same = (a, b) => sha256(a) === sha256(b);
async function source(parentPath, productRoot) {
  const parent = await readJSON(parentPath);
  const parentResult = await readJSON(
    resolve(parentPath, "../execution-result.json"),
  );
  if (
    sha256(parent) !== PARENT_MANIFEST ||
    parent.evaluator_sha !== PARENT_SHA ||
    parentResult.status !== "FAIL" ||
    parentResult.actual_provider_attempts !== 6
  )
    throw Error("historical-cohort-identity");
  const seal = await readJSON(resolve(parentPath, "../evidence-seal.json"));
  for (const f of seal.files)
    if (sha256(await readFile(resolve(parentPath, "..", f.path))) !== f.sha256)
      throw Error("historical-evidence-changed:" + f.path);
  for (const [file, digest] of Object.entries(parent.evaluator_files))
    if (
      !revised.has(file) &&
      sha256(await readFile(resolve(evaluatorRoot, file))) !== digest
    )
      throw Error("unapproved-evaluator-change:" + file);
  const v1 = await readFile(
    resolve(
      evaluatorRoot,
      "apps/cuelayer-v2/tests/evaluation/canaries/history/stage-clarified.v1.json",
    ),
  );
  if (
    sha256(v1) !==
    parent.evaluator_files[
      "apps/cuelayer-v2/tests/evaluation/canaries/stage-clarified.json"
    ]
  )
    throw Error("historical-stage-oracle-changed");
  const provenance = new Provenance(productRoot, evaluatorRoot, {
    productSha: REPAIR_PRODUCT_SHA,
  });
  const product = await loadExecutionProduct(provenance);
  const expectedProvider = {
    ...parent.provider_profile,
    structuredOutput: product.provider.modelProfile.structuredOutput,
  };
  if (!same(product.provider.modelProfile, expectedProvider))
    throw Error("unapproved-provider-profile-change");
  const scenarios = [
    ...(await loadScenarios()),
    ...(await loadCanaryContracts()),
  ];
  const originals = [];
  for (const c of parent.canaries) {
    const raw = await readFile(c.path),
      snapshot = JSON.parse(raw);
    if (
      sha256(raw) !== c.file_sha256 ||
      sha256(snapshot.payload) !== c.request_sha256
    )
      throw Error("historical-snapshot-drift");
    let restored = product.contract.emptyReplay();
    for (const event of snapshot.generation.precondition_events)
      restored = product.contract.fold(restored, event);
    if (!same(restored, snapshot.prestate))
      throw Error("precondition-replay-drift");
    originals.push({ snapshot, original: c });
  }
  return { parent, parentResult, provenance, product, scenarios, originals };
}

export async function continuationRecord(manifestPath) {
  const previous = await readJSON(manifestPath);
  if (!["e802c0443c43da0e118beab63ab56d1c026662f5686af7765f0b4fefe28f332f", "2bbafc31112cfdf82a939412065b4e5767d0a9bd79a3ba031ea7b182ea2ab38a"].includes(sha256(previous)))
    throw Error("unapproved-continuation-source");
  const directory = resolve(manifestPath, "..");
  if (previous.continuation) await continuationRecord(previous.continuation.previous_manifest);
  const seal = await readJSON(resolve(directory, "live-evidence-seal.json"));
  for (const f of seal.files)
    if (sha256(await readFile(resolve(directory, f.path))) !== f.sha256)
      throw Error("continuation-evidence-drift:" + f.path);
  const result = await readJSON(resolve(directory, "execution-result.json"));
  const retained = [];
  const remaining = [];
  for (const row of result.canaries) {
    const calls = result.budget.filter((c) => c.run_id === row.run_id);
    if (calls.length) {
      const evidence = row.evidence ?? resolve(directory, row.run_id, "result.json");
      const detail = await readJSON(evidence);
      if (detail.hard_fail || detail.status === "INVALID")
        throw Error("continuation-hard-stop");
      retained.push({ ...row, evidence });
    } else {
      if (row.started) {
        const detail = await readJSON(resolve(directory, row.run_id, "result.json"));
        if (detail.provider_attempt_count !== 0 || detail.operational?.reason !== "budget-exhausted")
          throw Error("continuation-only-undispatched-budget-stop");
      }
      remaining.push(row.run_id);
    }
  }
  if (retained.map((r) => r.run_id).join(",") !== CANARIES.slice(0, retained.length).join(",") || remaining.join(",") !== CANARIES.slice(retained.length).join(","))
    throw Error("continuation-cohort-drift");
  return {
    identity: "gate3b-budget-amendment-continuation-1",
    previous_manifest: resolve(manifestPath),
    previous_manifest_sha256: sha256(previous),
    previous_result_sha256: sha256(result),
    previous_evidence_seal_sha256: sha256(seal),
    retained_runs: retained,
    remaining_canaries: remaining,
    prior_budget: result.budget,
    budget_override: { max_cost_usd: null, max_requests: null },
    pending_adjudication_policy: "Collect the remaining same-cohort requests without resolving or passing pending items; no later Gate phase is eligible.",
    reason: "User instructed completion of all tests without usage limits. Retain all already-dispatched results, including unresolved adjudication. This is evidence collection, not a claim of preregistered Gate progression.",
  };
}

export async function prepareRepairExecution(parentPath, productRoot, out, continuationPath = null) {
  const s = await source(parentPath, productRoot);
  const continuation = continuationPath ? await continuationRecord(continuationPath) : null;
  await mkdir(out, { recursive: false });
  await mkdir(resolve(out, "canaries"));
  const canaries = [],
    diffs = [];
  for (const { snapshot: old, original } of s.originals) {
    const task =
      old.task.lane === "Live"
        ? s.product.projection.captureLive(
            old.prestate,
            old.task.sessionId,
            old.task.capture.namespace,
            old.task.attentionEpoch,
          )
        : s.product.stage.captureStage(
            old.prestate,
            old.task.sessionId,
            old.task.review.namespace,
            old.task.attentionEpoch,
            old.task.review.items[0].subjectId,
          );
    if (!task) throw Error("production-recapture-missing:" + old.snapshot_id);
    const request = (task.capture ?? task.review).request;
    for (const key of [
      "source",
      "context",
      "writableUnits",
      "createWithin",
      "newCores",
      "newUnits",
      "obligations",
      "items",
    ])
      if (!same(request[key] ?? null, old.request[key] ?? null))
        throw Error("unapproved-capture-change:" + key);
    const payload = await s.product.provider.liveRequest(request);
    const scenario = s.scenarios.find(
      (x) => x.scenario_id === old.oracle_reference.scenario_id,
    );
    const projection = assessProjection(
      { task, replay: old.prestate, request },
      old.requirements,
    );
    if (projection.violations.length)
      throw Error("recapture-projection-failure");
    const snapshot = {
      snapshot_id: old.snapshot_id,
      dependency_mode: "STUB",
      purpose:
        "production recapture from unchanged historical precondition events; no model call",
      provider_invocations: 0,
      oracle_reference: {
        ...old.oracle_reference,
        contract_sha256: sha256(scenario),
      },
      generation: {
        precondition_events: old.generation.precondition_events,
        production_capture: true,
        production_builder: true,
        historical_snapshot: original,
      },
      task,
      prestate: old.prestate,
      request,
      payload,
      payload_sha256: sha256(payload),
      requirements: old.requirements,
      projection,
    };
    const file = resolve(out, "canaries", old.snapshot_id + ".json");
    await exclusive(file, snapshot);
    canaries.push({
      snapshot_id: old.snapshot_id,
      path: file,
      file_sha256: sha256(await readFile(file)),
      object_sha256: sha256(snapshot),
      request_sha256: sha256(payload),
    });
    const delta = {
      snapshot_id: old.snapshot_id,
      old_request_sha256: original.request_sha256,
      new_request_sha256: sha256(payload),
      old_bytes: Buffer.byteLength(JSON.stringify(old.payload)),
      new_bytes: Buffer.byteLength(JSON.stringify(payload)),
      old_payload: old.payload,
      new_payload: payload,
      old_context: old.request,
      new_context: request,
      precondition_events_unchanged: true,
      teaching_evidence_unchanged: true,
    };
    diffs.push(delta);
  }
  const manifest = {
    identity: REPAIR_IDENTITY,
    run_id: out.split("/").at(-1),
    execution_directory: resolve(out),
    created_at: new Date().toISOString(),
    scope: "3b-1 only",
    product_sha: REPAIR_PRODUCT_SHA,
    evaluator_sha: git(evaluatorRoot, "rev-parse", "HEAD"),
    evaluator_checkout: evaluatorRoot,
    product_checkout: s.provenance.product,
    parent_execution_manifest: resolve(parentPath),
    parent_manifest_sha256: PARENT_MANIFEST,
    parent_result_sha256: sha256(s.parentResult),
    previous_evaluator_sha: PARENT_SHA,
    evaluator_files: await fingerprintFiles(evaluatorRoot),
    oracle_sha256: sha256({
      scenarios: await loadScenarios(),
      canaries: await loadCanaryContracts(),
    }),
    profile: REPAIR_PROFILE,
    profile_sha256: sha256(REPAIR_PROFILE),
    provider_profile: s.product.provider.modelProfile,
    sdk_version: s.parent.sdk_version,
    provider_url: PROVIDER_URL,
    actual_model_allowlist: [profile.model_requested],
    canaries,
    system_prompt_sha256: diffs.map((d) => sha256(d.new_payload.input[0])),
    schema_sha256: diffs.map((d) => sha256(d.new_payload.text.format.schema)),
    input_sha256: sha256(s.originals.map((x) => x.snapshot.prestate.evidence)),
    request_diffs_sha256: sha256(diffs),
    runtime_identity: s.provenance.snapshot(),
    clean_worktree_assertion: { product: true, evaluator: true },
    stop_rule: s.parent.stop_rule,
    other_phases: "NOT_AUTHORIZED",
    authorization_required: true,
    cohort: CANARIES.map((id) => ({
      run_id: id,
      phase: "3b-1",
      status: "NOT_RUN",
    })),
    ...(continuation ? { continuation } : {}),
  };
  if (continuation) {
    const previous = await readJSON(continuation.previous_manifest);
    if (!same(manifest.canaries.map((c) => c.request_sha256), previous.canaries.map((c) => c.request_sha256)))
      throw Error("continuation-request-bytes-changed");
  }
  await exclusive(resolve(out, "request-diffs.json"), diffs);
  await exclusive(resolve(out, "execution-manifest.json"), manifest);
  await exclusive(resolve(out, "execution-manifest-seal.json"), {
    object_sha256: sha256(manifest),
    file_sha256: sha256(
      await readFile(resolve(out, "execution-manifest.json")),
    ),
  });
  return { manifest, manifest_sha256: sha256(manifest) };
}

export async function verifyRepairExecution(path) {
  const manifest = await readJSON(path),
    seal = await readJSON(resolve(path, "../execution-manifest-seal.json"));
  if (
    sha256(manifest) !== seal.object_sha256 ||
    sha256(await readFile(path)) !== seal.file_sha256 ||
    manifest.identity !== REPAIR_IDENTITY ||
    manifest.product_sha !== REPAIR_PRODUCT_SHA ||
    manifest.evaluator_checkout !== evaluatorRoot ||
    manifest.evaluator_sha !== git(evaluatorRoot, "rev-parse", "HEAD") ||
    manifest.execution_directory !== resolve(path, "..") ||
    !same(manifest.evaluator_files, await fingerprintFiles(evaluatorRoot))
  )
    throw Error("repair-execution-identity");
  const s = await source(
    manifest.parent_execution_manifest,
    manifest.product_checkout,
  );
  if (
    !same(manifest.profile, REPAIR_PROFILE) ||
    manifest.profile_sha256 !== sha256(REPAIR_PROFILE) ||
    !same(manifest.provider_profile, s.product.provider.modelProfile) ||
    manifest.parent_manifest_sha256 !== PARENT_MANIFEST ||
    manifest.parent_result_sha256 !== sha256(s.parentResult) ||
    manifest.oracle_sha256 !==
      sha256({
        scenarios: await loadScenarios(),
        canaries: await loadCanaryContracts(),
      }) ||
    manifest.request_diffs_sha256 !==
      sha256(await readJSON(resolve(path, "../request-diffs.json")))
  )
    throw Error("repair-manifest-drift");
  if (manifest.continuation && !same(manifest.continuation, await continuationRecord(manifest.continuation.previous_manifest)))
    throw Error("continuation-identity-drift");
  const snapshots = [];
  for (const c of manifest.canaries) {
    const raw = await readFile(c.path),
      snapshot = JSON.parse(raw);
    if (
      sha256(raw) !== c.file_sha256 ||
      sha256(snapshot) !== c.object_sha256 ||
      sha256(snapshot.payload) !== c.request_sha256 ||
      !same(
        await s.product.provider.liveRequest(snapshot.request),
        snapshot.payload,
      )
    )
      throw Error("repair-request-drift");
    const old = s.originals.find(
      (x) => x.snapshot.snapshot_id === c.snapshot_id,
    ).snapshot;
    if (
      !same(snapshot.prestate, old.prestate) ||
      !same(
        snapshot.generation.precondition_events,
        old.generation.precondition_events,
      )
    )
      throw Error("repair-input-drift");
    snapshots.push({ snapshot, file: c.path });
  }
  s.provenance.verifyRecorded(manifest.runtime_identity);
  return {
    ...s,
    manifest,
    manifest_sha256: sha256(manifest),
    out: resolve(path, ".."),
    snapshots,
  };
}
