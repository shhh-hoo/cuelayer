import { sha256 } from "../evidence.mjs";

export const NATURAL_IDENTITY = "cuelayer-v2-natural-lesson-1";
export const NATURAL_APPROVAL_IDENTITY =
  "cuelayer-v2-natural-lesson-authorization-1";
export const NATURAL_CAPTURE_IDENTITY = "cuelayer-v2-natural-session-capture-1";
export const NATURAL_PROVIDER_URL = "https://api.openai.com/v1/responses";
const same = (a, b) =>
  a === undefined || b === undefined ? a === b : sha256(a) === sha256(b);
const hash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const laneOf = (task) => ({ Live: "LIVE", Stage: "STAGE" })[task?.lane];

// Future user requests are dynamic. Everything else in the SDK payload is frozen.
export function payloadProfile(payload) {
  const { input, ...envelope } = payload;
  if (
    !Array.isArray(input) ||
    input.length !== 2 ||
    input[0]?.role !== "system" ||
    typeof input[0].content !== "string" ||
    input[1]?.role !== "user" ||
    typeof input[1].content !== "string"
  )
    throw Error("natural-invalid-payload-input");
  return {
    envelope_sha256: sha256(envelope),
    system_prompt_sha256: sha256(input[0]),
    schema_sha256: sha256(payload.text?.format?.schema ?? null),
  };
}

