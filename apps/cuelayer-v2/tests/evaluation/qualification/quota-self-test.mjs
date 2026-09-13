import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "../evidence.mjs";
import {
  TOKEN_COUNT_ENDPOINT,
  inputTokenCountPayload,
  qualificationInputBound,
  createQuotaGuard,
} from "./quota.mjs";

// Unpaid accounting fixtures. These records are not provider counts, account
// attestations, or approval artifacts and must never enter a frozen live run.
const instant = Date.parse("2026-09-13T12:00:00Z");
function quotaFixture({ remaining = 1000, cap = 1000 } = {}) {
  let time = instant;
  const manifest = {
    complimentary_policy: {
      utc_reset: "00:00",
      daily_caps: { large: 250000, small: 2500000 },
      run_caps: { large: cap, small: cap },
      input_token_margin: 512,
    },
  };
  const approval = {
    complimentary_usage: {
      enrolled: true,
      project_confirmed: true,
      sharing_authorized: true,
      exclusive_org_usage: true,
      source: "offline test only",
      checked_at: new Date(instant).toISOString(),
      utc_date: "2026-09-13",
      remaining_tokens: { large: remaining, small: remaining },
    },
  };
  const candidate = {
    model: "o1-2024-12-17",
    quota_group: "large",
    incentive_eligibility: "DOCUMENTED",
    max_output_tokens: 300,
  };
  return {
    manifest,
    approval,
    candidate,
    create: () => createQuotaGuard(manifest, approval, { now: () => time }),
    advance: (ms) => {
      time += ms;
    },
  };
}
function countFixture() {
  const payload = {
    model: "gpt-5-mini-2025-08-07",
    input: [
      { role: "user", content: [{ type: "input_text", text: "P = F/A." }] },
    ],
    instructions: "Preserve the stated relation and its evidence.",
    reasoning: { effort: "medium" },
    text: {
      format: {
        type: "json_schema",
        name: "offline_test",
        strict: true,
        schema: {
          type: "object",
          properties: { expression: { type: "string" } },
          required: ["expression"],
          additionalProperties: false,
        },
      },
    },
    tools: [],
    tool_choice: "none",
    parallel_tool_calls: false,
    truncation: "disabled",
    max_output_tokens: 8192,
    stream: true,
    store: false,
    service_tier: "default",
  };
  const candidate = {
    model: payload.model,
    max_output_tokens: 8192,
    context_window_tokens: 400000,
    max_input_tokens: 272000,
  };
  const proposal = { complimentary_policy: { input_token_margin: 512 } };
  const record = {
    test_only: true,
    model: candidate.model,
    payload_sha256: sha256(JSON.stringify(payload)),
    status: 200,
    object: "response.input_tokens",
    input_tokens: 1000,
    endpoint: TOKEN_COUNT_ENDPOINT,
    count_request_sha256: sha256(
      JSON.stringify(inputTokenCountPayload(payload)),
    ),
    checked_at: new Date(instant).toISOString(),
  };
  const bound = (records = [record], actualPayload = payload) =>
    qualificationInputBound({
      payload: actualPayload,
      candidate,
      proposal,
      inputTokenCounts: records,
    });
  return { payload, candidate, proposal, record, bound };
}

test("candidate labels cannot move large models to the small allowance or enroll an unconfirmed model", () => {
  for (const candidate of [
    { ...quotaFixture().candidate, quota_group: "small" },
    {
      ...quotaFixture().candidate,
      model: "o3-mini-2025-01-31",
      quota_group: "small",
    },
  ]) {
    const q = quotaFixture().create();
    assert.throws(
      () => q.reserve({ input_tokens_upper_bound: 100 }, candidate, "attempt"),
      /quota-model-eligibility-unconfirmed/,
    );
    assert.deepEqual(q.snapshot().consumed, { large: 0, small: 0 });
  }
});
const usage = (input = 100, output = 100) => ({
  input_tokens: input,
  output_tokens: output,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: input + output,
});

test("input count retains all frozen input and schema fields and rejects uncounted context", () => {
  const { payload } = countFixture();
  const expected = structuredClone(payload);
  for (const key of ["max_output_tokens", "stream", "store", "service_tier"])
    delete expected[key];
  assert.deepEqual(inputTokenCountPayload(payload), expected);
  for (const extra of [
    { previous_response_id: "resp_test" },
    { conversation: "conv_test" },
    { personality: "friendly" },
    { unknown_input: "extra source" },
  ])
    assert.throws(
      () => inputTokenCountPayload({ ...payload, ...extra }),
      /quota-unknown-input-field/,
    );
  assert.throws(
    () =>
      inputTokenCountPayload({ ...payload, tools: [{ type: "web_search" }] }),
    /quota-text-only/,
  );
  assert.throws(
    () => inputTokenCountPayload({ ...payload, truncation: "auto" }),
    /quota-text-only/,
  );
});

