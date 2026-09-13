import { sha256 } from "../evidence.mjs";

export const QUALIFICATION_IDENTITY = "cuelayer-v2-semantic-qualification-1";
export const QUALIFICATION_APPROVAL_IDENTITY =
  "cuelayer-v2-semantic-qualification-authorization-1";
export function createQualificationScope(manifest, approval, apiKeys) {
  if (
    manifest.identity !== QUALIFICATION_IDENTITY ||
    manifest.paid_enabled !== false ||
    manifest.freeze_status !== "FROZEN"
  )
    throw Error("qualification-not-frozen");
  if (
    approval?.identity !== QUALIFICATION_APPROVAL_IDENTITY ||
    approval.approved !== true ||
    approval.manifest_sha256 !== sha256(manifest) ||
    approval.limits_sha256 !== sha256(manifest.proposed_limits)
  )
    throw Error("qualification-approval-mismatch");
  const manifestHash = sha256(manifest),
    approvalHash = sha256(approval);
  const candidates = new Map(
    manifest.candidates.map((c) => [c.candidate_id, c]),
  );
  const trials = new Map(manifest.trials.map((t) => [t.trial_id, t]));
  if (
    candidates.size !== manifest.candidates.length ||
    trials.size !== manifest.trials.length
  )
    throw Error("qualification-duplicate-identity");
  const limits = manifest.proposed_limits;
  for (const name of [
    "max_trials",
    "max_provider_attempts",
    "max_input_tokens_per_attempt",
    "max_output_tokens_per_attempt",
    "max_total_input_tokens",
    "max_total_output_tokens",
  ])
    if (!Number.isSafeInteger(limits[name]) || limits[name] <= 0)
      throw Error("qualification-invalid-limit");
  if (
    !Number.isFinite(limits.max_cost_usd) ||
    limits.max_cost_usd <= 0 ||
    trials.size !== limits.max_trials
  )
    throw Error("qualification-invalid-limit");
  for (const c of candidates.values()) {
    if (c.provider !== "openai" || !apiKeys[c.provider]?.trim())
      throw Error("qualification-provider-key-required:" + c.provider);
    for (const field of ["input", "output", "cached_input"])
      if (
        !Number.isFinite(c.prices_usd_per_million?.[field]) ||
        c.prices_usd_per_million[field] < 0
      )
        throw Error("qualification-invalid-pricing");
    if (
      Object.keys(c.prices_usd_per_million).some(
        (k) => !["input", "output", "cached_input", "cache_write"].includes(k),
      )
    )
      throw Error("qualification-invalid-pricing");
    if (
      Object.values(c.prices_usd_per_million).some(
        (v) => !Number.isFinite(v) || v < 0,
      )
    )
      throw Error("qualification-invalid-pricing");
    if (
      c.long_context_pricing &&
      (!Number.isFinite(c.long_context_pricing.threshold_input_tokens) ||
        c.long_context_pricing.threshold_input_tokens <= 0 ||
        ![
          c.long_context_pricing.input_multiplier,
          c.long_context_pricing.output_multiplier,
        ].every((v) => Number.isFinite(v) && v >= 1))
    )
      throw Error("qualification-invalid-pricing");
    if (c.max_output_tokens !== limits.max_output_tokens_per_attempt)
      throw Error("qualification-output-limit-mismatch");
  }
  for (const t of trials.values()) {
    const c = candidates.get(t.candidate_id);
    const endpoint = {
      openai: "https://api.openai.com/v1/responses",
      anthropic: "https://api.anthropic.com/v1/messages",
      google: "https://generativelanguage.googleapis.com/v1beta/interactions",
    }[c?.provider];
    if (
      !c ||
      t.provider_url !== endpoint ||
      !/^[a-f0-9]{64}$/.test(t.payload_sha256) ||
      !Number.isSafeInteger(t.input_tokens_upper_bound) ||
      t.input_tokens_upper_bound <= 0 ||
      t.input_tokens_upper_bound > limits.max_input_tokens_per_attempt
    )
      throw Error("qualification-invalid-trial");
  }
  const calls = [],
    counts = new Map();
  let invalid = null;
  const number = (x) => Number.isSafeInteger(x) && x >= 0;
  const maxInputRate = (c) =>
    Math.max(
      c.prices_usd_per_million.input,
      c.prices_usd_per_million.cache_write ?? c.prices_usd_per_million.input,
    );
  const multipliers = (c, input) =>
    input > (c.long_context_pricing?.threshold_input_tokens ?? Infinity)
      ? c.long_context_pricing
      : { input_multiplier: 1, output_multiplier: 1 };
  const cost = () => calls.reduce((n, c) => n + (c.cost ?? c.reserved), 0);
  const totals = (key) =>
    calls.reduce((n, c) => n + (c[key] ?? c["reserved_" + key]), 0);
  const assertActive = () => {
    if (sha256(manifest) !== manifestHash || sha256(approval) !== approvalHash)
      invalid = "qualification-approval-drift";
    if (invalid) throw Error(invalid);
  };
  const budget = {
    calls,
    cost,
    settle(id, usage, actualModel) {
      assertActive();
      const call = calls.find((c) => c.id === id);
      if (!call) throw Error("qualification-unknown-reservation");
      if (call.settled) throw Error("qualification-already-settled");
      call.settled = true;
      if (actualModel && actualModel !== call.model) {
        invalid = "qualification-model-drift";
        throw Error(invalid);
      }
      if (!usage) return;
      const input = usage.input_tokens,
        output = usage.output_tokens,
        cached = usage.input_tokens_details?.cached_tokens ?? 0;
      if (
        !number(input) ||
        !number(output) ||
        !number(cached) ||
        cached > input
      ) {
        call.usage_unavailable = true;
        return;
      }
      if (
        input > call.reserved_input_tokens ||
        output > call.reserved_output_tokens
      ) {
        invalid = "qualification-provider-token-bound-exceeded";
        throw Error(invalid);
      }
      const c = candidates.get(call.candidate_id),
        p = c.prices_usd_per_million;
      call.input_tokens = input;
      call.output_tokens = output;
      call.cached_input_tokens = cached;
      call.cache_state = cached ? "HIT" : "MISS";
      // Without exact cache-creation billing, retain the largest published input rate.
      const rates = multipliers(c, input);
      call.cost =
        (((input - cached) * maxInputRate(c) + cached * p.cached_input) *
          rates.input_multiplier +
          output * p.output * rates.output_multiplier) /
        1e6;
      call.published_rate_estimate_usd =
        (((input - cached) * p.input + cached * p.cached_input) *
          rates.input_multiplier +
          output * p.output * rates.output_multiplier) /
        1e6;
      if (
        cost() > limits.max_cost_usd ||
        totals("input_tokens") > limits.max_total_input_tokens ||
        totals("output_tokens") > limits.max_total_output_tokens
      ) {
        invalid = "qualification-budget-exceeded";
        throw Error(invalid);
      }
    },
  };
  return {
    assertActive,
    discipline: { budget },
    authorization: approval,
    reserve(trialId, url, method, body) {
      assertActive();
      const trial = trials.get(trialId),
        count = counts.get(trialId) ?? 0;
      if (
        !trial ||
        method !== "POST" ||
        url !== trial.provider_url ||
        sha256(body) !== trial.payload_sha256
      )
        throw Error("qualification-unapproved-request");
      if (count >= 3) throw Error("qualification-retry-limit");
      const c = candidates.get(trial.candidate_id),
        input = trial.input_tokens_upper_bound,
        output = c.max_output_tokens;
      const rates = multipliers(c, input);
      const reserved =
        (input * maxInputRate(c) * rates.input_multiplier +
          output * c.prices_usd_per_million.output * rates.output_multiplier) /
        1e6;
      if (!Number.isFinite(reserved) || reserved < 0)
        throw Error("qualification-invalid-reservation");
      if (
        calls.length >= limits.max_provider_attempts ||
        cost() + reserved > limits.max_cost_usd ||
        totals("input_tokens") + input > limits.max_total_input_tokens ||
        totals("output_tokens") + output > limits.max_total_output_tokens
      )
        throw Error("qualification-budget-exceeded");
      const id = trialId + ":attempt-" + (count + 1);
      counts.set(trialId, count + 1);
      calls.push({
        id,
        run_id: trialId,
        candidate_id: c.candidate_id,
        model: c.model,
        reserved,
        reserved_input_tokens: input,
        reserved_output_tokens: output,
        cost: null,
        cached_input_tokens: null,
        cache_state: "UNKNOWN",
        settled: false,
      });
      return id;
    },
  };
}
