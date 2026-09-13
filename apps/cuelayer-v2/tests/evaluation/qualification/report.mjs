import { sha256 } from "../evidence.mjs";

const number = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const rate = (numerator, denominator) => ({
  numerator,
  denominator,
  value: denominator ? numerator / denominator : null,
});
const phases = (attempt) => attempt.phases ?? [];
const hasPhase = (attempt, name) =>
  phases(attempt).some((p) => p.phase === name);
const censored = (failure) =>
  ["deadline", "cancel"].includes(failure?.category);
const histogram = (values) =>
  Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((key) => [key, values.filter((v) => v === key).length]),
  );
const elapsed = (start, end) =>
  start &&
  end &&
  typeof start.clockId === "string" &&
  start.clockId === end.clockId &&
  number(start.at) &&
  number(end.at) &&
  end.at >= start.at
    ? end.at - start.at
    : null;

// R-7 linear interpolation; variance is sample variance (n-1), not a claim
// about the population tail. Missing/failed/censored endpoints are not zeros.
export function latencyStatistics(entries) {
  const values = entries
    .filter((e) => number(e.value))
    .map((e) => e.value)
    .sort((a, b) => a - b);
  const n = values.length,
    mean = n ? values.reduce((sum, v) => sum + v, 0) / n : null;
  const quantile = (q) => {
    if (!n) return null;
    const index = (n - 1) * q,
      lo = Math.floor(index),
      hi = Math.ceil(index);
    return values[lo] + (values[hi] - values[lo]) * (index - lo);
  };
  return {
    denominator: entries.length,
    samples: n,
    missing_telemetry: entries.filter(
      (e) => !number(e.value) && !["CENSORED", "NOT_REACHED"].includes(e.state),
    ).length,
    censored: entries.filter((e) => !number(e.value) && e.state === "CENSORED")
      .length,
    endpoint_not_reached: entries.filter(
      (e) => !number(e.value) && e.state === "NOT_REACHED",
    ).length,
    min_ms: n ? values[0] : null,
    max_ms: n ? values.at(-1) : null,
    mean_ms: mean,
    p50_ms: quantile(0.5),
    p95_ms: quantile(0.95),
    sample_variance_ms2:
      n > 1
        ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1)
        : null,
    quantile_method: "R-7 linear interpolation",
  };
}

function endpoint(value, reached, finished, failure) {
  if (number(value)) return { value, state: "OBSERVED" };
  return {
    value: null,
    state: reached
      ? "MISSING"
      : censored(failure)
        ? "CENSORED"
        : finished
          ? "NOT_REACHED"
          : "MISSING",
  };
}

function normalizeTrial(trial, row) {
  const attempts = row?.attempts ?? [];
  const started = Math.max(
    count(row?.provider_attempt_count) ? row.provider_attempt_count : 0,
    attempts.length,
    row?.budget?.length ?? 0,
  );
  if (row?.status === "NOT_RUN" && started)
    throw Error("qualification-report-not-run-has-attempts");
  const records = [
    ...attempts,
    ...Array.from({ length: started - attempts.length }, () => ({
      telemetry_missing: true,
    })),
  ];
  const last = attempts.at(-1);
  const failure = row?.execution_failure ?? last?.execution_failure ?? null;
  const providerCompleted = attempts.some((a) => a.provider_completed === true);
  const parserSucceeded = attempts.some((a) => a.parser_succeeded === true);
  const parserAttempted = attempts.some(
    (a) =>
      a.parser_succeeded === true ||
      hasPhase(a, "parser-start") ||
      hasPhase(a, "parser-complete"),
  );
  const hostAccepted = attempts.some((a) => a.host_accepted === true);
  const hostPersisted = attempts.some(
    (a) => a.host_decision_persisted === true || a.host_accepted === true,
  );
  const hostRejected = attempts.some((a) => hasPhase(a, "host-rejected"));
  const timeline = attempts.flatMap(phases);
  const dispatch = timeline.find((p) => p.phase === "request-dispatch");
  const host = timeline.find((p) => p.phase === "host-accepted");
  const answer = timeline.find((p) => p.phase === "first-answer-text");
  const completion = timeline.find(
    (p) => p.phase === "upstream-terminal" && p.details?.completed === true,
  );
  const done = row != null && row.status !== "NOT_RUN";
  return {
    trial,
    row,
    records,
    started,
    status: started === 0 ? "NOT_RUN" : (row?.status ?? null),
    reason:
      row?.reason ??
      row?.host_error ??
      row?.operational?.reason ??
      (row ? null : "result-not-recorded"),
    failure,
    providerCompleted,
    parserSucceeded,
    parserAttempted,
    hostAccepted,
    hostPersisted,
    hostRejected,
    latency: {
      execution: endpoint(row?.execution_ms, done, done, failure),
      first_answer: endpoint(
        elapsed(dispatch, answer),
        Boolean(answer),
        done,
        failure,
      ),
      provider_complete: endpoint(
        providerCompleted ? elapsed(dispatch, completion) : null,
        providerCompleted,
        done,
        failure,
      ),
      host_accepted: endpoint(
        hostAccepted ? elapsed(dispatch, host) : null,
        hostAccepted,
        done,
        failure,
      ),
    },
  };
}

