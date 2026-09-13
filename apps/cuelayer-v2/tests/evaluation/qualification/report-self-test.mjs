import test from "node:test";
import assert from "node:assert/strict";
import { latencyStatistics, summarizeQualification } from "./report.mjs";

const manifest = {
  candidates: [
    { candidate_id: "a", model: "offline-a", configuration: {} },
    { candidate_id: "b", model: "offline-b", configuration: {} },
  ],
  trials: ["a1", "a2", "a3", "a4", "a5", "b1"].map((id) => ({
    trial_id: id,
    candidate_id: id[0],
    snapshot_id: "case-" + id,
    repetition: 1,
  })),
  runtime_reference: { provider_deadline_ms: 6000, host_deadline_ms: 8000 },
};
const phase = (phase, at, details = {}, clockId = "offline-clock") => ({
  phase,
  at,
  details,
  clockId,
});
function attempt({
  start = 0,
  duration = 100,
  complete = true,
  parsed = true,
  accepted = true,
  failure = null,
} = {}) {
  return {
    attempt_finished: true,
    provider_completed: complete,
    parser_succeeded: complete && parsed,
    host_accepted: complete && parsed && accepted,
    host_decision_persisted: complete && parsed && accepted,
    execution_failure: failure,
    latency_ms: duration + 30,
    service_tier: "default",
    phases: [
      phase("request-dispatch", start),
      phase("network-dispatch", start + 10),
      phase("first-upstream-answer-text", start + 20),
      phase("first-answer-text", start + 21),
      phase("upstream-terminal", start + duration + 10, {
        completed: complete,
      }),
      ...(complete
        ? [
            phase("parser-start", start + duration + 11),
            phase("parser-complete", start + duration + 12, {
              succeeded: parsed,
            }),
          ]
        : []),
      ...(complete && parsed
        ? [
            phase("host-validation-start", start + duration + 13),
            phase(
              accepted ? "host-accepted" : "host-rejected",
              start + duration + 20,
            ),
          ]
        : []),
      phase("attempt-finished", start + duration + 30),
    ],
    phase_latency_ms: {
      provider_first_answer_ms: 10,
      provider_completion_ms: complete ? duration : null,
    },
  };
}
function row(id, attempts, overrides = {}) {
  return {
    trial_id: id,
    candidate_id: id[0],
    case_id: "case-" + id,
    status: null,
    provider_attempt_count: attempts.length,
    real_provider_attempt_count: 0,
    attempts,
    execution_ms: attempts.reduce((n, a) => n + (a.latency_ms ?? 0), 0),
    execution_failure: null,
    host_error: null,
    ...overrides,
  };
}

test("known latency distribution uses R-7 quantiles and sample variance with explicit missing/censor counts", () => {
  const result = latencyStatistics([
    ...[100, 200, 300, 400].map((value) => ({ value })),
    { value: null, state: "CENSORED" },
    { value: null, state: "NOT_REACHED" },
    { value: NaN },
    { value: -1 },
    { value: Infinity },
  ]);
  assert.equal(result.denominator, 9);
  assert.equal(result.samples, 4);
  assert.equal(result.censored, 1);
  assert.equal(result.endpoint_not_reached, 1);
  assert.equal(result.missing_telemetry, 3);
  assert.equal(result.p50_ms, 250);
  assert.equal(result.p95_ms, 385);
  assert.equal(result.mean_ms, 250);
  assert(Math.abs(result.sample_variance_ms2 - 16666.666666666668) < 1e-8);
  assert.equal(latencyStatistics([]).p50_ms, null);
  assert.equal(latencyStatistics([{ value: 0 }]).sample_variance_ms2, null);
  assert.equal(latencyStatistics([{ value: 0 }]).p95_ms, 0);
  assert.equal("p99_ms" in result, false);
});

test("full planned grid keeps absent results and NOT_RUN rows in denominators without fabricated success", () => {
  const report = summarizeQualification(manifest, [row("a1", [attempt()])]);
  assert.equal(report.planned_trials, 6);
  assert.equal(report.trial_rows, 6);
  assert.equal(report.supplied_result_rows, 1);
  assert.equal(report.trials.filter((t) => t.status === "NOT_RUN").length, 5);
  assert.equal(report.complete_cohort, false);
  assert.equal(report.provider_invocations, 0);
  const a = report.candidates[0],
    b = report.candidates[1];
  assert.deepEqual(a.trial_rates.started, {
    numerator: 1,
    denominator: 5,
    value: 0.2,
  });
  assert.equal(a.semantics.disposition.accuracy.value, null);
  assert.equal(a.semantics.disposition.pending, 1);
  assert.equal(a.semantics.disposition.unavailable, 4);
  assert.equal(b.latency_ms.provider_complete_per_attempt.p50_ms, null);
  assert.equal(b.trial_rates.host_accepted.value, null);
});

