import { writeFile, mkdir, readFile } from "node:fs/promises";
import pRetry from "p-retry";
import { resolve } from "node:path";
import {
  sha256,
  exclusive,
  readJSON,
  EvidenceWriter,
  ExecutionDiscipline,
  recordResponse,
  executionCounts,
  executionPhaseDurations,
} from "./evidence.mjs";
import { expectations } from "./contract.mjs";
import { assessCanary, stateContract } from "./assessment.mjs";
import { scoreScenario } from "./score.mjs";
import { assessProjection } from "./projection.mjs";
import { SHARED_EXECUTION_IDENTITY } from "./shared-execution-manifest.mjs";
import {
  verifyExecution,
  validateAuthorization,
  PROVIDER_URL,
  CANARIES,
} from "./execution-manifest.mjs";
const same = (a, b) => sha256(a) === sha256(b);
const errorRecord = (e) => ({
  name: e?.name ?? "Error",
  code: e?.code ?? null,
  status: Number(e?.status) || null,
});
const executionFailure = (error) => {
  const reason = error?.message ?? "execution-failed";
  return {
    reason,
    category:
      /timeout|deadline/i.test(reason) || error?.name === "TimeoutError"
        ? "deadline"
        : /abort|cancel/i.test(reason) || error?.name === "AbortError"
          ? "cancel"
          : /malformed-json|schema-invalid/.test(reason)
            ? "parse"
            : "transport",
  };
};
const aggregate = (rows) =>
  rows.some((r) => r.status === "FAIL")
    ? "FAIL"
    : rows.some((r) => r.status === "INVALID")
      ? "INVALID"
      : rows.some((r) => r.status === null)
        ? null
        : rows.some((r) => r.status === "NOT_EXERCISED")
          ? "NOT_EXERCISED"
          : rows.length
            ? "PASS"
            : "NOT_EXERCISED";

export function reserveApprovedAttempt(
  manifest,
  authorization,
  discipline,
  id,
  url,
  method,
  body,
) {
  validateAuthorization(manifest, authorization);
  const canary = manifest.canaries.find((c) => c.snapshot_id === id);
  if (
    url !== PROVIDER_URL ||
    url !== manifest.provider_url ||
    method !== "POST" ||
    typeof body !== "string" ||
    !canary ||
    sha256(body) !== canary.request_sha256
  )
    throw Error("unapproved-provider-request");
  return discipline.reserve(id);
}

function partialAssessment(
  product,
  scenario,
  snapshot,
  events,
  poststate,
  parser,
) {
  // No repaired JSON or invented proposal is fed to the semantic oracle.
  const projection = assessProjection(
    {
      task: snapshot.task,
      replay: snapshot.prestate,
      request: snapshot.request,
    },
    snapshot.requirements,
  );
  const host = {
    expected_accepted: false,
    actual_accepted: events.some(
      (e) => e.type === "accepted" && e.accepted.taskId === snapshot.task.id,
    ),
    expected_state: stateContract(snapshot.prestate),
    actual_state: stateContract(poststate),
    timestamp_contract_valid: true,
  };
  const observations = Object.fromEntries(
    expectations(scenario).map((p) => [
      p.expectation_id,
      {
        projection,
        host,
        response_complete: false,
        schema_valid: parser?.output_text ? false : undefined,
        location: {
          boundary: p.owner_layer,
          causal_order:
            p.owner_layer === "C" ? 1 : p.owner_layer === "D" ? 2 : 3,
          causal_event: snapshot.task.id,
          predicate_id: p.predicate_id,
        },
      },
    ]),
  );
  return scoreScenario(scenario, {
    started: true,
    validity_verified: true,
    observations,
    timeline: scenario.transcript_events.map((e) => ({
      ...e,
      evaluator_dispatch_at: e.at_ms,
      page_received_at: e.at_ms,
      admitted_at: snapshot.prestate.evidence.some(
        (x) => x.id === e.event_id && x.text === e.text,
      )
        ? e.at_ms
        : undefined,
    })),
  });
}

