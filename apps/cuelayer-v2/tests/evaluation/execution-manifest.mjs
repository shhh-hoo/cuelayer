import {
  REPAIR_IDENTITY,
  REPAIR_PRODUCT_SHA,
  REPAIR_PROFILE,
  verifyRepairExecution,
} from "./repair-manifest.mjs";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { sha256, exclusive, readJSON } from "./evidence.mjs";
import { PRODUCT_SHA, profile } from "./contract.mjs";
import { evaluatorRoot, fingerprintFiles } from "./manifest.mjs";
import { Provenance, loadProduct, git } from "./provenance.mjs";
import { loadScenarios, loadCanaryContracts } from "./assets.mjs";

export const PREVIOUS_EVALUATOR = "f6c48097470437fbbce86767fb3e7cbcbb847148";
export const BASELINE_MANIFEST =
  "4b18698433d76fa05f15e83742bc2d16d8e6e7ddb74df243057724351f1ede0a";
export const CANARIES = Object.freeze([
  "quantitative",
  "cross-fragment-condition",
  "correction-authority",
  "unresolved-reference",
  "stage-insufficient",
  "stage-clarified",
]);
export const PROVIDER_URL = "https://api.openai.com/v1/responses";
const mutableEntryFiles = new Set([
  "apps/cuelayer-v2/scripts/evaluate-frontier.mjs",
  "apps/cuelayer-v2/tests/evaluation/cli.mjs",
]);
const equal = (a, b) => sha256(a) === sha256(b);

export async function loadExecutionProduct(provenance) {
  const product = await loadProduct(provenance);
  product.interpreter = await import(
    pathToFileURL(
      resolve(provenance.product, "apps/cuelayer-v2/src/adapters/live.ts"),
    ).href
  );
  product.stream = await import(
    pathToFileURL(
      resolve(
        provenance.product,
        "apps/cuelayer-v2/node_modules/openai/core/streaming.mjs",
      ),
    ).href
  );
  return product;
}

// This reads the accepted historical qualification; it never reruns or rewrites 3b-0.
export async function verifyBaseline(path, { development = false } = {}) {
  const bytes = await readFile(path),
    baseline = JSON.parse(bytes);
  const seal = await readJSON(resolve(path, "../manifest-seal.json"));
  const qualification = await readJSON(
    resolve(path, "../preflight-result.json"),
  );
  if (
    sha256(baseline) !== BASELINE_MANIFEST ||
    seal.sha256 !== BASELINE_MANIFEST ||
    baseline.evaluator_sha !== PREVIOUS_EVALUATOR ||
    baseline.code_sha !== PRODUCT_SHA ||
    qualification.status !== "PASS" ||
    qualification.manifest_sha256 !== BASELINE_MANIFEST
  )
    throw Error("previous-qualification-identity");
  const provenance = new Provenance(baseline.product_checkout, evaluatorRoot, {
    allowDirtyEvaluator: development,
  });
  for (const [file, digest] of Object.entries(baseline.evaluator_files)) {
    const old = execFileSync("git", [
      "-C",
      evaluatorRoot,
      "show",
      PREVIOUS_EVALUATOR + ":" + file,
    ]);
    if (sha256(old) !== digest)
      throw Error("historical-evaluator-hash:" + file);
    if (
      !mutableEntryFiles.has(file) &&
      sha256(await readFile(resolve(evaluatorRoot, file))) !== digest
    )
      throw Error("protected-evaluator-file-changed:" + file);
  }
  const scenarios = [
    ...(await loadScenarios()),
    ...(await loadCanaryContracts()),
  ];
  if (!equal(profile, baseline.profile)) throw Error("profile-changed");
  if (
    sha256({
      scenarios: await loadScenarios(),
      canaries: await loadCanaryContracts(),
    }) !== baseline.oracle_sha256
  )
    throw Error("oracle-changed");
  provenance.verifyRecorded(baseline.runtime_identity);
  for (const dependency of baseline.runtime_identity.dependencies)
    if (sha256(await readFile(dependency.path)) !== dependency.package_sha256)
      throw Error("dependency-identity-drift");
  const product = await loadExecutionProduct(provenance);
  if (!equal(product.provider.modelProfile, baseline.provider_profile))
    throw Error("provider-profile-changed");
  const snapshots = [];
  for (const id of CANARIES) {
    const file = resolve(path, "../canaries", id + ".json"),
      raw = await readFile(file),
      snapshot = JSON.parse(raw);
    const frozen = baseline.canary_manifest.find((c) => c.snapshot_id === id);
    if (
      !frozen ||
      sha256(snapshot) !== frozen.artifact_sha256 ||
      sha256(snapshot.payload) !== frozen.payload_sha256 ||
      !equal(
        await product.provider.liveRequest(snapshot.request),
        snapshot.payload,
      )
    )
      throw Error("frozen-request-changed:" + id);
    let restored = product.contract.emptyReplay();
    for (const event of snapshot.generation.precondition_events)
      restored = product.contract.fold(restored, event);
    if (!equal(restored, snapshot.prestate))
      throw Error("precondition-event-state-mismatch:" + id);
    snapshots.push({
      snapshot,
      file,
      file_sha256: sha256(raw),
      object_sha256: sha256(snapshot),
      request_sha256: sha256(snapshot.payload),
    });
  }
  return {
    baseline,
    baseline_file_sha256: sha256(bytes),
    provenance,
    product,
    scenarios,
    snapshots,
  };
}