function attemptLatency(attempt, key, reached) {
  const value =
    key === "attempt_ms" ? attempt.latency_ms : attempt.phase_latency_ms?.[key];
  if (reached === undefined && !number(value) && !Array.isArray(attempt.phases))
    return { value: null, state: "MISSING" };
  // A stale duration cannot turn an explicitly incomplete response into a sample.
  return endpoint(
    reached === false ? null : value,
    reached === true,
    attempt.attempt_finished === true,
    attempt.execution_failure,
  );
}

function referenceCrossings(entries, threshold, unfinished) {
  const observed = entries.filter((e) => number(e.value));
  return {
    threshold_ms: threshold,
    late: observed.filter((e) => e.value > threshold).length,
    within: observed.filter((e) => e.value <= threshold).length,
    observed: observed.length,
    missing_telemetry: entries.filter(
      (e) => !number(e.value) && e.state === "MISSING",
    ).length,
    censored: entries.filter((e) => !number(e.value) && e.state === "CENSORED")
      .length,
    endpoint_not_reached: entries.filter(
      (e) => !number(e.value) && e.state === "NOT_REACHED",
    ).length,
    unfinished_observed_beyond_reference: unfinished.filter(
      (value) => number(value) && value > threshold,
    ).length,
  };
}

const semanticMetrics = [
  "disposition",
  "reference_resolution",
  "knowledge_mutation",
  "provenance",
  "end_state",
  "false_terminal_no_change",
];
function semanticSummary(trials) {
  return Object.fromEntries(
    semanticMetrics.map((metric) => {
      const values = trials.map((t) => {
        if (!t.started) return "UNAVAILABLE";
        if (t.row?.semantic_review_status !== "VALIDATED") return "PENDING";
        const value = t.row.semantic_scores?.[metric];
        return [
          "PASS",
          "FAIL",
          "NOT_APPLICABLE",
          "UNAVAILABLE",
          "PENDING",
        ].includes(value)
          ? value
          : "PENDING";
      });
      const passed = values.filter((v) => v === "PASS").length,
        failed = values.filter((v) => v === "FAIL").length;
      return [
        metric,
        {
          planned: values.length,
          reviewed_applicable: passed + failed,
          passed,
          failed,
          pending: values.filter((v) => v === "PENDING").length,
          unavailable: values.filter((v) => v === "UNAVAILABLE").length,
          not_applicable: values.filter((v) => v === "NOT_APPLICABLE").length,
          ...(metric === "false_terminal_no_change"
            ? { false_terminal_rate: rate(failed, passed + failed) }
            : { accuracy: rate(passed, passed + failed) }),
        },
      ];
    }),
  );
}