function operationalFailure(attempts, guardError, manifest, failure) {
  if (guardError)
    return {
      status: "INVALID",
      reason: guardError,
      owner_layer: "A",
      boundary: "execution-policy",
    };
  const identified = attempts.filter((a) => a.actual_model);
  if (
    identified.some(
      (a) => !manifest.actual_model_allowlist.includes(a.actual_model),
    )
  )
    return {
      status: "INVALID",
      reason: "provider-model-identity-drift",
      owner_layer: "A",
      boundary: "provider-identity",
    };
  const last = attempts.at(-1);
  if (last?.terminal_type === "response.completed" && !last.actual_model)
    return {
      status: "INVALID",
      reason: "provider-model-identity-missing",
      owner_layer: "A",
      boundary: "provider-identity",
    };
  if (["deadline", "cancel"].includes(failure?.category))
    return {
      status: null,
      reason: failure.reason,
      failure_category: failure.category,
      adjudication_status: "ADJUDICATION_REQUIRED",
      owner_layer: "A",
      boundary: "request-deadline",
    };
  if (last?.provider_error) {
    const { status, code } = last.provider_error;
    if (
      code === "insufficient_quota" ||
      status === 401 ||
      status === 403 ||
      status >= 500
    )
      return {
        status: "INVALID",
        reason: "external-provider-account-or-outage",
        owner_layer: "A",
        boundary: "provider-availability",
      };
    if (status === 400 || status === 422)
      return {
        status: "FAIL",
        reason: "provider-request-contract-rejected",
        owner_layer: "D",
        boundary: "provider-contract",
      };
    return {
      status: null,
      reason: "provider-fault-attribution-required",
      adjudication_status: "ADJUDICATION_REQUIRED",
      owner_layer: "A",
      boundary: "provider-availability",
    };
  }
  return null;
}

