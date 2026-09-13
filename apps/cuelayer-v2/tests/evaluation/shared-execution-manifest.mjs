import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256, exclusive, readJSON } from "./evidence.mjs";
import { evaluatorRoot, fingerprintFiles } from "./manifest.mjs";
import { Provenance, loadProduct, git } from "./provenance.mjs";
import { loadScenarios, loadCanaryContracts } from "./assets.mjs";
import { generateCanaries } from "./canary.mjs";

export const SHARED_EXECUTION_IDENTITY = "cuelayer-v2-shared-execution-1";
export const SHARED_PROFILE_IDENTITY = "cuelayer-v2-shared-canary-profile-1";
export const SHARED_CANARIES = Object.freeze([
  "quantitative",
  "cross-fragment-condition",
  "correction-authority",
  "unresolved-reference",
  "stage-insufficient",
  "stage-clarified",
]);
export const SHARED_PROVIDER_URL = "https://api.openai.com/v1/responses";
const same = (a, b) => sha256(a) === sha256(b);

export function sharedProfile(provider, budget = null) {
  return {
    identity: SHARED_PROFILE_IDENTITY,
    model_requested: provider.model,
    reasoning_effort: provider.reasoning,
    stage_reasoning_effort: provider.stageReasoning,
    max_output_tokens: provider.maxOutputTokens,
    provider_deadline_ms: provider.providerTimeoutMs,
    host_deadline_ms: provider.clientTimeoutMs,
    sdk_retries: provider.sdkRetries,
    transport_retries: provider.transportRetries,
    retry_min_ms: provider.retryMinMs,
    retry_factor: provider.retryFactor,
    max_requests: budget?.max_requests ?? null,
    max_cost_usd: budget?.max_cost_usd ?? null,
    reservation_per_request_usd: budget?.reservation_per_request_usd ?? null,
    prices_per_million: budget?.prices_per_million ?? null,
    pricing_evidence: budget?.pricing_evidence ?? null,
  };
}

export function assertSharedPolicy(manifest, { requireBudget = true } = {}) {
  const p = manifest.profile;
  if (
    manifest.identity !== SHARED_EXECUTION_IDENTITY ||
    !/^[a-f0-9]{40}$/.test(manifest.product_sha) ||
    p?.identity !== SHARED_PROFILE_IDENTITY ||
    manifest.profile_sha256 !== sha256(p) ||
    !same(p, sharedProfile(manifest.provider_profile, p)) ||
    p.provider_deadline_ms !== 6000 ||
    p.host_deadline_ms !== 8000 ||
    p.sdk_retries !== 0 ||
    p.transport_retries !== 2 ||
    p.retry_min_ms !== 20 ||
    p.retry_factor !== 2 ||
    manifest.provider_url !== SHARED_PROVIDER_URL ||
    !same(manifest.actual_model_allowlist, [p.model_requested]) ||
    !same(
      manifest.canaries.map((c) => c.snapshot_id),
      SHARED_CANARIES,
    ) ||
    !same(
      manifest.cohort,
      SHARED_CANARIES.map((run_id) => ({
        run_id,
        phase: "3b-1",
        status: "NOT_RUN",
      })),
    )
  )
    throw Error("unapproved-model-cohort-or-config");
  if (
    requireBudget &&
    (!Number.isInteger(p.max_requests) ||
      p.max_requests <= 0 ||
      !Number.isFinite(p.max_cost_usd) ||
      p.max_cost_usd <= 0 ||
      !Number.isFinite(p.reservation_per_request_usd) ||
      p.reservation_per_request_usd <= 0 ||
      !p.pricing_evidence ||
      !["input", "output", "cached_input"].every(
        (key) =>
          Number.isFinite(p.prices_per_million?.[key]) &&
          p.prices_per_million[key] >= 0,
      ))
  )
    throw Error("execution-budget-and-current-pricing-required");
}

export async function loadSharedExecutionProduct(provenance) {
  const product = await loadProduct(provenance);
  for (const [key, path] of Object.entries({
    execution: "src/execution.ts",
    providerExecution: "server/provider-execution.ts",
    acceptanceEvent: "src/acceptance-event.ts",
  }))
    product[key] = await import(
      pathToFileURL(resolve(provenance.product, "apps/cuelayer-v2", path)).href
    );
  return product;
}

