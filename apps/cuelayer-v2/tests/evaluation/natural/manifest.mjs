import { mkdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { exclusive, readJSON, sha256 } from "../evidence.mjs";
import { evaluatorRoot, fingerprintFiles } from "../manifest.mjs";
import { Provenance, git } from "../provenance.mjs";
import { loadSharedExecutionProduct } from "../shared-execution-manifest.mjs";
import { loadNaturalLesson } from "./lesson.mjs";
import { NATURAL_IDENTITY, payloadProfile } from "./guard.mjs";
import { verifyNaturalAssets } from "./assets.mjs";

const same = (a, b) => sha256(a) === sha256(b);
export const NATURAL_VERSIONS = {
  LIVE: "v2-live-request-5",
  STAGE: "v2-stage-request-6",
};
export async function naturalProductPolicy(product, provenance) {
  const { latencyPolicy } = await import(
    pathToFileURL(
      resolve(provenance.product, "apps/cuelayer-v2/src/latency-policy.ts"),
    ).href
  );
  // These schema-only envelopes contain no captured source and are never executed.
  // Future payloads come exclusively from naturally scheduled Interpreter tasks.
  const profiles = {};
  for (const [lane, version] of Object.entries(NATURAL_VERSIONS))
    profiles[lane] = payloadProfile(
      await product.provider.liveRequest({ version }),
    );
  return {
    provider_profile: product.provider.modelProfile,
    latency_policy: latencyPolicy,
    profiles,
    versions: NATURAL_VERSIONS,
  };
}

export async function prepareNatural({
  productRoot,
  productSha,
  out,
  assets,
  development = false,
}) {
  if (!/^[a-f0-9]{40}$/.test(productSha ?? ""))
    throw Error("explicit-full-product-sha-required");
  const provenance = new Provenance(productRoot, evaluatorRoot, {
    productSha,
    allowDirtyEvaluator: development,
  });
  const product = await loadSharedExecutionProduct(provenance);
  const lesson = await loadNaturalLesson();
  if (!development && lesson.review_status !== "REVIEWED")
    throw Error("natural-lesson-review-required");
  const policy = await naturalProductPolicy(product, provenance);
  const renderer = assets ? await verifyNaturalAssets(assets) : null;
  if (!development && !renderer)
    throw Error("natural-frozen-renderer-assets-required");
  const proposal = await readJSON(
    new URL("../qualification/candidate-proposal.json", import.meta.url),
  );
  const candidate = proposal.candidates.find(
    (c) => c.candidate_id === "astra-medium",
  );
  if (
    policy.provider_profile.model !== candidate.model ||
    policy.provider_profile.reasoning !== "medium" ||
    policy.provider_profile.stageReasoning !== "medium" ||
    policy.provider_profile.serviceTier !== "default" ||
    policy.latency_policy.observationOnly
  )
    throw Error("natural-selected-product-policy-required");
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out, { recursive: false });
  const created = new Date();
  const manifest = {
    identity: NATURAL_IDENTITY,
    run_id: resolve(out).split("/").at(-1),
    freeze_status: development ? "DEVELOPMENT" : "FROZEN",
    paid_enabled: false,
    authorization_required: true,
    execution_directory: resolve(out),
    created_at: created.toISOString(),
    expires_at: new Date(+created + 86400000).toISOString(),
    product_sha: productSha,
    product_checkout: provenance.product,
    evaluator_sha: git(evaluatorRoot, "rev-parse", "HEAD"),
    evaluator_checkout: evaluatorRoot,
    evaluator_files: await fingerprintFiles(evaluatorRoot),
    lesson,
    lesson_sha256: sha256(lesson),
    candidate,
    renderer_assets: renderer?.manifest ?? null,
    pricing_evidence: {
      documentation_checked_on: proposal.documentation_checked_on,
      urls: candidate.evidence_urls,
      source_proposal_sha256: sha256(proposal),
      scope:
        "Published rates frozen for a new explicit approval; no inherited paid authorization or invoice claim.",
    },
    ...policy,
    dynamic_capture_policy: {
      identity: "cuelayer-v2-natural-session-capture-1",
      max_attempts_per_task: 3,
      max_request_bytes: 28000,
      profiles: policy.profiles,
      authority:
        "Empty lesson; real Session.speech.receive final admission; Session alone schedules Live/Stage and validates/persists. Observe actual captured tasks without capture/accept/restore calls.",
      checks: [
        "all task and prestate evidence already admitted",
        "exact public capturedRequest equality",
        "exact product SDK payload equality",
        "frozen schema/system/config",
        "reservation journal before egress",
      ],
    },
    proposed_limits: {
      max_provider_attempts: 32,
      max_cost_usd: 60,
      concurrency: 2,
      max_input_tokens_per_attempt: candidate.context_window_tokens,
      max_output_tokens_per_attempt: candidate.max_output_tokens,
      max_total_input_tokens: candidate.context_window_tokens * 32,
      max_total_output_tokens: candidate.max_output_tokens * 32,
    },
    execution_policy: {
      dependency_mode: "LIVE",
      provider_url: "https://api.openai.com/v1/responses",
      browser_external_network: false,
      input_clock:
        "absolute worker deadlines; admissions never await inference",
      post_input_observation_ms: 20000,
      reload_observation_ms: 2000,
      checkpoint_acquisition_tolerance_ms: 100,
      retry:
        "Unchanged product transport retry policy; every retry counts and is retained.",
      stop: "Policy, credential, tier, missing-usage or budget failures stop new dispatch; retained reservations remain charged. All planned arrivals are recorded, including NOT_RUN.",
      completion:
        "No forced drain, capture, Stage trigger, semantic repair or lesson seal. Performance during input is reported separately from tail observation.",
      full_cohort:
        "BLOCKED until every frozen required review and invariant passes; this authorization can never execute the full cohort.",
    },
    runtime_identity: provenance.snapshot(),
  };
  await exclusive(resolve(out, "natural-manifest.json"), manifest);
  await exclusive(resolve(out, "natural-manifest-seal.json"), {
    object_sha256: sha256(manifest),
    file_sha256: sha256(await readFile(resolve(out, "natural-manifest.json"))),
  });
  return {
    manifest,
    manifest_sha256: sha256(manifest),
    product,
    provenance,
    lesson,
    out: resolve(out),
  };
}

