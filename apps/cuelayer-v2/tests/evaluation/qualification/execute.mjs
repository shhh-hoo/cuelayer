import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { exclusive, readJSON, sha256 } from "../evidence.mjs";
import { runCaptured } from "../execute-canary.mjs";
import { verifyQualification } from "./manifest.mjs";
import { createQualificationScope } from "./guard.mjs";
import {
  buildCandidatePayload,
  providerResponseForCandidate,
  settleCandidateAttempt,
} from "./provider.mjs";

import { summarizeQualification } from "./report.mjs";
export { summarizeQualification } from "./report.mjs";
import { exportReviewPacket, importAdjudication } from "./adjudication.mjs";

function assessMicro(_product, _scenario, recorded, parser) {
  return {
    results: [
      {
        expectation_id: "frozen-semantic-oracle",
        owner_layer: "D",
        required: true,
        status: parser?.success ? null : "NOT_EXERCISED",
        reason: parser?.success
          ? "frozen-oracle-adjudication-required"
          : "semantic-answer-unavailable",
      },
    ],
    hard_fail: false,
    adjudication_status: parser?.success
      ? "ADJUDICATION_REQUIRED"
      : "NOT_REQUIRED",
    first_violated_boundary: null,
    oracle: recorded.oracle,
  };
}
export async function runQualification(
  verified,
  approval,
  transport,
  apiKeys,
  { mode = "LIVE" } = {},
) {
  const { manifest, product, snapshots } = verified;
  const scope = createQualificationScope(manifest, approval, apiKeys);
  const out = resolve(verified.out, "execution");
  await mkdir(out, { recursive: false });
  await exclusive(resolve(out, "execution-start.json"), {
    manifest_sha256: sha256(manifest),
    approval,
    approval_sha256: sha256(approval),
    dependency_mode: mode,
    started_at: new Date().toISOString(),
  });
  await exclusive(
    resolve(out, "planned-trials.json"),
    manifest.trials.map((t) => ({ ...t, status: "NOT_RUN" })),
  );
  const rows = [];
  let stop = null;
  for (const trial of manifest.trials) {
    if (stop) {
      rows.push({
        ...trial,
        status: "NOT_RUN",
        reason: stop,
        provider_attempt_count: 0,
        real_provider_attempt_count: 0,
      });
      continue;
    }
    const candidate = manifest.candidates.find(
        (c) => c.candidate_id === trial.candidate_id,
      ),
      original = snapshots.find((s) => s.snapshot_id === trial.snapshot_id);
    const snapshot = {
      ...original,
      snapshot_id: trial.trial_id,
      payload: buildCandidatePayload(original.payload, candidate),
      oracle_reference: { scenario_id: original.snapshot_id },
    };
    const runtime = {
      ...manifest,
      profile: {
        model_requested: candidate.model,
        provider_deadline_ms: manifest.observation_profile.provider_deadline_ms,
        host_deadline_ms: manifest.observation_profile.host_deadline_ms,
        ...Object.fromEntries(
          [
            "transport_retries",
            "retry_min_ms",
            "retry_factor",
            "sdk_retries",
          ].map((k) => [k, manifest.runtime_reference[k]]),
        ),
      },
      actual_model_allowlist: [candidate.model],
    };
    try {
      const result = await runCaptured(
        { ...verified, manifest: runtime, out, scenarios: [] },
        snapshot,
        scope,
        transport,
        apiKeys.openai,
        mode,
        exclusive,
        {
          reserveAttempt: (id, url, method, body) =>
            scope.reserve(id, url, method, body),
          providerResponse: (capture, options) =>
            providerResponseForCandidate(snapshot.payload, candidate, {
              ...options,
              product,
              capture,
            }),
          assess: assessMicro,
          settleAttempt: settleCandidateAttempt,
        },
      );
      rows.push({
        ...result,
        ...(result.provider_attempt_count === 0
          ? {
              status: "NOT_RUN",
              execution_status: result.status,
              reason:
                result.operational?.reason ??
                result.host_error ??
                "no-provider-dispatch",
            }
          : {}),
        trial_id: trial.trial_id,
        case_id: trial.snapshot_id,
        candidate_id: trial.candidate_id,
        repetition: trial.repetition,
      });
      if (
        result.operational?.boundary === "execution-policy" ||
        result.operational?.boundary === "provider-identity" ||
        result.attempts.some(
          (a) =>
            [401, 403].includes(a.http_status) ||
            a.provider_error?.code === "insufficient_quota",
        )
      )
        stop = result.operational?.reason ?? "provider-account-unavailable";
    } catch (error) {
      const attempts = scope.discipline.budget.calls.filter(
        (c) => c.run_id === trial.trial_id,
      );
      rows.push({
        ...trial,
        status: attempts.length ? "INVALID" : "NOT_RUN",
        reason: error.message,
        budget: attempts,
        attempt_telemetry_missing: true,
        provider_attempt_count: attempts.length,
        real_provider_attempt_count: mode === "LIVE" ? attempts.length : 0,
        semantic_score_available: false,
      });
      stop = error.message;
    }
  }
  const packet = exportReviewPacket(verified, rows);
  await exclusive(resolve(out, "review-packet.json"), packet);
  const assessed = importAdjudication(verified, rows, {
    identity: "cuelayer-v2-semantic-adjudication-1",
    manifest_sha256: sha256(manifest),
    oracle_sha256: manifest.corpus.oracle_sha256,
    adjudicator: "mechanical-only-no-semantic-review",
    reviews: [],
  });
  const summary = summarizeQualification(manifest, assessed);
  const results = {
    identity: "cuelayer-v2-semantic-qualification-results-1",
    manifest_sha256: sha256(manifest),
    rows,
    assessment_rows: assessed,
    budget: scope.discipline.budget.calls,
    summary,
  };
  await exclusive(resolve(out, "qualification-results.json"), results);
  await exclusive(resolve(out, "qualification-results-seal.json"), {
    object_sha256: sha256(results),
  });
  return summary;
}
export async function executeQualification(manifestPath, approvalPath) {
  const verified = await verifyQualification(manifestPath),
    approval = await readJSON(approvalPath);
  if (
    process.env.OPENAI_BASE_URL &&
    process.env.OPENAI_BASE_URL !== "https://api.openai.com/v1"
  )
    throw Error("qualification-provider-origin-override");
  return runQualification(
    verified,
    approval,
    globalThis.fetch.bind(globalThis),
    { openai: process.env.OPENAI_API_KEY },
  );
}
