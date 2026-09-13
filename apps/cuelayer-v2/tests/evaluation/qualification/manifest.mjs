import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exclusive, readJSON, sha256 } from "../evidence.mjs";
import { evaluatorRoot, fingerprintFiles } from "../manifest.mjs";
import { Provenance, git } from "../provenance.mjs";
import { loadSharedExecutionProduct } from "../shared-execution-manifest.mjs";
import { loadMicroCorpus, corpusIdentity } from "./contract.mjs";
import { generateMicroSnapshots } from "./capture.mjs";
import {
  buildCandidatePayload,
  validateEligibleCandidate,
} from "./provider.mjs";
import {
  QUALIFICATION_IDENTITY,
  ELIGIBLE_QUALIFICATION_IDENTITY,
} from "./guard.mjs";
import { qualificationInputBound } from "./quota.mjs";

const same = (a, b) => sha256(a) === sha256(b);
export const ELIGIBLE_PROPOSAL_IDENTITY =
  "cuelayer-v2-eligible-model-screening-proposal-1";
export async function loadCandidateProposal(path) {
  return readJSON(
    path ?? new URL("./candidate-proposal.json", import.meta.url),
  );
}
function eligible(manifest) {
  return manifest.identity === ELIGIBLE_QUALIFICATION_IDENTITY;
}
function selectedSnapshots(proposal, generated) {
  if (proposal.identity !== ELIGIBLE_PROPOSAL_IDENTITY) return generated;
  const ids = proposal.selected_case_ids;
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
    throw Error("qualification-selected-case-policy");
  return ids.map((id) => {
    const snapshot = generated.find((s) => s.snapshot_id === id);
    if (!snapshot) throw Error("qualification-unknown-selected-case:" + id);
    return snapshot;
  });
}
async function validateProductSnapshot(product, corpus, s) {
  const specification = corpus.pairs
    .flatMap((p) => p.cases)
    .find((c) => c.case_id === s.snapshot_id);
  if (
    !specification ||
    sha256(specification) !== s.specification_sha256 ||
    !same(specification.oracle, s.oracle)
  )
    throw Error("qualification-snapshot-oracle-drift");
  let replay = product.contract.emptyReplay();
  for (const event of s.generation.precondition_events)
    replay = product.contract.fold(replay, event);
  if (
    !same(replay, s.prestate) ||
    !same(product.execution.capturedRequest(s.task).request, s.request) ||
    !same(await product.provider.liveRequest(s.request), s.payload)
  )
    throw Error("qualification-product-binding-drift");
}
async function validateImportedSnapshots(product, corpus, snapshots) {
  // Only the nonce is copied into the independent request for comparison.
  // Original artifact and count bytes remain untouched. Receipt times belong
  // to the original capture clock; all other evidence fields must match.
  const references = new Map(
    (await generateMicroSnapshots(product, corpus)).map((s) => [
      s.snapshot_id,
      s,
    ]),
  );
  const evidenceContent = (evidence) =>
    evidence.map(({ receivedAt, ...content }) => content);
  for (const s of snapshots) {
    const expected = references.get(s.snapshot_id);
    const scope = s.request.scope;
    const namespace = s.task.capture?.namespace ?? s.task.review?.namespace;
    if (
      !expected ||
      typeof scope !== "string" ||
      !scope ||
      scope !== namespace ||
      s.task.lane !== expected.task.lane ||
      s.task.sessionId !== expected.task.sessionId ||
      !same(s.request, { ...expected.request, scope }) ||
      !same(s.prestate.state, expected.prestate.state) ||
      !same(s.task.state, expected.task.state) ||
      !same(
        evidenceContent(s.prestate.evidence),
        evidenceContent(expected.prestate.evidence),
      ) ||
      !same(
        evidenceContent(s.task.evidence),
        evidenceContent(expected.task.evidence),
      )
    )
      throw Error("qualification-imported-corpus-capture-drift");
  }
}
function trialGrid(manifest, snapshots) {
  const trials = [],
    candidates = manifest.candidates;
  for (let repetition = 1; repetition <= manifest.repetitions; repetition++)
    for (const [index, s] of snapshots.entries())
      for (let slot = 0; slot < candidates.length; slot++) {
        const c =
          candidates[(slot + index + repetition - 1) % candidates.length];
        const payload = buildCandidatePayload(s.payload, c);
        trials.push({
          trial_id: `${s.snapshot_id}--${c.candidate_id}--${repetition}`,
          snapshot_id: s.snapshot_id,
          candidate_id: c.candidate_id,
          repetition,
          lane: s.task.lane,
          schema_sha256: sha256(s.payload.text.format.schema),
          provider_url: "https://api.openai.com/v1/responses",
          payload_sha256: sha256(JSON.stringify(payload)),
          ...(eligible(manifest)
            ? qualificationInputBound({
                payload,
                candidate: c,
                proposal: manifest.reviewed_proposal,
                inputTokenCounts: manifest.input_token_counts,
              })
            : { input_tokens_upper_bound: c.context_window_tokens }),
        });
      }
  return trials;
}
function validateEligibleGrid(manifest, snapshots) {
  const proposal = manifest.reviewed_proposal;
  if (
    !proposal ||
    proposal.identity !== ELIGIBLE_PROPOSAL_IDENTITY ||
    manifest.proposal_sha256 !== sha256(proposal) ||
    manifest.paid_enabled !== false ||
    proposal.authorization_required !== true ||
    !Number.isSafeInteger(manifest.repetitions) ||
    manifest.repetitions < 1 ||
    !manifest.candidates?.length ||
    manifest.candidates.length > 17 ||
    new Set(manifest.candidates.map((c) => c.candidate_id)).size !==
      manifest.candidates.length ||
    new Set(manifest.candidates.map((c) => c.model)).size !==
      manifest.candidates.length
  )
    throw Error("qualification-screening-policy-drift");
  for (const candidate of manifest.candidates)
    validateEligibleCandidate(candidate);
  for (const [key, value] of Object.entries(proposal))
    if (key !== "identity" && !same(manifest[key], value))
      throw Error("qualification-proposal-field-drift:" + key);
  if (
    !same(manifest.execution_profile, {
      transport_retries: 0,
      retry_min_ms: 20,
      retry_factor: 2,
      sdk_retries: 0,
    }) ||
    manifest.observation_profile.provider_deadline_ms !== 30000 ||
    manifest.observation_profile.host_deadline_ms !== 35000 ||
    manifest.observation_profile.concurrency !== 1
  )
    throw Error("qualification-screening-execution-drift");
  if (
    !same(
      snapshots.map((s) => s.snapshot_id),
      manifest.selected_case_ids,
    ) ||
    !Array.isArray(manifest.selected_case_ids) ||
    new Set(manifest.selected_case_ids).size !==
      manifest.selected_case_ids.length
  )
    throw Error("qualification-snapshot-grid");
  const expected = trialGrid(manifest, snapshots);
  if (
    !same(manifest.trials, expected) ||
    expected.length !== manifest.proposed_limits.max_trials ||
    manifest.proposed_limits.max_provider_attempts !== expected.length
  )
    throw Error("qualification-trial-grid-drift");
  return expected;
}
export function validateQualificationGrid(manifest, snapshots) {
  if (eligible(manifest)) return validateEligibleGrid(manifest, snapshots);
  const candidates = manifest.candidates,
    limits = manifest.proposed_limits;
  if (
    manifest.identity !== QUALIFICATION_IDENTITY ||
    manifest.paid_enabled !== false ||
    manifest.repetitions !== 3 ||
    candidates.length !== 4 ||
    new Set(candidates.map((c) => c.candidate_id)).size !== 4
  )
    throw Error("qualification-policy-drift");
  const required = [
    ["astra-medium", "gpt-6-astra", "medium"],
    ["astra-low", "gpt-6-astra", "low"],
    ["sol-none", "gpt-5.6-sol", "none"],
    ["luna-none", "gpt-5.6-luna", "none"],
  ];
  if (
    !same(
      candidates.map((c) => [
        c.candidate_id,
        c.model,
        c.configuration.reasoning.effort,
      ]),
      required,
    )
  )
    throw Error("qualification-candidate-drift");
  if (
    !same(manifest.runtime_reference, {
      provider_deadline_ms: 6000,
      host_deadline_ms: 8000,
      transport_retries: 2,
      retry_min_ms: 20,
      retry_factor: 2,
      sdk_retries: 0,
    }) ||
    manifest.observation_profile.provider_deadline_ms !== 30000 ||
    manifest.observation_profile.host_deadline_ms !== 35000 ||
    manifest.observation_profile.concurrency !== 1
  )
    throw Error("qualification-deadline-drift");
  if (
    snapshots.length !== 26 ||
    new Set(snapshots.map((s) => s.snapshot_id)).size !== 26
  )
    throw Error("qualification-snapshot-grid");
  const expected = trialGrid(manifest, snapshots);
  if (
    !same(manifest.trials, expected) ||
    expected.length !== limits.max_trials ||
    limits.max_provider_attempts !== expected.length * 3
  )
    throw Error("qualification-trial-grid-drift");
  return expected;
}
export async function prepareQualification({
  productRoot,
  productSha,
  out,
  availability,
  proposalPath,
  inputTokenCounts,
  inputSnapshots,
  development = false,
}) {
  if (!/^[a-f0-9]{40}$/.test(productSha ?? ""))
    throw Error("explicit-full-product-sha-required");
  const provenance = new Provenance(productRoot, evaluatorRoot, {
    productSha,
    allowDirtyEvaluator: development,
  });
  const product = await loadSharedExecutionProduct(provenance),
    corpus = await loadMicroCorpus(),
    proposal = await loadCandidateProposal(proposalPath);
  const screening = proposal.identity === ELIGIBLE_PROPOSAL_IDENTITY;
  if (!screening && (proposalPath || inputTokenCounts || inputSnapshots))
    throw Error("qualification-custom-proposal-identity");
  if (
    !development &&
    (corpus.review_status !== "REVIEWED" ||
      proposal.review_status !== "REVIEWED")
  )
    throw Error("qualification-review-required");
  const available = availability ?? [];
  if (!development && available.some((a) => a.test_only === true))
    throw Error("qualification-test-metadata-not-freezable");
  if (
    screening &&
    !development &&
    (inputTokenCounts ?? []).some((r) => r.test_only === true)
  )
    throw Error("qualification-test-counts-not-freezable");
  for (const model of new Set(proposal.candidates.map((c) => c.model)))
    if (
      !available.some(
        (a) =>
          a.requested === model &&
          a.status === 200 &&
          a.returned_model === model,
      )
    )
      throw Error("qualification-model-metadata-required:" + model);
  if (screening && !Array.isArray(inputSnapshots))
    throw Error("qualification-frozen-snapshots-required");
  const generated = selectedSnapshots(
    proposal,
    screening ? inputSnapshots : await generateMicroSnapshots(product, corpus),
  );
  if (screening) {
    if (
      inputSnapshots.length !== generated.length ||
      new Set(inputSnapshots.map((s) => s.snapshot_id)).size !==
        generated.length
    )
      throw Error("qualification-snapshot-grid");
    for (const snapshot of generated)
      await validateProductSnapshot(product, corpus, snapshot);
    await validateImportedSnapshots(product, corpus, generated);
  }
  await mkdir(out, { recursive: false });
  await mkdir(resolve(out, "snapshots"));
  let proposalFile;
  if (screening) {
    const bytes = await readFile(proposalPath);
    if (!same(JSON.parse(bytes), proposal))
      throw Error("qualification-proposal-read-drift");
    const path = resolve(out, "qualification-proposal.json");
    await writeFile(path, bytes, { flag: "wx" });
    proposalFile = { path, file_sha256: sha256(bytes) };
  }
  const files = [];
  for (const snapshot of generated) {
    const path = resolve(out, "snapshots", snapshot.snapshot_id + ".json");
    await exclusive(path, snapshot);
    files.push({
      snapshot_id: snapshot.snapshot_id,
      path,
      file_sha256: sha256(await readFile(path)),
      object_sha256: sha256(snapshot),
    });
  }
  const createdAt = new Date();
  const manifest = {
    ...proposal,
    identity: screening
      ? ELIGIBLE_QUALIFICATION_IDENTITY
      : QUALIFICATION_IDENTITY,
    freeze_status: development ? "DEVELOPMENT" : "FROZEN",
    paid_enabled: false,
    execution_directory: resolve(out),
    created_at: createdAt.toISOString(),
    expires_at: new Date(+createdAt + 24 * 60 * 60 * 1000).toISOString(),
    product_sha: productSha,
    product_checkout: provenance.product,
    evaluator_sha: git(evaluatorRoot, "rev-parse", "HEAD"),
    evaluator_checkout: evaluatorRoot,
    evaluator_files: await fingerprintFiles(evaluatorRoot),
    corpus: corpusIdentity(corpus),
    proposal_sha256: sha256(proposal),
    ...(screening
      ? {
          reviewed_proposal: proposal,
          proposal_file: proposalFile,
          input_token_counts: inputTokenCounts ?? [],
        }
      : {}),
    availability: available,
    availability_scope:
      "Read-only model metadata confirms listed account access. It does not prove generation success or returned generation model identity; exact model IDs remain required without learned aliases.",
    snapshots: files,
    trials: [],
    runtime_identity: provenance.snapshot(),
  };
  manifest.trials = trialGrid(manifest, generated);
  validateQualificationGrid(manifest, generated);
  await exclusive(resolve(out, "qualification-manifest.json"), manifest);
  await exclusive(resolve(out, "qualification-manifest-seal.json"), {
    object_sha256: sha256(manifest),
    file_sha256: sha256(
      await readFile(resolve(out, "qualification-manifest.json")),
    ),
  });
  return { manifest, manifest_sha256: sha256(manifest) };
}
export async function verifyQualification(
  path,
  { allowDevelopment = false, allowExpired = false, proposalPath } = {},
) {
  const manifest = await readJSON(path),
    seal = await readJSON(resolve(path, "../qualification-manifest-seal.json"));
  if (
    seal.object_sha256 !== sha256(manifest) ||
    seal.file_sha256 !== sha256(await readFile(path)) ||
    manifest.execution_directory !== resolve(path, "..") ||
    manifest.evaluator_checkout !== evaluatorRoot ||
    manifest.evaluator_sha !== git(evaluatorRoot, "rev-parse", "HEAD") ||
    !same(manifest.evaluator_files, await fingerprintFiles(evaluatorRoot)) ||
    (!allowDevelopment && manifest.freeze_status !== "FROZEN")
  )
    throw Error("qualification-manifest-drift");
  if (
    !Number.isFinite(Date.parse(manifest.expires_at)) ||
    (!allowExpired && Date.now() > Date.parse(manifest.expires_at))
  )
    throw Error("qualification-manifest-expired");
  const corpus = await loadMicroCorpus(),
    proposal = eligible(manifest)
      ? manifest.reviewed_proposal
      : await loadCandidateProposal();
  if (
    proposalPath &&
    !same(await loadCandidateProposal(proposalPath), proposal)
  )
    throw Error("qualification-supplied-proposal-mismatch");
  if (eligible(manifest)) {
    const file = manifest.proposal_file;
    if (
      file?.path !==
      resolve(manifest.execution_directory, "qualification-proposal.json")
    )
      throw Error("qualification-proposal-path-drift");
    const bytes = await readFile(file.path);
    if (
      sha256(bytes) !== file.file_sha256 ||
      !same(JSON.parse(bytes), proposal) ||
      (!allowDevelopment &&
        (proposal.review_status !== "REVIEWED" ||
          manifest.input_token_counts?.some((r) => r.test_only === true)))
    )
      throw Error("qualification-corpus-or-proposal-drift");
  }
  if (
    !same(manifest.corpus, corpusIdentity(corpus)) ||
    manifest.proposal_sha256 !== sha256(proposal)
  )
    throw Error("qualification-corpus-or-proposal-drift");
  for (const key of [
    "candidates",
    "repetitions",
    "order",
    "runtime_reference",
    "observation_profile",
    "proposed_limits",
    "common_protocol",
    "required_metrics",
    "selection_rule",
  ])
    if (!same(manifest[key], proposal[key]))
      throw Error("qualification-proposal-field-drift:" + key);
  const provenance = new Provenance(manifest.product_checkout, evaluatorRoot, {
    productSha: manifest.product_sha,
    allowDirtyEvaluator: allowDevelopment,
  });
  const product = await loadSharedExecutionProduct(provenance),
    snapshots = [];
  for (const file of manifest.snapshots) {
    if (
      file.path !==
      resolve(
        manifest.execution_directory,
        "snapshots",
        file.snapshot_id + ".json",
      )
    )
      throw Error("qualification-snapshot-path-drift");
    const bytes = await readFile(file.path),
      s = JSON.parse(bytes);
    if (
      sha256(bytes) !== file.file_sha256 ||
      sha256(s) !== file.object_sha256 ||
      s.snapshot_id !== file.snapshot_id
    )
      throw Error("qualification-snapshot-drift");
    await validateProductSnapshot(product, corpus, s);
    snapshots.push(s);
  }
  if (eligible(manifest))
    await validateImportedSnapshots(product, corpus, snapshots);
  validateQualificationGrid(manifest, snapshots);
  provenance.verifyRecorded(manifest.runtime_identity);
  return {
    manifest,
    manifest_sha256: sha256(manifest),
    product,
    provenance,
    corpus,
    snapshots,
    out: manifest.execution_directory,
  };
}