export async function verifyNatural(
  path,
  { allowDevelopment = false, allowExpired = false } = {},
) {
  const manifest = await readJSON(path);
  const seal = await readJSON(resolve(path, "../natural-manifest-seal.json"));
  if (
    manifest.identity !== NATURAL_IDENTITY ||
    manifest.paid_enabled !== false ||
    seal.object_sha256 !== sha256(manifest) ||
    seal.file_sha256 !== sha256(await readFile(path)) ||
    manifest.execution_directory !== resolve(path, "..") ||
    manifest.evaluator_checkout !== evaluatorRoot ||
    manifest.evaluator_sha !== git(evaluatorRoot, "rev-parse", "HEAD") ||
    !same(manifest.evaluator_files, await fingerprintFiles(evaluatorRoot)) ||
    (!allowDevelopment && manifest.freeze_status !== "FROZEN")
  )
    throw Error("natural-manifest-drift");
  if (
    !Number.isFinite(Date.parse(manifest.expires_at)) ||
    (!allowExpired && Date.now() > Date.parse(manifest.expires_at))
  )
    throw Error("natural-manifest-expired");
  const provenance = new Provenance(manifest.product_checkout, evaluatorRoot, {
    productSha: manifest.product_sha,
    allowDirtyEvaluator: allowDevelopment,
  });
  const product = await loadSharedExecutionProduct(provenance),
    lesson = await loadNaturalLesson();
  const policy = await naturalProductPolicy(product, provenance);
  const proposal = await readJSON(
    new URL("../qualification/candidate-proposal.json", import.meta.url),
  );
  if (
    !same(
      manifest.candidate,
      proposal.candidates.find((c) => c.candidate_id === "astra-medium"),
    ) ||
    manifest.pricing_evidence.source_proposal_sha256 !== sha256(proposal) ||
    manifest.execution_policy.provider_url !==
      "https://api.openai.com/v1/responses" ||
    manifest.execution_policy.browser_external_network !== false ||
    manifest.execution_policy.post_input_observation_ms !== 20000 ||
    manifest.execution_policy.reload_observation_ms !== 2000 ||
    manifest.execution_policy.checkpoint_acquisition_tolerance_ms !== 100 ||
    manifest.proposed_limits.max_provider_attempts !== 32 ||
    manifest.proposed_limits.max_cost_usd !== 60 ||
    manifest.proposed_limits.concurrency !== 2
  )
    throw Error("natural-execution-policy-drift");
  if (!manifest.renderer_assets && !allowDevelopment)
    throw Error("natural-frozen-renderer-assets-required");
  if (manifest.renderer_assets)
    await verifyNaturalAssets(manifest.renderer_assets);
  for (const [key, value] of Object.entries(policy))
    if (!same(manifest[key], value))
      throw Error("natural-product-policy-drift:" + key);
  if (
    !same(manifest.lesson, lesson) ||
    manifest.lesson_sha256 !== sha256(lesson) ||
    !same(manifest.dynamic_capture_policy.profiles, policy.profiles)
  )
    throw Error("natural-lesson-or-profile-drift");
  provenance.verifyRecorded(manifest.runtime_identity);
  return {
    manifest,
    manifest_sha256: sha256(manifest),
    product,
    provenance,
    lesson,
    out: manifest.execution_directory,
  };
}