export async function runCaptured(
  verified,
  snapshot,
  scope,
  transport,
  apiKey,
  mode,
  writeDiagnostic = exclusive,
) {
  const { manifest, product, out, scenarios } = verified;
  if (
    !product.execution ||
    !product.providerExecution ||
    !product.acceptanceEvent
  )
    throw Error(
      "shared-product-execution-required: use the historical evaluator SHA for old manifests",
    );
  const id = snapshot.snapshot_id,
    directory = resolve(out, id);
  await mkdir(directory, { recursive: false });
  const journal = new EvidenceWriter(resolve(directory, "evidence"));
  await journal.append("frozen-input", {
    snapshot,
    request_bytes_sha256: sha256(snapshot.payload),
    dependency_mode: mode,
  });
  const store = new product.storage.EventStore(
    "shared-canary-" + crypto.randomUUID(),
  );
  const attempts = [],
    parsers = [],
    recordings = new Map();
  const start = performance.now(),
    clockId = `monotonic:${performance.timeOrigin}`;
  let replay = product.contract.emptyReplay(),
    activeAttempt = null,
    guardError = null;
  let phases = [],
    validationStart = null,
    validationEnd = null,
    hostError = null,
    executionError = null,
    acceptancePrestate = null,
    timer = null;
  const deadline = new AbortController();

  const observe = (event) => {
    if (phases.length < 128) {
      const { output, ...details } = event.details;
      phases.push({ ...event, details });
    }
    if (event.phase === "upstream-terminal" && activeAttempt)
      setProvider(activeAttempt, event.details);
  };
  const phase = (name, details = {}) =>
    observe({ phase: name, at: performance.now(), clockId, details });
  function setProvider(attempt, provider) {
    if (!provider) return;
    attempt.provider_completed ||= provider.completed === true;
    attempt.terminal_type = provider.terminalType ?? attempt.terminal_type;
    attempt.actual_model = provider.actualModel ?? attempt.actual_model;
    attempt.response_id = provider.responseId ?? attempt.response_id;
    attempt.usage = provider.usage ?? attempt.usage;
  }
  function settleAttempt(attempt) {
    if (!attempt) return;
    // Release known usage synchronously before another retry can reserve cost.
    scope.discipline.budget.settle(
      attempt.reservation,
      attempt.usage,
      attempt.actual_model,
    );
    const budget = scope.discipline.budget.calls.find(
      (c) => c.id === attempt.reservation,
    );
    Object.assign(attempt, {
      cached_input_tokens: budget.cached_input_tokens,
      cache_state: budget.cache_state,
      cost_upper_bound_usd: budget.cost,
      reserved_cost_usd: budget.cost === null ? budget.reserved : 0,
      published_rate_estimate_usd: budget.published_rate_estimate_usd ?? null,
    });
  }
  async function persistAttempt(attempt) {
    attempt.phase_latency_ms = executionPhaseDurations(attempt.phases);
    const recording = recordings.get(attempt.number);
    const raw = recording?.bytes() ?? Buffer.alloc(0);
    attempt.raw_evidence = recording?.evidence ?? {
      complete: false,
      observed_bytes: 0,
      retained_bytes: 0,
      reason: "no-provider-response",
    };
    attempt.raw_evidence.recording_complete =
      !attempt.raw_evidence.truncated &&
      attempt.raw_evidence.observed_bytes ===
        attempt.raw_evidence.retained_bytes;
    attempt.raw_evidence.complete_through_terminal =
      Boolean(attempt.terminal_type) && attempt.raw_evidence.recording_complete;
    attempt.raw_response_bytes = raw.byteLength;
    if (attempt.http_status >= 400) {
      let body;
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        /* Raw evidence remains authoritative. */
      }
      attempt.provider_error = {
        status: attempt.http_status,
        code: body?.error?.code ?? null,
        name: body?.error?.type ?? "ProviderHTTPError",
      };
    }
    const persistedAt = performance.now();
    try {
      await writeFile(resolve(directory, attempt.raw_response_file), raw, {
        flag: "wx",
        mode: 0o600,
      });
      attempt.raw_evidence.persisted = true;
    } catch (error) {
      attempt.raw_evidence.persisted = false;
      attempt.raw_evidence.persistence_error = errorRecord(error);
    }
    attempt.evidence_write_ms = performance.now() - persistedAt;
    await writeDiagnostic(
      resolve(directory, `attempt-${attempt.number}.json`),
      attempt,
    );
    await journal.append("attempt-persisted", attempt);
  }
  const guardedFetch = async (input, init = {}) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
    const method = init.method ?? input.method,
      body = init.body;
    let reservation;
    try {
      scope.assertActive();
      if (
        body !== JSON.stringify(snapshot.payload) ||
        snapshot.payload.model !== manifest.profile.model_requested ||
        activeAttempt
      )
        throw Error("unapproved-provider-request");
      reservation = reserveApprovedAttempt(
        manifest,
        scope.authorization,
        scope.discipline,
        id,
        url,
        method,
        body,
      );
    } catch (error) {
      guardError = error.message;
      throw error;
    }
    const attempt = {
      number: attempts.length + 1,
      reservation,
      started_at: new Date().toISOString(),
      request_bytes_sha256: sha256(body),
      model_requested: manifest.profile.model_requested,
      actual_model: null,
      response_id: null,
      usage: null,
      provider_error: null,
      terminal_type: null,
      attempt_finished: false,
      provider_completed: false,
      parser_succeeded: false,
      host_accepted: false,
      raw_response_file: `attempt-${attempts.length + 1}-raw-response.bin`,
      phases,
      clock_id: clockId,
    };
    attempts.push(attempt);
    activeAttempt = attempt;
    const reservedAt = performance.now();
    await journal.append("attempt-reserved", {
      ...attempt,
      budget_reserved_usd: scope.discipline.budget.cost(),
    });
    attempt.reservation_write_ms = performance.now() - reservedAt;
    scope.assertActive();
    phase("network-dispatch");
    try {
      const response = await transport(input, { ...init, redirect: "error" });
      attempt.http_status = response.status;
      attempt.response_headers = Object.fromEntries(
        [...response.headers].filter(([k]) =>
          /^(content-type|x-request-id|request-id|retry-after|x-ratelimit-)/i.test(
            k,
          ),
        ),
      );
      const recording = recordResponse(response);
      recordings.set(attempt.number, recording);
      return recording.response;
    } catch (error) {
      attempt.provider_error = errorRecord(error);
      throw error;
    }
  };
  try {
    for (const event of snapshot.generation.precondition_events) {
      await store.append(event, event.sequence - 1);
      replay = product.contract.fold(replay, event);
    }
    if (!same(replay, snapshot.prestate))
      throw Error("restored-precondition-drift");
    const capture = product.execution.capturedRequest(snapshot.task);
    if (!same(capture.request, snapshot.request))
      throw Error("captured-host-request-drift");
    let completed;
    const executionStarted = performance.now();
    timer = setTimeout(
      () =>
        deadline.abort(
          new DOMException("Live/Stage deadline exceeded", "TimeoutError"),
        ),
      manifest.profile.host_deadline_ms,
    );
    try {
      completed = await pRetry(
        async () => {
          phases = [];
          const attemptStart = performance.now();
          let parser;
          try {
            const result = await product.execution.executeCapturedRequest(
              capture,
              {
                signal: deadline.signal,
                observe,
                clockId,
                transport: (captured, signal) =>
                  product.providerExecution.providerResponse(captured.request, {
                    apiKey,
                    model: manifest.profile.model_requested,
                    signal,
                    fetch: guardedFetch,
                    observe,
                    clockId,
                    forwardObservations: false,
                    timeoutMs: manifest.profile.provider_deadline_ms,
                  }),
              },
            );
            parser = {
              success: true,
              value: result.proposal,
              output_text: result.outputText,
            };
            if (activeAttempt) {
              setProvider(activeAttempt, result.provider);
              activeAttempt.parser_succeeded = true;
            }
            return result;
          } catch (error) {
            parser = {
              success: false,
              error: error.message,
              output_text: error.outputText || null,
            };
            if (activeAttempt) {
              setProvider(activeAttempt, error.provider);
              activeAttempt.execution_error = errorRecord(error);
              activeAttempt.execution_failure = executionFailure(error);
            }
            throw error;
          } finally {
            const attempt = activeAttempt;
            if (attempt) {
              attempt.attempt_finished = true;
              attempt.latency_ms = performance.now() - attemptStart;
              attempt.phases = phases;
            }
            parsers.push(parser);
            settleAttempt(attempt);
            activeAttempt = null;
            // Bounded diagnostics remain in memory until host execution settles.
            // Neither a parser file nor a failed attempt write consumes retry time.
          }
        },
        {
          retries: manifest.profile.transport_retries,
          minTimeout: manifest.profile.retry_min_ms,
          factor: manifest.profile.retry_factor,
          signal: deadline.signal,
          shouldRetry: ({ error }) =>
            error instanceof product.execution.TransientFailure,
        },
      );
      deadline.signal.throwIfAborted();
      acceptancePrestate = structuredClone(replay);
      validationStart = Date.now();
      phase("host-validation-start");
      const accepted =
        snapshot.task.lane === "Stage"
          ? product.stage.validateStage(
              replay,
              snapshot.task,
              completed.proposal,
            )
          : product.acceptance.validate(
              replay,
              snapshot.task,
              completed.proposal,
            );
      const payload = product.acceptanceEvent.decisionEventPayload(
        snapshot.task,
        accepted,
      );
      phase("host-validation-complete");
      const sequence = replay.sequence + 1;
      const event = {
        ...payload,
        schema: "cuelayer-v2-event-3",
        sessionId: snapshot.task.sessionId,
        id: `${snapshot.task.sessionId}:${sequence}`,
        sequence,
        at: Date.now(),
      };
      const next = product.contract.fold(replay, event);
      phase("persistence-start");
      await store.append(event, replay.sequence);
      replay = next;
      phase("persistence-complete");
      validationEnd = Date.now();
      const attempt = attempts.at(-1);
      if (attempt) {
        attempt.host_accepted = payload.type === "accepted";
        attempt.host_decision_persisted = true;
      }
      phase(payload.type === "accepted" ? "host-accepted" : "host-inspected");
    } catch (error) {
      hostError = error.message;
      if (validationStart !== null)
        phase("host-rejected", { reason: hostError });
      else executionError = executionFailure(error);
      validationEnd = Date.now();
    } finally {
      clearTimeout(timer);
    }
    const executionFinished = performance.now(),
      diagnosticStarted = performance.now();
    for (const [index, parser] of parsers.entries()) {
      await writeDiagnostic(
        resolve(directory, `parser-${index + 1}.json`),
        parser,
      );
      await journal.append("parser-result", parser);
    }
    for (const attempt of attempts) await persistAttempt(attempt);
    const diagnosticWriteMs = performance.now() - diagnosticStarted;
    const events = await store.read(snapshot.task.sessionId),
      parser = parsers.at(-1);
    const scenario = scenarios.find(
      (s) => s.scenario_id === snapshot.oracle_reference.scenario_id,
    );
    const recorded = {
      ...snapshot,
      prestate: acceptancePrestate ?? snapshot.prestate,
      dependency_mode: mode,
      events,
      poststate: replay,
      validation_clock_interval: {
        before: validationStart ?? Date.now(),
        after: validationEnd ?? Date.now(),
      },
    };
    const assessment = parser?.success
      ? assessCanary(product, scenario, { ...recorded, response: parser.value })
      : partialAssessment(product, scenario, snapshot, events, replay, parser);
    let operational = operationalFailure(
      attempts,
      guardError,
      manifest,
      executionError,
    );
    if (
      attempts.some(
        (a) => !a.raw_evidence.persisted || !a.raw_evidence.recording_complete,
      )
    )
      operational ??= {
        status: "INVALID",
        reason: "raw-evidence-incomplete",
        owner_layer: "A",
        boundary: "evidence-recording",
      };
    const applicable = assessment.results.filter(
      (r) =>
        r.required && ["A", "B", "C", "D", "E", "G"].includes(r.owner_layer),
    );
    const status =
      operational?.status ?? (operational ? null : aggregate(applicable));
    const result = {
      snapshot_id: id,
      status,
      dependency_mode: mode,
      assessment,
      operational,
      hard_fail: assessment.hard_fail,
      semantic_score_available: parser?.success === true,
      adjudication_status:
        operational?.adjudication_status ?? assessment.adjudication_status,
      first_violated_boundary:
        operational ?? assessment.first_violated_boundary,
      layers: Object.fromEntries(
        ["A", "B", "C", "D", "E", "G"].map((l) => [
          l,
          operational?.owner_layer === l
            ? operational.status
            : aggregate(
                assessment.results.filter(
                  (r) => r.owner_layer === l && r.required,
                ),
              ),
        ]),
      ),
      parser: parser ?? null,
      events,
      acceptance_prestate: acceptancePrestate,
      poststate: replay,
      host_error: hostError,
      execution_failure: executionError,
      attempts,
      clock_id: clockId,
      latency_ms: executionFinished - start,
      setup_ms: executionStarted - start,
      execution_ms: executionFinished - executionStarted,
      diagnostic_write_ms: diagnosticWriteMs,
      provider_attempt_count: attempts.length,
      real_provider_attempt_count: mode === "LIVE" ? attempts.length : 0,
      budget: scope.discipline.budget.calls.filter((c) => c.run_id === id),
      provenance: verified.provenance?.snapshot() ?? null,
    };
    result.execution_counts = executionCounts([result]);
    await journal.append("acceptance-and-assessment", result);
    await exclusive(resolve(directory, "result.json"), result);
    if (result.adjudication_status === "ADJUDICATION_REQUIRED")
      await exclusive(resolve(directory, "adjudication-package.json"), {
        scenario,
        adjudication_rules: scenario.adjudication_rules,
        snapshot,
        result,
        manifest_sha256: sha256(manifest),
        instruction:
          "Apply these frozen rules. Do not rewrite the machine assessment.",
      });
    await journal.pending;
    return result;
  } finally {
    clearTimeout(timer);
    deadline.abort();
    await store.delete();
  }
}

