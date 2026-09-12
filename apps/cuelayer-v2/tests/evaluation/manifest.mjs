import { readdir, readFile, mkdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, exclusive, readJSON } from "./evidence.mjs";
import { PRODUCT_SHA, profile, scenarioSchema } from "./contract.mjs";
import { z } from "zod";
import { git, Provenance, loadProduct } from "./provenance.mjs";
import {
  loadScenarios,
  loadCanaryContracts,
  verifyLegacyInputs,
  checkNatural,
  cohort,
} from "./assets.mjs";
import { generateCanaries } from "./canary.mjs";

export const evaluatorRoot = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
export async function filesUnder(root) {
  const files = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    if (e.isDirectory())
      files.push(...(await filesUnder(resolve(root, e.name))));
    else if (e.isFile()) files.push(resolve(root, e.name));
  }
  return files.sort();
}
export async function fingerprintFiles(root) {
  const files = await filesUnder(
    resolve(root, "apps/cuelayer-v2/tests/evaluation"),
  );
  files.push(resolve(root, "apps/cuelayer-v2/scripts/evaluate-frontier.mjs"));
  return Object.fromEntries(
    await Promise.all(
      files.map(async (path) => [
        relative(root, path),
        sha256(await readFile(path)),
      ]),
    ),
  );
}
export async function prepare({ productRoot, out, development = false }) {
  const provenance = new Provenance(productRoot, evaluatorRoot, {
      allowDirtyEvaluator: development,
    }),
    product = await loadProduct(provenance);
  const scenarios = await loadScenarios();
  await verifyLegacyInputs(scenarios, productRoot);
  const natural = checkNatural(
    scenarios.find((s) => s.scenario_id === "natural-semantic-load"),
  );
  await mkdir(out, { recursive: false });
  const snapshots = await generateCanaries(product, resolve(out, "canaries"));
  if (
    snapshots.some(
      (s) => s.fixture_acceptance_error || s.projection.violations.length,
    )
  )
    throw Error("canary-production-generation-failed");
  const scriptHashes = await fingerprintFiles(evaluatorRoot);
  const payloads = [
    snapshots.find((s) => s.task.lane === "Live").payload,
    snapshots.find((s) => s.task.lane === "Stage").payload,
  ];
  const manifest = {
    identity: "gate3b-real-model-text-pipeline-1",
    run_id: out.split("/").at(-1),
    started_at: new Date().toISOString(),
    scope: "3b-0 only; no paid authorization",
    development,
    paid_enabled: false,
    code_sha: PRODUCT_SHA,
    evaluator_sha: git(evaluatorRoot, "rev-parse", "HEAD"),
    product_checkout: provenance.product,
    evaluator_checkout: provenance.evaluator,
    clean_worktree_assertion: {
      product: true,
      evaluator: provenance.evaluatorClean,
    },
    eval_script_sha:
      scriptHashes["apps/cuelayer-v2/scripts/evaluate-frontier.mjs"],
    evaluator_files: scriptHashes,
    forwarder_sha256:
      scriptHashes["apps/cuelayer-v2/tests/evaluation/browser.mjs"],
    production_forwarder_sha256: sha256(
      await readFile(resolve(productRoot, "apps/cuelayer-v2/server/plugin.ts")),
    ),
    system_prompt_sha256: payloads.map((p) => sha256(p.input[0])),
    schema_sha256: payloads.map((p) => sha256(p.text.format.schema)),
    scenario_schema_sha256: sha256(z.toJSONSchema(scenarioSchema)),
    oracle_sha256: sha256({ scenarios, canaries: await loadCanaryContracts() }),
    input_manifest: scenarios.map((s) => ({
      scenario_id: s.scenario_id,
      version: s.version,
      input_sha256: sha256(s.transcript_events),
      contract_sha256: sha256(s),
    })),
    canary_manifest: snapshots.map((s) => ({
      snapshot_id: s.snapshot_id,
      payload_sha256: s.payload_sha256,
      artifact_sha256: sha256(s),
    })),
    sdk_version: provenance
      .snapshot()
      .dependencies.find((d) => d.name === "openai")?.version,
    provider_profile: product.provider.modelProfile,
    profile,
    model_requested: profile.model_requested,
    reasoning_effort: profile.reasoning_effort,
    max_output_tokens: profile.max_output_tokens,
    scheduler_config: {
      coalesceMs: 250,
      maxWaitMs: 750,
      sourceChars: 2400,
      maxRequestBytes: 28000,
    },
    host_deadline_ms: 8000,
    provider_deadline_ms: 6000,
    runtime_identity: provenance.snapshot(),
    natural_load: natural,
    cohort: cohort(scenarios),
    stop_rule: {
      next_phase_requires: "all required PASS, no pending adjudication",
      hard_semantic_fail:
        "stop all subsequent paid calls; unstarted scheduled runs NOT_RUN",
      reruns: "forbidden",
      oracle_edits: "new evaluator SHA and new cohort only",
    },
    readiness_rule: profile.readiness_rule,
    dependency_modes: {
      preflight: "STUB",
      replay: "RECORDED",
      paid: "LIVE (not enabled)",
    },
    history: {
      "Gate 3a": "FAILED at 727accf; original evidence preserved",
      "Gate 3b": "NOT_RUN",
    },
  };
  await exclusive(resolve(out, "manifest.json"), manifest);
  await exclusive(resolve(out, "manifest-seal.json"), {
    sha256: sha256(manifest),
  });
  return { manifest, manifest_sha256: sha256(manifest), provenance, product };
}
export async function verify(path) {
  const manifest = await readJSON(path);
  const seal = await readJSON(resolve(path, "..", "manifest-seal.json"));
  if (seal.sha256 !== sha256(manifest)) throw Error("manifest-drift");
  if (
    manifest.identity !== "gate3b-real-model-text-pipeline-1" ||
    manifest.code_sha !== PRODUCT_SHA ||
    manifest.paid_enabled !== false
  )
    throw Error("manifest-contract-drift");
  const p = new Provenance(
    manifest.product_checkout,
    manifest.evaluator_checkout,
    { allowDirtyEvaluator: manifest.development },
  );
  if (git(p.evaluator, "rev-parse", "HEAD") !== manifest.evaluator_sha)
    throw Error("evaluator-sha-drift");
  if (
    sha256(await fingerprintFiles(p.evaluator)) !==
    sha256(manifest.evaluator_files)
  )
    throw Error("evaluator-file-drift");
  const scenarios = await loadScenarios();
  if (
    sha256({ scenarios, canaries: await loadCanaryContracts() }) !==
      manifest.oracle_sha256 ||
    sha256(profile) !== sha256(manifest.profile)
  )
    throw Error("oracle-or-profile-drift");
  for (const c of manifest.canary_manifest) {
    const snapshot = await readJSON(
      resolve(path, "..", "canaries", c.snapshot_id + ".json"),
    );
    if (
      sha256(snapshot) !== c.artifact_sha256 ||
      sha256(snapshot.payload) !== c.payload_sha256
    )
      throw Error("canary-snapshot-drift");
  }
  // Verify every inventoried source and locked dependency identity before replay/assessment.
  for (const module of manifest.runtime_identity.modules.filter(
    (m) => m.relative_path,
  ))
    p.verifyFile(resolve(p.product, module.relative_path));
  for (const dep of manifest.runtime_identity.dependencies)
    if (sha256(await readFile(dep.path)) !== dep.package_sha256)
      throw Error("dependency-identity-drift");
  p.verifyRecorded(manifest.runtime_identity);
  const product = await loadProduct(p);
  return {
    manifest,
    manifest_sha256: sha256(manifest),
    provenance: p,
    product,
  };
}
