import { sha256 } from "../evidence.mjs";

export const TOKEN_COUNT_ENDPOINT =
  "https://api.openai.com/v1/responses/input_tokens";
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const day = (time) => new Date(time).toISOString().slice(0, 10);
// Reviewed offer membership is independent of caller-supplied candidate labels.
const quotaGroups = new Map([
  ...[
    "gpt-5.4-2026-03-05",
    "gpt-5.2-2025-12-11",
    "gpt-5.1-2025-11-13",
    "gpt-5-2025-08-07",
    "gpt-4.1-2025-04-14",
    "gpt-4o-2024-08-06",
    "o1-2024-12-17",
    "o3-2025-04-16",
  ].map((model) => [model, "large"]),
  ...[
    "gpt-5.4-mini-2026-03-17",
    "gpt-5.4-nano-2026-03-17",
    "gpt-5-mini-2025-08-07",
    "gpt-5-nano-2025-08-07",
    "gpt-4.1-mini-2025-04-14",
    "gpt-4.1-nano-2025-04-14",
    "gpt-4o-mini-2024-07-18",
    "o4-mini-2025-04-16",
  ].map((model) => [model, "small"]),
]);

// The count request includes every input-bearing field in this text-only protocol.
export function inputTokenCountPayload(payload) {
  const allowed = new Set([
    "model",
    "input",
    "instructions",
    "reasoning",
    "text",
    "tools",
    "tool_choice",
    "parallel_tool_calls",
    "truncation",
    "max_output_tokens",
    "stream",
    "store",
    "service_tier",
  ]);
  if (Object.keys(payload).some((key) => !allowed.has(key)))
    throw Error("quota-unknown-input-field");
  if (payload.tools?.length || payload.truncation === "auto")
    throw Error("quota-text-only-untruncated-input-required");
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) =>
        !["max_output_tokens", "stream", "store", "service_tier"].includes(key),
    ),
  );
}

export function qualificationInputBound({
  payload,
  candidate,
  proposal,
  inputTokenCounts,
}) {
  const hash = sha256(JSON.stringify(payload));
  const records = (inputTokenCounts ?? []).filter(
    (r) => r.model === candidate.model && r.payload_sha256 === hash,
  );
  if (records.length !== 1) throw Error("quota-exact-input-count-required");
  const record = records[0];
  if (
    record.status !== 200 ||
    record.object !== "response.input_tokens" ||
    !integer(record.input_tokens) ||
    record.input_tokens === 0 ||
    record.endpoint !== TOKEN_COUNT_ENDPOINT ||
    record.count_request_sha256 !==
      sha256(JSON.stringify(inputTokenCountPayload(payload))) ||
    !Number.isFinite(Date.parse(record.checked_at))
  )
    throw Error("quota-invalid-input-count");
  const margin = proposal.complimentary_policy?.input_token_margin;
  if (margin !== 512) throw Error("quota-input-margin-drift");
  const bound = record.input_tokens + margin;
  if (
    bound > (candidate.max_input_tokens ?? Infinity) ||
    bound + candidate.max_output_tokens > candidate.context_window_tokens
  )
    throw Error("quota-input-exceeds-context");
  return {
    input_tokens_upper_bound: bound,
    input_token_count_sha256: sha256(record),
  };
}