test("failed, censored and missing attempts stay separate from observed provider completion", () => {
  const failed = attempt({
    complete: false,
    failure: { category: "transport", reason: "model-incomplete" },
  });
  failed.phase_latency_ms.provider_completion_ms = 99999;
  const timedOut = {
    attempt_finished: true,
    provider_completed: false,
    parser_succeeded: false,
    host_accepted: false,
    latency_ms: 30000,
    execution_failure: { category: "deadline", reason: "model-timeout" },
    phases: [phase("request-dispatch", 0), phase("attempt-finished", 30000)],
  };
  const report = summarizeQualification(manifest, [
    row("a1", [attempt({ duration: 7000 })]),
    row("a2", [failed]),
    row("a3", [timedOut], { execution_failure: timedOut.execution_failure }),
    row("a4", [], { provider_attempt_count: 1, execution_ms: null }),
  ]).candidates[0];
  const stats = report.latency_ms.provider_complete_per_attempt;
  assert.equal(report.attempts, 4);
  assert.equal(report.attempt_records_missing, 1);
  assert.equal(stats.samples, 1);
  assert.equal(stats.p50_ms, 7000);
  assert.equal(stats.censored, 1);
  assert.equal(stats.endpoint_not_reached, 1);
  assert.equal(stats.missing_telemetry, 1);
  assert.equal(report.runtime_reference_crossings.provider_completion.late, 1);
  assert.equal(
    report.runtime_reference_crossings.provider_completion
      .unfinished_observed_beyond_reference,
    1,
  );
  assert.equal(
    report.runtime_reference_crossings.host_acceptance
      .unfinished_observed_beyond_reference,
    1,
  );
  assert.equal(report.service_tier.missing, 2);
});

test("host latency spans retries in one clock domain and does not silently subtract remote clocks", () => {
  const first = attempt({
    duration: 50,
    complete: false,
    failure: { category: "transport", reason: "model-transient" },
  });
  const second = attempt({ start: 100, duration: 200 });
  const result = summarizeQualification(manifest, [row("a1", [first, second])])
    .candidates[0];
  assert.equal(result.latency_ms.host_accepted_from_first_request.p50_ms, 320);
  assert.equal(
    result.trial_rates.execution_or_host_failure.numerator,
    0,
    "a recovered transient failure is an attempt failure",
  );
  assert.equal(result.attempt_rates.failure.numerator, 1);
  const broken = structuredClone(second);
  broken.phases.find((p) => p.phase === "host-accepted").clockId =
    "unrelated-server-clock";
  const absent = summarizeQualification(manifest, [row("a1", [first, broken])])
    .candidates[0];
  assert.equal(absent.latency_ms.host_accepted_from_first_request.samples, 0);
  assert.equal(
    absent.latency_ms.host_accepted_from_first_request.missing_telemetry,
    1,
  );
});

test("schema failures and host rejection have different denominators and reasons", () => {
  const invalid = attempt({ parsed: false }),
    rejected = attempt({ accepted: false });
  const result = summarizeQualification(manifest, [
    row("a1", [attempt()]),
    row("a2", [invalid], {
      execution_failure: { category: "parse", reason: "model-schema-invalid" },
    }),
    row("a3", [rejected], { host_error: "fabricated-grounding" }),
  ]).candidates[0];
  assert.deepEqual(result.attempt_rates.structured_output_validity, {
    numerator: 2,
    denominator: 3,
    value: 2 / 3,
  });
  assert.deepEqual(result.attempt_rates.host_rejection, {
    numerator: 1,
    denominator: 2,
    value: 0.5,
  });
  assert.equal(result.host_rejection_reasons["fabricated-grounding"], 1);
  assert.equal(result.semantics.knowledge_mutation.accuracy.value, null);
});

test("validated semantic reviews alone determine semantic accuracy and false-terminal rates", () => {
  const reviewed = {
    disposition: "PASS",
    reference_resolution: "NOT_APPLICABLE",
    knowledge_mutation: "FAIL",
    provenance: "PASS",
    end_state: "FAIL",
    false_terminal_no_change: "FAIL",
  };
  const rows = [
    row("a1", [attempt()], {
      semantic_review_status: "VALIDATED",
      semantic_scores: reviewed,
    }),
    row("a2", [attempt()], { semantic_scores: reviewed }),
    row("a3", [attempt()], {
      semantic_review_status: "VALIDATED",
      semantic_scores: { ...reviewed, false_terminal_no_change: "PASS" },
    }),
  ];
  const report = summarizeQualification(manifest, rows).candidates[0];
  assert.equal(report.semantics.disposition.accuracy.value, 1);
  assert.equal(report.semantics.knowledge_mutation.accuracy.value, 0);
  assert.equal(report.semantics.disposition.pending, 1);
  assert.equal(report.semantics.reference_resolution.not_applicable, 2);
  assert.equal(
    report.semantics.false_terminal_no_change.false_terminal_rate.value,
    0.5,
  );
  assert.equal(report.semantic_score, null);
});