function usageSummary(trials) {
  const budgets = trials.flatMap((t) => t.row?.budget ?? []);
  const allAttempts = trials.flatMap((t) => t.records);
  const usageRows = trials.flatMap((t) =>
    t.records.map((attempt, index) => {
      if (
        number(attempt.usage?.input_tokens) &&
        number(attempt.usage?.output_tokens)
      )
        return attempt.usage;
      const budget =
        (t.row?.budget ?? []).find((b) => b.id === attempt.reservation) ??
        t.row?.budget?.[index];
      return budget
        ? {
            input_tokens: budget.input_tokens,
            output_tokens: budget.output_tokens,
            input_tokens_details: { cached_tokens: budget.cached_input_tokens },
          }
        : null;
    }),
  );
  const uses = usageRows.filter(
    (usage) => number(usage?.input_tokens) && number(usage?.output_tokens),
  );
  const sum = (values) => values.reduce((n, v) => n + v, 0);
  const missingBudgets = Math.max(0, allAttempts.length - budgets.length);
  const costRows = budgets.filter((b) => number(b.cost)),
    reserved = budgets.filter((b) => !number(b.cost) && number(b.reserved));
  const cache = budgets.map((b) =>
    ["HIT", "MISS"].includes(b.cache_state) ? b.cache_state : "UNKNOWN",
  );
  return {
    attempts: allAttempts.length,
    usage_observed_attempts: uses.length,
    usage_missing_attempts: allAttempts.length - uses.length,
    observed_input_tokens: uses.length
      ? sum(uses.map((a) => a.input_tokens))
      : null,
    observed_output_tokens: uses.length
      ? sum(uses.map((a) => a.output_tokens))
      : null,
    observed_reasoning_tokens: uses.some((a) =>
      number(a.output_tokens_details?.reasoning_tokens),
    )
      ? sum(
          uses
            .map((a) => a.output_tokens_details?.reasoning_tokens)
            .filter(number),
        )
      : null,
    reasoning_telemetry_attempts: uses.filter((a) =>
      number(a.output_tokens_details?.reasoning_tokens),
    ).length,
    observed_cached_input_tokens: uses.some((a) =>
      number(a.input_tokens_details?.cached_tokens),
    )
      ? sum(
          uses.map((a) => a.input_tokens_details?.cached_tokens).filter(number),
        )
      : null,
    cache_hit_attempts: cache.filter((s) => s === "HIT").length,
    cache_miss_attempts: cache.filter((s) => s === "MISS").length,
    cache_unknown_attempts:
      cache.filter((s) => s === "UNKNOWN").length + missingBudgets,
    settled_cost_upper_bound_usd: costRows.length
      ? sum(costRows.map((b) => b.cost))
      : null,
    retained_reservations_usd: reserved.length
      ? sum(reserved.map((b) => b.reserved))
      : 0,
    total_accounted_cost_upper_bound_usd: budgets.length
      ? sum(
          budgets.map((b) =>
            number(b.cost) ? b.cost : number(b.reserved) ? b.reserved : 0,
          ),
        )
      : null,
    published_rate_estimate_usd: budgets.some((b) =>
      number(b.published_rate_estimate_usd),
    )
      ? sum(budgets.map((b) => b.published_rate_estimate_usd).filter(number))
      : null,
    budget_records: budgets.length,
    missing_budget_records: missingBudgets,
    cost_coverage_complete:
      missingBudgets === 0 &&
      budgets.every((b) => number(b.cost) || number(b.reserved)),
    cost_basis:
      "Published-rate estimate and conservative settled/reserved bounds; not a provider invoice.",
  };
}