export async function prepareSharedExecution({
  productRoot,
  productSha,
  out,
  budget = null,
}) {
  if (!/^[a-f0-9]{40}$/.test(productSha ?? ""))
    throw Error("explicit-full-product-sha-required");
  const provenance = new Provenance(productRoot, evaluatorRoot, { productSha });
  const product = await loadSharedExecutionProduct(provenance);
  await mkdir(out, { recursive: false });
  const snapshots = await generateCanaries(product, resolve(out, "canaries"), {
    generationContract: SHARED_EXECUTION_IDENTITY,
  });
  if (
    snapshots.some(
      (s) => s.fixture_acceptance_error || s.projection.violations.length,
    )
  )
    throw Error("canary-production-generation-failed");
  const policy = sharedProfile(product.provider.modelProfile, budget);
  const canaries = await Promise.all(
    snapshots.map(async (snapshot) => {
      const path = resolve(out, "canaries", snapshot.snapshot_id + ".json");
      return {
        snapshot_id: snapshot.snapshot_id,
        path,
        file_sha256: sha256(await readFile(path)),
        object_sha256: sha256(snapshot),
        request_sha256: sha256(snapshot.payload),
      };
    }),
  );
  const manifest = {
    identity: SHARED_EXECUTION_IDENTITY,
    run_id: resolve(out).split("/").at(-1),
    execution_directory: resolve(out),
    created_at: new Date().toISOString(),
    scope: "3b-1 only",
    paid_enabled: false,
    authorization_required: true,
    product_sha: productSha,
    product_checkout: provenance.product,
    evaluator_sha: git(evaluatorRoot, "rev-parse", "HEAD"),
    evaluator_checkout: evaluatorRoot,
    evaluator_files: await fingerprintFiles(evaluatorRoot),
    provider_profile: product.provider.modelProfile,
    profile: policy,
    profile_sha256: sha256(policy),
    provider_url: SHARED_PROVIDER_URL,
    actual_model_allowlist: [policy.model_requested],
    canaries,
    cohort: SHARED_CANARIES.map((run_id) => ({
      run_id,
      phase: "3b-1",
      status: "NOT_RUN",
    })),
    oracle_sha256: sha256({
      scenarios: await loadScenarios(),
      canaries: await loadCanaryContracts(),
    }),
    system_prompt_sha256: snapshots.map((s) => sha256(s.payload.input[0])),
    schema_sha256: snapshots.map((s) => sha256(s.payload.text.format.schema)),
    input_sha256: sha256(snapshots.map((s) => s.prestate.evidence)),
    runtime_identity: provenance.snapshot(),
    historical_execution:
      "Historical manifests remain bound to their recorded product and evaluator SHAs; this manifest creates a new identity.",
    other_phases: "NOT_AUTHORIZED",
  };
  assertSharedPolicy(manifest, { requireBudget: budget !== null });
  await exclusive(resolve(out, "execution-manifest.json"), manifest);
  await exclusive(resolve(out, "execution-manifest-seal.json"), {
    object_sha256: sha256(manifest),
    file_sha256: sha256(
      await readFile(resolve(out, "execution-manifest.json")),
    ),
  });
  return { manifest, manifest_sha256: sha256(manifest) };
}

export async function verifySharedExecution(path) {
  const manifest = await readJSON(path),
    seal = await readJSON(resolve(path, "../execution-manifest-seal.json"));
  assertSharedPolicy(manifest, { requireBudget: false });
  if (
    seal.object_sha256 !== sha256(manifest) ||
    seal.file_sha256 !== sha256(await readFile(path)) ||
    manifest.paid_enabled !== false ||
    manifest.execution_directory !== resolve(path, "..") ||
    manifest.evaluator_checkout !== evaluatorRoot ||
    manifest.evaluator_sha !== git(evaluatorRoot, "rev-parse", "HEAD") ||
    !same(manifest.evaluator_files, await fingerprintFiles(evaluatorRoot))
  )
    throw Error("shared-execution-identity-drift");
  const provenance = new Provenance(manifest.product_checkout, evaluatorRoot, {
    productSha: manifest.product_sha,
  });
  const product = await loadSharedExecutionProduct(provenance);
  if (!same(manifest.provider_profile, product.provider.modelProfile))
    throw Error("shared-provider-profile-drift");
  const scenarios = [
    ...(await loadScenarios()),
    ...(await loadCanaryContracts()),
  ];
  if (
    manifest.oracle_sha256 !==
    sha256({
      scenarios: await loadScenarios(),
      canaries: await loadCanaryContracts(),
    })
  )
    throw Error("shared-oracle-drift");
  const snapshots = [];
  for (const c of manifest.canaries) {
    const raw = await readFile(c.path),
      snapshot = JSON.parse(raw);
    if (
      sha256(raw) !== c.file_sha256 ||
      sha256(snapshot) !== c.object_sha256 ||
      sha256(snapshot.payload) !== c.request_sha256 ||
      !same(
        product.execution.capturedRequest(snapshot.task).request,
        snapshot.request,
      ) ||
      !same(
        await product.provider.liveRequest(snapshot.request),
        snapshot.payload,
      )
    )
      throw Error("shared-captured-request-drift");
    let restored = product.contract.emptyReplay();
    for (const event of snapshot.generation.precondition_events)
      restored = product.contract.fold(restored, event);
    if (!same(restored, snapshot.prestate))
      throw Error("shared-precondition-replay-drift");
    snapshots.push({ snapshot, file: c.path });
  }
  if (
    !same(
      manifest.system_prompt_sha256,
      snapshots.map(({ snapshot }) => sha256(snapshot.payload.input[0])),
    ) ||
    !same(
      manifest.schema_sha256,
      snapshots.map(({ snapshot }) =>
        sha256(snapshot.payload.text.format.schema),
      ),
    ) ||
    manifest.input_sha256 !==
      sha256(snapshots.map(({ snapshot }) => snapshot.prestate.evidence))
  )
    throw Error("shared-contract-hash-drift");
  provenance.verifyRecorded(manifest.runtime_identity);
  return {
    manifest,
    manifest_sha256: sha256(manifest),
    product,
    provenance,
    snapshots,
    scenarios,
    out: resolve(path, ".."),
  };
}