test("usage and conservative reservations retain failed trials and telemetry gaps", () => {
  const a = attempt();
  a.usage = {
    input_tokens: 100,
    output_tokens: 50,
    input_tokens_details: { cached_tokens: 20 },
    output_tokens_details: { reasoning_tokens: 12 },
  };
  const budgets = [
    {
      id: "one",
      cost: 0.2,
      reserved: 4,
      cached_input_tokens: 20,
      cache_state: "HIT",
      published_rate_estimate_usd: 0.1,
    },
    { id: "two", cost: null, reserved: 4, cache_state: "UNKNOWN" },
  ];
  const report = summarizeQualification(manifest, [
    row("a1", [a]),
    row("a2", [], { provider_attempt_count: 2, budget: budgets }),
  ]).candidates[0].usage_and_cost;
  assert.equal(report.attempts, 3);
  assert.equal(report.usage_observed_attempts, 1);
  assert.equal(report.usage_missing_attempts, 2);
  assert.equal(report.observed_input_tokens, 100);
  assert.equal(report.observed_output_tokens, 50);
  assert.equal(report.observed_reasoning_tokens, 12);
  assert.equal(report.observed_cached_input_tokens, 20);
  assert.equal(report.settled_cost_upper_bound_usd, 0.2);
  assert.equal(report.retained_reservations_usd, 4);
  assert.equal(report.total_accounted_cost_upper_bound_usd, 4.2);
  assert.equal(report.cache_hit_attempts, 1);
  assert.equal(report.cache_unknown_attempts, 2);
  assert.equal(report.missing_budget_records, 1);
  assert.equal(report.cost_coverage_complete, false);
  const recovered = summarizeQualification(manifest, [
    row("a1", [], {
      provider_attempt_count: 1,
      budget: [
        {
          cost: 0.1,
          input_tokens: 10,
          output_tokens: 2,
          cached_input_tokens: 0,
          cache_state: "MISS",
        },
      ],
    }),
  ]).candidates[0].usage_and_cost;
  assert.equal(recovered.observed_input_tokens, 10);
  assert.equal(recovered.observed_output_tokens, 2);
});

test("duplicate, foreign and mismatched trial rows fail instead of changing the cohort", () => {
  const good = row("a1", [attempt()]);
  for (const rows of [
    [good, good],
    [{ ...good, trial_id: "foreign" }],
    [{ ...good, candidate_id: "b" }],
    [{ ...good, case_id: "wrong" }],
    [{ ...good, status: "NOT_RUN" }],
  ])
    assert.throws(
      () => summarizeQualification(manifest, rows),
      /qualification-report/,
    );
});

test("first observed model/schema use follows planned order and does not claim a cold provider cache", () => {
  const m = structuredClone(manifest);
  m.trials.forEach((t) => {
    t.lane = "Live";
    t.schema_sha256 = "a".repeat(64);
  });
  const first = attempt(),
    later = attempt();
  first.actual_model = later.actual_model = "same-actual-model";
  first.usage = {
    input_tokens: 100,
    output_tokens: 10,
    input_tokens_details: { cached_tokens: 80 },
  };
  const report = summarizeQualification(m, [
    row("a2", [later]),
    row("a1", [first]),
  ]);
  assert.equal(report.trials[0].trial_order_index, 0);
  assert.equal(report.trials[0].lane, "Live");
  assert.equal(report.trials[0].schema_sha256, "a".repeat(64));
  assert.equal(
    report.schema_use.first_observed_model_schema_requests.length,
    1,
  );
  assert.equal(
    report.schema_use.first_observed_model_schema_requests[0].first_trial_id,
    "a1",
  );
  assert.equal(
    report.schema_use.first_observed_model_schema_requests[0]
      .observed_cached_input_tokens,
    80,
  );
  assert.match(
    report.schema_use.scope,
    /does not establish a globally cold cache/,
  );
  const missing = summarizeQualification(manifest, [row("a1", [attempt()])]);
  assert.equal(
    missing.schema_use.first_observed_model_schema_requests.length,
    0,
  );
  assert.equal(missing.schema_use.schema_identity_missing_attempts, 1);
  assert.equal(missing.schema_use.actual_model_missing_attempts, 1);
});