function summarize(trials, manifest) {
  const started = trials.filter((t) => t.started > 0),
    attempts = started.flatMap((t) => t.records);
  const known = attempts.filter((a) => !a.telemetry_missing);
  const finished = known.filter((a) => a.attempt_finished === true);
  const provider = known.filter((a) => a.provider_completed === true);
  const parsed = known.filter((a) => a.parser_succeeded === true);
  const parserAttempted = known.filter(
    (a) =>
      a.parser_succeeded === true ||
      hasPhase(a, "parser-start") ||
      hasPhase(a, "parser-complete"),
  );
  const hostAttempts = known.filter(
    (a) =>
      hasPhase(a, "host-validation-start") ||
      a.host_accepted === true ||
      a.host_decision_persisted === true,
  );
  const hostRejected = known.filter((a) => hasPhase(a, "host-rejected"));
  const completedTrials = started.filter((t) => t.providerCompleted),
    parsedTrials = started.filter((t) => t.parserSucceeded),
    acceptedTrials = started.filter((t) => t.hostAccepted);
  const trialFailures = started.filter(
    (t) =>
      t.failure ||
      t.hostRejected ||
      [
        "execution-policy",
        "provider-identity",
        "provider-availability",
        "provider-contract",
      ].includes(t.row?.operational?.boundary),
  );
  const attemptEntries = attempts.map((a) =>
    attemptLatency(a, "attempt_ms", a.attempt_finished === true),
  );
  const answerEntries = attempts.map((a) =>
    attemptLatency(
      a,
      "provider_first_answer_ms",
      hasPhase(a, "first-upstream-answer-text") ||
        number(a.phase_latency_ms?.provider_first_answer_ms)
        ? true
        : undefined,
    ),
  );
  const completionEntries = attempts.map((a) =>
    attemptLatency(a, "provider_completion_ms", a.provider_completed === true),
  );
  const hostEntries = started.map((t) => t.latency.host_accepted);
  return {
    planned: trials.length,
    started: started.length,
    not_run: trials.filter((t) => t.status === "NOT_RUN").length,
    statuses: histogram(trials.map((t) => t.status ?? "PENDING")),
    attempts: attempts.length,
    attempt_records_missing: attempts.length - known.length,
    attempts_finished: finished.length,
    provider_completed: completedTrials.length,
    parser_succeeded: parsedTrials.length,
    host_accepted: acceptedTrials.length,
    host_decision_persisted: started.filter((t) => t.hostPersisted).length,
    trial_rates: {
      started: rate(started.length, trials.length),
      provider_completed: rate(completedTrials.length, started.length),
      parser_succeeded: rate(parsedTrials.length, started.length),
      host_accepted: rate(acceptedTrials.length, started.length),
      execution_or_host_failure: rate(trialFailures.length, started.length),
      deadline: rate(
        started.filter((t) => t.failure?.category === "deadline").length,
        started.length,
      ),
    },
    attempt_rates: {
      provider_completed: rate(provider.length, attempts.length),
      failure: rate(
        known.filter((a) => a.execution_failure || a.provider_error).length,
        attempts.length,
      ),
      structured_output_validity: rate(parsed.length, parserAttempted.length),
      schema_or_json_failure: rate(
        parserAttempted.length - parsed.length,
        parserAttempted.length,
      ),
      host_acceptance: rate(
        known.filter((a) => a.host_accepted === true).length,
        hostAttempts.length,
      ),
      host_rejection: rate(hostRejected.length, hostAttempts.length),
    },
    failure_categories: histogram(
      started
        .filter((t) => t.failure)
        .map((t) => t.failure.category ?? "unknown"),
    ),
    failure_reasons: histogram(
      started
        .filter((t) => t.failure)
        .map((t) => t.failure.reason ?? "unknown"),
    ),
    provider_terminal_types: histogram(
      known.map((a) => a.terminal_type ?? "NO_TERMINAL_RECORDED"),
    ),
    host_rejection_reasons: histogram(
      started
        .filter((t) => t.hostRejected)
        .map((t) => t.row?.host_error ?? "unknown"),
    ),
    service_tier: {
      requested: "default",
      returned: histogram(
        known
          .filter((a) => typeof a.service_tier === "string")
          .map((a) => a.service_tier),
      ),
      missing: attempts.filter((a) => typeof a.service_tier !== "string")
        .length,
      unexpected: known.filter(
        (a) =>
          typeof a.service_tier === "string" && a.service_tier !== "default",
      ).length,
    },
    latency_ms: {
      attempt_finished: latencyStatistics(attemptEntries),
      first_answer_per_attempt: latencyStatistics(answerEntries),
      provider_complete_per_attempt: latencyStatistics(completionEntries),
      trial_execution: latencyStatistics(
        started.map((t) => t.latency.execution),
      ),
      first_answer_from_first_request: latencyStatistics(
        started.map((t) => t.latency.first_answer),
      ),
      provider_complete_from_first_request: latencyStatistics(
        started.map((t) => t.latency.provider_complete),
      ),
      host_accepted_from_first_request: latencyStatistics(hostEntries),
    },
    runtime_reference_crossings: {
      provider_completion: referenceCrossings(
        completionEntries,
        manifest.runtime_reference?.provider_deadline_ms ?? 6000,
        attempts.filter((a) => !a.provider_completed).map((a) => a.latency_ms),
      ),
      host_acceptance: referenceCrossings(
        hostEntries,
        manifest.runtime_reference?.host_deadline_ms ?? 8000,
        started.filter((t) => !t.hostAccepted).map((t) => t.row?.execution_ms),
      ),
      interpretation:
        "Observed latency comparisons, not simulated outcomes under different deadlines. Provider completion uses network dispatch to terminal; host acceptance uses the first request dispatch across retries.",
    },
    usage_and_cost: usageSummary(started),
    semantics: semanticSummary(trials),
    semantic_score: null,
  };
}