test("count binding requires one exact full payload and exact count-request hash", () => {
  const { payload, record, bound } = countFixture();
  assert.deepEqual(bound(), {
    input_tokens_upper_bound: 1512,
    input_token_count_sha256: sha256(record),
  });
  for (const field of [
    "input",
    "instructions",
    "reasoning",
    "text",
    "model",
    "max_output_tokens",
  ])
    assert.throws(
      () => bound([record], { ...payload, [field]: "tampered" }),
      /quota-exact-input-count/,
    );
  assert.throws(() => bound([]), /quota-exact-input-count/);
  assert.throws(
    () => bound([record, structuredClone(record)]),
    /quota-exact-input-count/,
  );
  assert.throws(
    () => bound([{ ...record, count_request_sha256: "0".repeat(64) }]),
    /quota-invalid-input-count/,
  );
});

test("malformed count evidence and margin changes cannot establish a token bound", () => {
  const { record, proposal, bound } = countFixture();
  for (const change of [
    { status: 500 },
    { object: "response" },
    { input_tokens: 0 },
    { input_tokens: -1 },
    { input_tokens: 1.5 },
    { input_tokens: NaN },
    { endpoint: "https://example.invalid/input_tokens" },
    { checked_at: "invalid" },
  ])
    assert.throws(
      () => bound([{ ...record, ...change }]),
      /quota-invalid-input-count/,
    );
  proposal.complimentary_policy.input_token_margin = 0;
  assert.throws(() => bound(), /quota-input-margin-drift/);
});

test("count plus margin obeys the independent input maximum and combined context", () => {
  const { record, candidate, bound } = countFixture();
  assert.equal(
    bound([{ ...record, input_tokens: 271488 }]).input_tokens_upper_bound,
    272000,
  );
  assert.throws(
    () => bound([{ ...record, input_tokens: 271489 }]),
    /quota-input-exceeds/,
  );
  assert.throws(
    () => bound([{ ...record, input_tokens: 300000 }]),
    /quota-input-exceeds/,
  );
  candidate.max_input_tokens = null;
  candidate.context_window_tokens = 9704;
  assert.equal(bound().input_tokens_upper_bound, 1512);
  candidate.context_window_tokens = 9703;
  assert.throws(() => bound(), /quota-input-exceeds-context/);
});

test("quota requires current account confirmation and cannot use a stale same-day reading", () => {
  for (const field of [
    "enrolled",
    "project_confirmed",
    "sharing_authorized",
    "exclusive_org_usage",
  ]) {
    const f = quotaFixture();
    f.approval.complimentary_usage[field] = false;
    assert.throws(
      () => f.create(),
      /quota-current-account-confirmation-required/,
    );
  }
  const fresh = quotaFixture();
  fresh.advance(30 * 60 * 1000);
  assert.doesNotThrow(() => fresh.create());
  const stale = quotaFixture();
  stale.advance(30 * 60 * 1000 + 1);
  assert.throws(
    () => stale.create(),
    /quota-current-account-confirmation-required/,
  );
});

test("published quota snapshots cannot raise the approved remaining allowance", () => {
  const f = quotaFixture({ remaining: 500, cap: 1000 });
  const q = f.create();
  q.snapshot().limits.large = 100000;
  assert.equal(q.snapshot().limits.large, 500);
  assert.throws(
    () => q.reserve({ input_tokens_upper_bound: 300 }, f.candidate, "a"),
    /quota-group-allowance-exhausted/,
  );
  assert.equal(q.snapshot().consumed.large, 0);
});

test("cached input and reasoning are counted once within total input and output", () => {
  const f = quotaFixture();
  const q = f.create();
  q.reserve({ input_tokens_upper_bound: 300 }, f.candidate, "a");
  assert.equal(q.snapshot().consumed.large, 600);
  q.settle(
    "a",
    {
      ...usage(200, 100),
      input_tokens_details: { cached_tokens: 150 },
      output_tokens_details: { reasoning_tokens: 80 },
    },
    f.candidate.model,
  );
  assert.equal(q.snapshot().consumed.large, 300);
  q.reserve({ input_tokens_upper_bound: 400 }, f.candidate, "b");
  assert.equal(q.snapshot().consumed.large, 1000);
  assert.throws(
    () => q.reserve({ input_tokens_upper_bound: 1 }, f.candidate, "c"),
    /quota-group-allowance-exhausted/,
  );
});