// This is a local admission limit based on an explicit account attestation.
// It cannot change sharing settings, reserve OpenAI's organization-wide allowance,
// or prove the eventual invoice. Cached input and reasoning output still count.
export function createQuotaGuard(manifest, approval, { now = Date.now } = {}) {
  const policy =
    manifest.complimentary_policy ??
    manifest.reviewed_proposal?.complimentary_policy;
  const account = approval.complimentary_usage;
  if (
    !policy ||
    policy.utc_reset !== "00:00" ||
    policy.daily_caps?.large !== 250000 ||
    policy.daily_caps?.small !== 2500000
  )
    throw Error("quota-policy-required");
  if (
    !account ||
    account.enrolled !== true ||
    account.project_confirmed !== true ||
    account.sharing_authorized !== true ||
    account.exclusive_org_usage !== true ||
    typeof account.source !== "string" ||
    !account.source.trim() ||
    !Number.isFinite(Date.parse(account.checked_at)) ||
    Date.parse(account.checked_at) > now() + 300000 ||
    now() - Date.parse(account.checked_at) > 30 * 60 * 1000 ||
    day(Date.parse(account.checked_at)) !== account.utc_date ||
    account.utc_date !== day(now())
  )
    throw Error("quota-current-account-confirmation-required");
  const limits = {};
  for (const group of ["large", "small"]) {
    const remaining = account.remaining_tokens?.[group],
      cap = policy.run_caps?.[group];
    if (
      !integer(remaining) ||
      remaining > policy.daily_caps[group] ||
      !integer(cap) ||
      cap <= 0 ||
      cap > policy.daily_caps[group]
    )
      throw Error("quota-invalid-group-limit");
    limits[group] = Math.min(remaining, cap);
  }
  const original = sha256({ policy, account });
  const reservations = new Map();
  let failure = null;
  const fail = (message) => {
    failure = message;
    throw Error(message);
  };
  const assertActive = () => {
    if (failure) throw Error(failure);
    if (original !== sha256({ policy, account }))
      fail("quota-confirmation-drift");
    if (account.utc_date !== day(now())) fail("quota-utc-day-changed");
  };
  const consumed = (group) =>
    [...reservations.values()]
      .filter((r) => r.group === group)
      .reduce((sum, r) => sum + r.tokens, 0);
  return {
    assertActive,
    reserve(trial, candidate, id) {
      assertActive();
      const group = candidate.quota_group;
      if (
        !["large", "small"].includes(group) ||
        quotaGroups.get(candidate.model) !== group
      )
        fail("quota-model-eligibility-unconfirmed");
      if (candidate.incentive_eligibility !== "DOCUMENTED")
        fail("quota-model-eligibility-unconfirmed");
      if (reservations.has(id)) fail("quota-duplicate-reservation");
      const input = trial.input_tokens_upper_bound,
        output = candidate.max_output_tokens;
      if (!integer(input) || input <= 0 || !integer(output) || output <= 0)
        fail("quota-invalid-reservation");
      const tokens = input + output;
      if (consumed(group) + tokens > limits[group])
        fail("quota-group-allowance-exhausted:" + group);
      reservations.set(id, {
        group,
        model: candidate.model,
        input,
        output,
        tokens,
        settled: false,
      });
    },
    settle(id, usage, actualModel) {
      assertActive();
      const r = reservations.get(id);
      if (!r || r.settled) fail("quota-invalid-settlement");
      r.settled = true;
      if (actualModel !== r.model) fail("quota-returned-model-unconfirmed");
      if (
        !usage ||
        !integer(usage.input_tokens) ||
        !integer(usage.output_tokens) ||
        !integer(usage.input_tokens_details?.cached_tokens ?? 0) ||
        (usage.input_tokens_details?.cached_tokens ?? 0) > usage.input_tokens ||
        (usage.total_tokens != null &&
          (!integer(usage.total_tokens) ||
            usage.total_tokens !== usage.input_tokens + usage.output_tokens)) ||
        (usage.output_tokens_details?.reasoning_tokens != null &&
          (!integer(usage.output_tokens_details.reasoning_tokens) ||
            usage.output_tokens_details.reasoning_tokens > usage.output_tokens))
      )
        fail("quota-usage-unavailable");
      if (usage.input_tokens > r.input || usage.output_tokens > r.output)
        fail("quota-provider-token-bound-exceeded");
      r.tokens = usage.input_tokens + usage.output_tokens;
    },
    snapshot() {
      return {
        utc_date: account.utc_date,
        limits: { ...limits },
        consumed: Object.fromEntries(
          ["large", "small"].map((group) => [group, consumed(group)]),
        ),
        failure,
        invoice_verified: false,
      };
    },
  };
}