function firstSchemaObservations(trials) {
  const seen = new Map();
  let missingSchema = 0,
    missingModel = 0;
  for (const [order, t] of trials.entries()) {
    const schema = t.trial.schema_sha256 ?? t.row?.schema_sha256;
    for (const [index, attempt] of t.records.entries()) {
      if (!schema) missingSchema++;
      if (!attempt.actual_model) missingModel++;
      if (!schema || !attempt.actual_model) continue;
      const key = JSON.stringify([attempt.actual_model, schema]);
      if (seen.has(key)) continue;
      seen.set(key, {
        actual_model: attempt.actual_model,
        schema_sha256: schema,
        first_trial_id: t.trial.trial_id,
        first_trial_order_index: order,
        first_attempt_number: attempt.number ?? index + 1,
        lane: t.trial.lane ?? t.row?.lane ?? null,
        observed_cached_input_tokens: number(
          attempt.usage?.input_tokens_details?.cached_tokens,
        )
          ? attempt.usage.input_tokens_details.cached_tokens
          : null,
      });
    }
  }
  return {
    first_observed_model_schema_requests: [...seen.values()],
    schema_identity_missing_attempts: missingSchema,
    actual_model_missing_attempts: missingModel,
    scope:
      "First locally observed request with known returned model and schema in this planned cohort. Provider grammar cache state and prior requests outside the cohort are unknown; this does not establish a globally cold cache.",
  };
}

export function summarizeQualification(manifest, rows) {
  const planned = new Map(manifest.trials.map((t) => [t.trial_id, t]));
  if (planned.size !== manifest.trials.length)
    throw Error("qualification-report-duplicate-planned-trial");
  const supplied = new Map();
  for (const row of rows) {
    const trial = planned.get(row.trial_id);
    if (
      !trial ||
      supplied.has(row.trial_id) ||
      row.candidate_id !== trial.candidate_id ||
      (row.case_id && row.case_id !== trial.snapshot_id)
    )
      throw Error("qualification-report-result-identity");
    supplied.set(row.trial_id, row);
  }
  const trials = manifest.trials.map((t) =>
    normalizeTrial(t, supplied.get(t.trial_id)),
  );
  return {
    identity: "cuelayer-v2-semantic-qualification-summary-1",
    manifest_sha256: sha256(manifest),
    planned_trials: planned.size,
    trial_rows: trials.length,
    supplied_result_rows: rows.length,
    complete_cohort:
      trials.length > 0 &&
      trials.every((t) => t.status !== "NOT_RUN" && t.started > 0),
    provider_invocations: trials.reduce(
      (n, t) =>
        n +
        (count(t.row?.real_provider_attempt_count)
          ? t.row.real_provider_attempt_count
          : 0),
      0,
    ),
    totals: summarize(trials, manifest),
    schema_use: firstSchemaObservations(trials),
    candidates: manifest.candidates.map((c) => ({
      candidate_id: c.candidate_id,
      model: c.model,
      configuration: c.configuration,
      ...summarize(
        trials.filter((t) => t.trial.candidate_id === c.candidate_id),
        manifest,
      ),
    })),
    trials: trials.map((t, index) => ({
      trial_id: t.trial.trial_id,
      case_id: t.trial.snapshot_id,
      candidate_id: t.trial.candidate_id,
      repetition: t.trial.repetition,
      trial_order_index: index,
      lane: t.trial.lane ?? t.row?.lane ?? null,
      schema_sha256: t.trial.schema_sha256 ?? t.row?.schema_sha256 ?? null,
      status: t.status,
      reason: t.reason,
      provider_attempt_count: t.started,
      provider_completed: t.providerCompleted,
      parser_succeeded: t.parserSucceeded,
      host_accepted: t.hostAccepted,
      host_decision_persisted: t.hostPersisted,
      host_error: t.row?.host_error ?? null,
      execution_failure: t.failure,
      latency_ms: Object.fromEntries(
        Object.entries(t.latency).map(([key, value]) => [key, value.value]),
      ),
      semantic_review_status:
        t.row?.semantic_review_status === "VALIDATED"
          ? "VALIDATED"
          : t.started
            ? "PENDING"
            : "UNAVAILABLE",
    })),
    selection: "UNDECIDED_REQUIRES_SEMANTIC_REVIEW_AND_LATENCY_TRADEOFF",
    limitations: [
      "Offline execution tests are not model quality or latency measurements.",
      "Quantiles describe observed samples only; failure, censoring and missing telemetry denominators remain separate.",
      "This small qualification corpus does not support a reliable p99 claim.",
      "Parser success and host acceptance do not establish semantic correctness.",
    ],
  };
}