export async function prepareExecution(baselinePath, out) {
  const source = await verifyBaseline(baselinePath);
  const manifest = {
    identity: "gate3b-1-authorized-execution-1",
    run_id: out.split("/").at(-1),
    execution_directory: resolve(out),
    created_at: new Date().toISOString(),
    scope: "3b-1 only",
    product_sha: PRODUCT_SHA,
    evaluator_sha: git(evaluatorRoot, "rev-parse", "HEAD"),
    evaluator_checkout: evaluatorRoot,
    product_checkout: source.provenance.product,
    baseline_manifest: resolve(baselinePath),
    baseline_manifest_sha256: BASELINE_MANIFEST,
    baseline_manifest_file_sha256: source.baseline_file_sha256,
    previous_preflight_evaluator: PREVIOUS_EVALUATOR,
    evaluator_files: await fingerprintFiles(evaluatorRoot),
    oracle_sha256: source.baseline.oracle_sha256,
    system_prompt_sha256: source.baseline.system_prompt_sha256,
    schema_sha256: source.baseline.schema_sha256,
    profile,
    profile_sha256: sha256(profile),
    provider_profile: source.product.provider.modelProfile,
    sdk_version: source.baseline.sdk_version,
    provider_url: PROVIDER_URL,
    actual_model_allowlist: [profile.model_requested],
    canaries: source.snapshots.map((s) => ({
      snapshot_id: s.snapshot.snapshot_id,
      path: s.file,
      file_sha256: s.file_sha256,
      object_sha256: s.object_sha256,
      request_sha256: s.request_sha256,
    })),
    cohort: CANARIES.map((id) => ({
      run_id: id,
      phase: "3b-1",
      status: "NOT_RUN",
    })),
    runtime_identity: source.provenance.snapshot(),
    clean_worktree_assertion: { product: true, evaluator: true },
    stop_rule: source.baseline.stop_rule,
    other_phases: "NOT_AUTHORIZED",
    authorization_required: true,
  };
  await mkdir(out, { recursive: false });
  await exclusive(resolve(out, "execution-manifest.json"), manifest);
  await exclusive(resolve(out, "execution-manifest-seal.json"), {
    object_sha256: sha256(manifest),
    file_sha256: sha256(
      await readFile(resolve(out, "execution-manifest.json")),
    ),
  });
  return { manifest, manifest_sha256: sha256(manifest) };
}