test("in-flight reservations include full output and cannot overbook a quota group", () => {
  const f = quotaFixture();
  const q = f.create();
  q.reserve({ input_tokens_upper_bound: 300 }, f.candidate, "a");
  assert.throws(
    () => q.reserve({ input_tokens_upper_bound: 300 }, f.candidate, "b"),
    /quota-group-allowance-exhausted/,
  );
  assert.equal(q.snapshot().consumed.large, 600);
  assert.throws(() => q.assertActive(), /quota-group-allowance-exhausted/);
  assert.equal(q.snapshot().invoice_verified, false);
});

test("missing or contradictory usage retains the reservation and stops future admission", () => {
  for (const malformed of [
    undefined,
    { ...usage(), input_tokens: NaN },
    { ...usage(), output_tokens: -1 },
    { ...usage(), input_tokens_details: { cached_tokens: 101 } },
    { ...usage(), output_tokens_details: { reasoning_tokens: 101 } },
    { ...usage(), output_tokens_details: { reasoning_tokens: -1 } },
    { ...usage(), total_tokens: 201 },
  ]) {
    const f = quotaFixture();
    const q = f.create();
    q.reserve({ input_tokens_upper_bound: 300 }, f.candidate, "a");
    assert.throws(
      () => q.settle("a", malformed, f.candidate.model),
      /quota-usage/,
    );
    assert.equal(q.snapshot().consumed.large, 600);
    assert.throws(
      () => q.reserve({ input_tokens_upper_bound: 1 }, f.candidate, "b"),
      /quota-usage/,
    );
  }
});

test("provider identity or token overrun cannot release a reservation", () => {
  for (const [actual, reported] of [
    ["unexpected-model", usage()],
    ["o1-2024-12-17", usage(301, 100)],
    ["o1-2024-12-17", usage(100, 301)],
  ]) {
    const f = quotaFixture();
    const q = f.create();
    q.reserve({ input_tokens_upper_bound: 300 }, f.candidate, "a");
    assert.throws(
      () => q.settle("a", reported, actual),
      /quota-returned-model|quota-provider-token-bound/,
    );
    assert.equal(q.snapshot().consumed.large, 600);
    assert.throws(() => q.assertActive(), /quota-/);
  }
});

test("UTC rollover and changed approval stop admission without resetting reservations", () => {
  const f = quotaFixture();
  const q = f.create();
  q.reserve({ input_tokens_upper_bound: 300 }, f.candidate, "a");
  f.advance(12 * 60 * 60 * 1000);
  assert.throws(
    () => q.settle("a", usage(), f.candidate.model),
    /quota-utc-day-changed/,
  );
  assert.equal(q.snapshot().consumed.large, 600);
  assert.throws(
    () => q.reserve({ input_tokens_upper_bound: 1 }, f.candidate, "b"),
    /quota-utc-day-changed/,
  );
  const changed = quotaFixture();
  const second = changed.create();
  changed.approval.complimentary_usage.remaining_tokens.large++;
  assert.throws(() => second.assertActive(), /quota-confirmation-drift/);
});

test("unknown eligibility and duplicate reservations or settlements fail closed", () => {
  for (const change of [
    { incentive_eligibility: "UNCONFIRMED" },
    { quota_group: "other" },
  ]) {
    const f = quotaFixture();
    const q = f.create();
    assert.throws(
      () =>
        q.reserve(
          { input_tokens_upper_bound: 100 },
          { ...f.candidate, ...change },
          "a",
        ),
      /quota-model-eligibility-unconfirmed/,
    );
    assert.equal(q.snapshot().consumed.large, 0);
  }
  const f = quotaFixture();
  const q = f.create();
  q.reserve({ input_tokens_upper_bound: 100 }, f.candidate, "a");
  assert.throws(
    () => q.reserve({ input_tokens_upper_bound: 100 }, f.candidate, "a"),
    /quota-duplicate-reservation/,
  );
  const other = quotaFixture();
  const settled = other.create();
  settled.reserve({ input_tokens_upper_bound: 100 }, other.candidate, "a");
  settled.settle("a", usage(), other.candidate.model);
  assert.throws(
    () => settled.settle("a", usage(), other.candidate.model),
    /quota-invalid-settlement/,
  );
  assert.equal(settled.snapshot().consumed.large, 200);
});