export function createNaturalScope(manifest, approval, apiKey) {
  if (
    manifest.identity !== NATURAL_IDENTITY ||
    manifest.paid_enabled !== false ||
    manifest.freeze_status !== "FROZEN"
  )
    throw Error("natural-not-frozen");
  if (
    approval?.identity !== NATURAL_APPROVAL_IDENTITY ||
    approval.approved !== true ||
    approval.manifest_sha256 !== sha256(manifest) ||
    approval.limits_sha256 !== sha256(manifest.proposed_limits)
  )
    throw Error("natural-approval-mismatch");
  if (typeof apiKey !== "string" || !apiKey.trim())
    throw Error("natural-provider-key-required:openai");
  const manifestHash = sha256(manifest),
    approvalHash = sha256(approval);
  const c = manifest.candidate,
    limits = manifest.proposed_limits;
  const policy = manifest.dynamic_capture_policy;
  if (
    c?.provider !== "openai" ||
    c.model !== "gpt-6-astra" ||
    !same(c.configuration, { reasoning: { effort: "medium" } }) ||
    c.service_tier !== "standard" ||
    c.max_output_tokens !== 8192 ||
    c.context_window_tokens !== 1050000 ||
    typeof c.candidate_id !== "string" ||
    !c.candidate_id
  )
    throw Error("natural-candidate-policy-drift");
  const maxima = {
    max_provider_attempts: 32,
    concurrency: 2,
    max_input_tokens_per_attempt: c.context_window_tokens,
    max_output_tokens_per_attempt: c.max_output_tokens,
    max_total_input_tokens: 32 * c.context_window_tokens,
    max_total_output_tokens: 32 * c.max_output_tokens,
  };
  if (
    !limits ||
    Object.entries(maxima).some(
      ([key, maximum]) =>
        !integer(limits[key]) || limits[key] < 1 || limits[key] > maximum,
    ) ||
    !Number.isFinite(limits.max_cost_usd) ||
    limits.max_cost_usd <= 0 ||
    limits.max_cost_usd > 60 ||
    limits.max_input_tokens_per_attempt !== c.context_window_tokens ||
    limits.max_output_tokens_per_attempt !== c.max_output_tokens
  )
    throw Error("natural-invalid-limit");
  if (
    policy?.identity !== NATURAL_CAPTURE_IDENTITY ||
    policy.max_attempts_per_task !== 3 ||
    policy.max_request_bytes !== 28000 ||
    !same(Object.keys(policy.profiles ?? {}).sort(), ["LIVE", "STAGE"]) ||
    Object.values(policy.profiles).some(
      (profile) =>
        !same(Object.keys(profile).sort(), [
          "envelope_sha256",
          "schema_sha256",
          "system_prompt_sha256",
        ]) || !Object.values(profile).every(hash),
    )
  )
    throw Error("natural-capture-policy-drift");
  const prices = c.prices_usd_per_million,
    long = c.long_context_pricing;
  if (
    !prices ||
    !["input", "output", "cached_input"].every(
      (key) => Number.isFinite(prices[key]) && prices[key] >= 0,
    ) ||
    Object.entries(prices).some(
      ([key, value]) =>
        !["input", "output", "cached_input", "cache_write"].includes(key) ||
        !Number.isFinite(value) ||
        value < 0,
    ) ||
    (long &&
      (!integer(long.threshold_input_tokens) ||
        long.threshold_input_tokens < 1 ||
        ![long.input_multiplier, long.output_multiplier].every(
          (value) => Number.isFinite(value) && value >= 1,
        )))
  )
    throw Error("natural-invalid-pricing");
  const expires = Date.parse(manifest.expires_at);
  if (!Number.isFinite(expires) || Date.now() > expires)
    throw Error("natural-manifest-expired");

  const calls = [],
    registrations = [],
    captures = new Map(),
    counts = new Map(),
    inFlight = new Set();
  let stopped = null,
    integrityError = null;
  const halt = (reason) => {
    stopped ??= String(reason).slice(0, 160);
  };
  const assertIntegrity = () => {
    if (sha256(manifest) !== manifestHash || sha256(approval) !== approvalHash)
      integrityError ??= "natural-approval-drift";
    if (Date.now() > expires) integrityError ??= "natural-manifest-expired";
    if (integrityError) {
      halt(integrityError);
      throw Error(integrityError);
    }
  };
  const assertActive = () => {
    assertIntegrity();
    if (stopped) throw Error(stopped);
  };
  // Same conservative tariff policy as qualification/guard.mjs: reserve maximum
  // cache-write/input tariffs, long-context premium, and full output capacity.
  const maxInputRate = Math.max(
    prices.input,
    prices.cache_write ?? prices.input,
  );
  const rates = (input) =>
    input > (long?.threshold_input_tokens ?? Infinity)
      ? long
      : { input_multiplier: 1, output_multiplier: 1 };
  const cost = () =>
    calls.reduce((total, call) => total + (call.cost ?? call.reserved), 0);
  const totals = (key) =>
    calls.reduce(
      (total, call) => total + (call[key] ?? call["reserved_" + key]),
      0,
    );
  const budget = {
    get calls() {
      return structuredClone(calls);
    },
    cost,
    settle(id, usage, actualModel) {
      // Already dispatched calls must retain their facts after another call stops
      // new dispatch. Authorization/integrity drift still invalidates settlement.
      assertIntegrity();
      const call = calls.find((entry) => entry.id === id);
      if (!call) throw Error("natural-unknown-reservation");
      if (call.settled) throw Error("natural-already-settled");
      call.settled = true;
      call.actual_model = actualModel ?? null;
      if (actualModel && actualModel !== call.model) {
        halt("natural-model-drift");
        throw Error("natural-model-drift");
      }
      const input = usage?.input_tokens,
        output = usage?.output_tokens;
      const cached = usage?.input_tokens_details?.cached_tokens;
      if (
        !actualModel ||
        !integer(input) ||
        !integer(output) ||
        (cached !== undefined && (!integer(cached) || cached > input))
      ) {
        call.usage_unavailable = true;
        halt(
          !actualModel
            ? "natural-model-unavailable"
            : "natural-usage-unavailable",
        );
        return;
      }
      if (
        input > call.reserved_input_tokens ||
        output > call.reserved_output_tokens
      ) {
        halt("natural-provider-token-bound-exceeded");
        throw Error("natural-provider-token-bound-exceeded");
      }
      call.input_tokens = input;
      call.output_tokens = output;
      call.cached_input_tokens = cached ?? null;
      call.cache_state =
        cached === undefined ? "UNKNOWN" : cached ? "HIT" : "MISS";
      const rate = rates(input),
        cache = cached ?? 0;
      call.cost =
        (((input - cache) * maxInputRate + cache * prices.cached_input) *
          rate.input_multiplier +
          output * prices.output * rate.output_multiplier) /
        1e6;
      call.published_rate_estimate_usd =
        (((input - cache) * prices.input + cache * prices.cached_input) *
          rate.input_multiplier +
          output * prices.output * rate.output_multiplier) /
        1e6;
      if (
        cost() > limits.max_cost_usd ||
        totals("input_tokens") > limits.max_total_input_tokens ||
        totals("output_tokens") > limits.max_total_output_tokens
      ) {
        halt("natural-budget-exceeded");
        throw Error("natural-budget-exceeded");
      }
    },
  };
  const bindingFor = (capture, payload) => ({
    task_id: capture.task.id,
    lane: laneOf(capture.task),
    task_sha256: sha256(capture.task),
    request_sha256: sha256(capture.request),
    payload_sha256: sha256(JSON.stringify(payload)),
    capture_sha256: sha256(capture),
    prestate_sha256: sha256(capture.prestate),
    admitted_source_ids: capture.prestate.evidence.map((item) => item.id),
  });
  return {
    assertActive,
    halt,
    budget,
    discipline: { budget },
    authorization: approval,
    get stopReason() {
      return stopped;
    },
    get journalBindings() {
      return structuredClone(registrations);
    },
    assertCredential(value) {
      assertActive();
      if (value !== "Bearer " + apiKey)
        throw Error("natural-credential-mismatch");
    },
    registerCapture(capture, payload, proof) {
      assertActive();
      const task = capture?.task,
        lane = laneOf(task),
        request = capture?.request;
      const captured = lane === "LIVE" ? task?.capture : task?.review;
      const evidence = capture?.prestate?.evidence;
      const admitted = new Set(proof?.admission_ids);
      if (
        !lane ||
        typeof task.id !== "string" ||
        !task.id ||
        !request ||
        typeof request !== "object" ||
        !payload ||
        typeof payload !== "object" ||
        !Array.isArray(task.evidence) ||
        !task.evidence.length ||
        !Array.isArray(evidence) ||
        !evidence.length ||
        !Array.isArray(proof?.admission_ids) ||
        request.version !==
          (lane === "LIVE" ? "v2-live-request-5" : "v2-stage-request-6") ||
        typeof captured?.namespace !== "string" ||
        request.scope !== captured.namespace ||
        !same(request, captured?.request) ||
        !same(request, proof.request) ||
        !same(payload, proof.payload) ||
        Buffer.byteLength(JSON.stringify(request)) > policy.max_request_bytes ||
        !same(payloadProfile(payload), policy.profiles[lane]) ||
        payload.model !== c.model ||
        !same(payload.reasoning, c.configuration.reasoning) ||
        payload.max_output_tokens !== c.max_output_tokens ||
        payload.service_tier !== "default" ||
        payload.store !== false ||
        payload.stream !== true ||
        payload.input[1].content !== JSON.stringify(request) ||
        Object.keys(payload.input[1]).sort().join(",") !== "content,role" ||
        !Object.keys(captured?.sources ?? {}).length ||
        !same(
          Object.keys(captured?.sources ?? {}).sort(),
          Object.keys(captured?.sourceBoundaries ?? {}).sort(),
        ) ||
        new Set(evidence.map((item) => item.id)).size !== evidence.length ||
        evidence.some(
          (item, index) =>
            !admitted.has(item.id) ||
            item.sequence !== index + 1 ||
            typeof item.text !== "string" ||
            !item.text,
        ) ||
        task.evidence.some(
          (item) =>
            !evidence.some(
              (source) => source.id === item.id && same(source, item),
            ),
        )
      )
        throw Error("natural-unapproved-capture");
      const byId = new Map(evidence.map((item) => [item.id, item]));
      const cursors = [
        ...Object.values(captured.sources).flatMap((range) => [
          range.start,
          range.end,
        ]),
        ...Object.values(captured.sourceBoundaries).flatMap(Object.values),
      ];
      if (
        cursors.some((cursor) => {
          if (
            cursor?.evidenceId === null &&
            cursor.sequence === 0 &&
            cursor.offset === 0
          )
            return false;
          const source = cursor && byId.get(cursor.evidenceId);
          return (
            !source ||
            cursor.sequence !== source.sequence ||
            !integer(cursor.offset) ||
            cursor.offset > source.text.length ||
            (cursor.offset > 0 &&
              cursor.offset < source.text.length &&
              /[\uD800-\uDBFF]/.test(source.text[cursor.offset - 1]) &&
              /[\uDC00-\uDFFF]/.test(source.text[cursor.offset]))
          );
        })
      )
        throw Error("natural-unadmitted-source-boundary");
      const binding = bindingFor(capture, payload),
        previous = captures.get(task.id);
      // A retry keeps the captured model task immutable, while its read-only
      // dispatch observation can include source/state admitted during attempt 1.
      // Retain every observed prestate instead of treating it as model input.
      if (
        previous &&
        [
          "task_id",
          "lane",
          "task_sha256",
          "request_sha256",
          "payload_sha256",
        ].some((key) => previous[key] !== binding[key])
      )
        throw Error("natural-capture-identity-drift");
      if (!previous && captures.size >= limits.max_provider_attempts)
        throw Error("natural-capture-limit");
      captures.set(task.id, binding);
      if (!same(previous, binding)) registrations.push(binding);
      return structuredClone(binding);
    },
    reserve(capture, payload, url, method, body) {
      assertActive();
      const taskId = capture?.task?.id,
        registered = captures.get(taskId);
      if (
        !registered ||
        !same(registered, bindingFor(capture, payload)) ||
        String(url) !== NATURAL_PROVIDER_URL ||
        method !== "POST" ||
        typeof body !== "string" ||
        body !== JSON.stringify(payload) ||
        sha256(body) !== registered.payload_sha256
      )
        throw Error("natural-unapproved-request");
      const count = counts.get(taskId) ?? 0;
      if (count >= policy.max_attempts_per_task)
        throw Error("natural-retry-limit");
      if (inFlight.size >= limits.concurrency)
        throw Error("natural-concurrency-limit");
      const input = c.context_window_tokens,
        output = c.max_output_tokens,
        rate = rates(input);
      const reserved =
        (input * maxInputRate * rate.input_multiplier +
          output * prices.output * rate.output_multiplier) /
        1e6;
      if (!Number.isFinite(reserved) || reserved < 0)
        throw Error("natural-invalid-reservation");
      if (
        calls.length >= limits.max_provider_attempts ||
        cost() + reserved > limits.max_cost_usd ||
        totals("input_tokens") + input > limits.max_total_input_tokens ||
        totals("output_tokens") + output > limits.max_total_output_tokens
      )
        throw Error("natural-budget-exceeded");
      const id = taskId + ":attempt-" + (count + 1);
      counts.set(taskId, count + 1);
      calls.push({
        ...registered,
        id,
        run_id: taskId,
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
      inFlight.add(id);
      return id;
    },
    finish(id) {
      if (!inFlight.delete(id))
        throw Error("natural-reservation-not-in-flight");
    },
  };
}