export async function verifyExecution(path) {
  if ((await readJSON(path)).identity === REPAIR_IDENTITY)
    return verifyRepairExecution(path);
  const manifest = await readJSON(path),
    bytes = await readFile(path),
    seal = await readJSON(resolve(path, "../execution-manifest-seal.json"));
  if (
    seal.object_sha256 !== sha256(manifest) ||
    seal.file_sha256 !== sha256(bytes)
  )
    throw Error("execution-manifest-drift");
  if (
    manifest.identity !== "gate3b-1-authorized-execution-1" ||
    manifest.execution_directory !== resolve(path, "..") ||
    manifest.scope !== "3b-1 only" ||
    manifest.product_sha !== PRODUCT_SHA ||
    manifest.evaluator_checkout !== evaluatorRoot ||
    manifest.evaluator_sha !== git(evaluatorRoot, "rev-parse", "HEAD") ||
    !equal(manifest.evaluator_files, await fingerprintFiles(evaluatorRoot))
  )
    throw Error("execution-code-identity");
  const source = await verifyBaseline(manifest.baseline_manifest);
  if (
    manifest.baseline_manifest_file_sha256 !== source.baseline_file_sha256 ||
    manifest.baseline_manifest_sha256 !== BASELINE_MANIFEST ||
    manifest.previous_preflight_evaluator !== PREVIOUS_EVALUATOR ||
    !equal(manifest.profile, profile) ||
    manifest.profile_sha256 !== sha256(profile) ||
    manifest.provider_url !== PROVIDER_URL ||
    !equal(manifest.provider_profile, source.product.provider.modelProfile) ||
    !equal(manifest.actual_model_allowlist, [profile.model_requested]) ||
    manifest.oracle_sha256 !== source.baseline.oracle_sha256 ||
    manifest.sdk_version !== source.baseline.sdk_version ||
    !equal(
      manifest.system_prompt_sha256,
      source.baseline.system_prompt_sha256,
    ) ||
    !equal(manifest.schema_sha256, source.baseline.schema_sha256) ||
    !equal(manifest.stop_rule, source.baseline.stop_rule) ||
    !equal(
      manifest.cohort,
      CANARIES.map((id) => ({ run_id: id, phase: "3b-1", status: "NOT_RUN" })),
    )
  )
    throw Error("execution-profile-or-cohort");
  const snapshots = source.snapshots.map((s) => ({
    snapshot_id: s.snapshot.snapshot_id,
    path: s.file,
    file_sha256: s.file_sha256,
    object_sha256: s.object_sha256,
    request_sha256: s.request_sha256,
  }));
  if (!equal(manifest.canaries, snapshots))
    throw Error("execution-snapshot-drift");
  source.provenance.verifyRecorded(manifest.runtime_identity);
  return {
    ...source,
    manifest,
    manifest_sha256: sha256(manifest),
    out: resolve(path, ".."),
  };
}

// Authorization is supplied explicitly by the operator after approval. No command creates it.
export function validateAuthorization(
  manifest,
  authorization,
  now = Date.now(),
) {
  assertExecutionPolicy(manifest);
  if (
    !authorization ||
    authorization.allow_real_provider !== true ||
    authorization.identity !== "gate3b-execution-authorization-1"
  )
    throw Error("execution-authorization-required");
  if (
    typeof authorization.authorization_id !== "string" ||
    !authorization.authorization_id.trim() ||
    authorization.manifest_sha256 !== sha256(manifest) ||
    authorization.evaluator_sha !== manifest.evaluator_sha ||
    authorization.product_sha !== manifest.product_sha ||
    authorization.profile_sha256 !== manifest.profile_sha256 ||
    !equal(
      authorization.canaries,
      manifest.canaries.map((c) => c.snapshot_id),
    ) ||
    authorization.model !== manifest.profile.model_requested
  )
    throw Error("authorization-binding-mismatch");
  if (
    !Number.isFinite(Date.parse(authorization.issued_at)) ||
    !Number.isFinite(Date.parse(authorization.expires_at)) ||
    Date.parse(authorization.issued_at) > now ||
    Date.parse(authorization.expires_at) <= now
  )
    throw Error("authorization-expired-or-not-yet-valid");
  return true;
}

export function assertExecutionPolicy(manifest) {
  const repair = manifest.identity === REPAIR_IDENTITY;
  const expectedProfile = repair ? REPAIR_PROFILE : profile;
  const expectedProduct = repair ? REPAIR_PRODUCT_SHA : PRODUCT_SHA;
  if (
    manifest.product_sha !== expectedProduct ||
    !equal(manifest.profile, expectedProfile) ||
    manifest.profile_sha256 !== sha256(expectedProfile) ||
    manifest.provider_url !== PROVIDER_URL ||
    !equal(manifest.actual_model_allowlist, [profile.model_requested]) ||
    !equal(
      manifest.canaries.map((c) => c.snapshot_id),
      CANARIES,
    ) ||
    !equal(
      manifest.cohort,
      CANARIES.map((id) => ({ run_id: id, phase: "3b-1", status: "NOT_RUN" })),
    )
  )
    throw Error("unapproved-model-cohort-or-config");
}