async function execute(
  verified,
  authorization,
  transport,
  apiKeyReader,
  mode,
  checkIntegrity,
  writeDiagnostic,
) {
  const { manifest, out } = verified;
  validateAuthorization(manifest, authorization);
  if (
    !same(
      manifest.canaries.map((c) => c.snapshot_id),
      CANARIES,
    ) ||
    manifest.provider_url !== PROVIDER_URL
  )
    throw Error("unapproved-model-or-cohort");
  await checkIntegrity();
  // Exclusive lock prevents replacement runs, reuse, and concurrent budget owners.
  await exclusive(resolve(out, "execution-start.json"), {
    manifest_sha256: sha256(manifest),
    authorization,
    dependency_mode: mode,
    started_at: new Date().toISOString(),
  });
  const discipline = new ExecutionDiscipline(manifest.cohort, manifest.profile);
  const continuation = manifest.continuation;
  if (continuation) {
    // This separately authorized administrative amendment changes only the budget.
    // Keep prior paid evidence and never dispatch an already exercised canary.
    discipline.budget.profile = {
      ...manifest.profile,
      max_cost_usd: Infinity,
      max_requests: Infinity,
    };
    discipline.budget.calls = structuredClone(continuation.prior_budget);
    for (const row of continuation.retained_runs) {
      const index = discipline.runs.findIndex((r) => r.run_id === row.run_id);
      discipline.runs[index] = structuredClone(row);
    }
  }
  discipline.preflight("PASS");
  const results = [];
  let current = null;
  try {
    const apiKey = await apiKeyReader();
    if (!apiKey) throw Error("openai-credential-missing");
    for (const { snapshot } of verified.snapshots) {
      if (discipline.stopped) break;
      if (
        continuation?.retained_runs.some(
          (r) => r.run_id === snapshot.snapshot_id,
        )
      )
        continue;
      await checkIntegrity();
      validateAuthorization(manifest, authorization);
      current = snapshot.snapshot_id;
      discipline.begin(current);
      const result = await runCaptured(
        verified,
        snapshot,
        {
          discipline,
          authorization,
          assertActive: () => validateAuthorization(manifest, authorization),
        },
        transport,
        apiKey,
        mode,
        writeDiagnostic,
      );
      // Raw attempts, parser, assessment and actual host events have all been persisted.
      discipline.finish(current, result);
      if (
        continuation?.pending_adjudication_policy &&
        result.adjudication_status === "ADJUDICATION_REQUIRED" &&
        !result.hard_fail &&
        result.status !== "INVALID"
      ) {
        // Explicitly authorized collection preserves pending status and evidence.
        // It never resolves the adjudication or enables a subsequent Gate phase.
        discipline.stopped = false;
      }
      results.push(result);
      current = null;
    }
  } catch (error) {
    await exclusive(resolve(out, "execution-error.json"), {
      error: errorRecord(error),
      reason: error.message,
      active_canary: current,
    });
    if (
      current &&
      !discipline.runs.find((r) => r.run_id === current).result_recorded
    )
      discipline.finish(current, { status: "INVALID" });
    discipline.stopped = true;
  }
  const status = discipline.runs.every((r) => r.status === "PASS")
    ? "PASS"
    : discipline.runs.some((r) => r.status === "FAIL")
      ? "FAIL"
      : results.some(
            (r) => r.adjudication_status === "ADJUDICATION_REQUIRED",
          ) ||
          discipline.runs.some((r) => r.result_recorded && r.status === null)
        ? null
        : "INVALID";
  const report = {
    gate: "3b-1",
    status,
    manifest_sha256: sha256(manifest),
    dependency_mode: mode,
    canaries: discipline.runs,
    actual_provider_attempts: discipline.budget.calls.length,
    execution_counts: executionCounts(results),
    ...(continuation
      ? {
          prior_provider_attempts: continuation.prior_budget.length,
          new_provider_attempts:
            discipline.budget.calls.length - continuation.prior_budget.length,
          continuation,
        }
      : {}),
    real_provider_attempts:
      mode === "LIVE" ? discipline.budget.calls.length : 0,
    budget: discipline.budget.calls,
    accounted_cost_upper_bound_usd: discipline.budget.cost(),
    next_phase_eligible: mode === "LIVE" && status === "PASS",
    other_phases: "NOT_RUN",
    finished_at: new Date().toISOString(),
  };
  await exclusive(resolve(out, "execution-result.json"), report);
  return report;
}

export async function executeAuthorized(manifestPath, authorizationPath) {
  const selected = await readJSON(manifestPath);
  if (selected.identity !== SHARED_EXECUTION_IDENTITY)
    throw Error(
      `historical-execution-requires-recorded-evaluator:${selected.evaluator_sha}`,
    );
  // No credentials or provider connection before both integrity and authorization checks.
  const verified = await verifyExecution(manifestPath),
    authorization = await readJSON(authorizationPath);
  validateAuthorization(verified.manifest, authorization);
  if (
    process.env.OPENAI_MODEL &&
    process.env.OPENAI_MODEL !== verified.manifest.profile.model_requested
  )
    throw Error("unapproved-model-environment");
  if (
    process.env.OPENAI_BASE_URL &&
    process.env.OPENAI_BASE_URL !== "https://api.openai.com/v1"
  )
    throw Error("unapproved-provider-environment");
  if (
    process.env.CUELAYER_V2_OBSERVATION_MS &&
    Number(process.env.CUELAYER_V2_OBSERVATION_MS) !== 6000
  )
    throw Error("unapproved-deadline-environment");
  return execute(
    verified,
    authorization,
    globalThis.fetch.bind(globalThis),
    () => process.env.OPENAI_API_KEY,
    "LIVE",
    () => verifyExecution(manifestPath),
  );
}

// The only test seam requires an injected transport and cannot obtain real credentials.
export async function exerciseExecution(
  verified,
  authorization,
  simulatedTransport,
  { writeDiagnostic = exclusive } = {},
) {
  if (typeof simulatedTransport !== "function")
    throw Error("simulated-transport-required");
  return execute(
    verified,
    authorization,
    simulatedTransport,
    () => "unpaid-test-key",
    "STUB",
    async () => {},
    writeDiagnostic,
  );
}
