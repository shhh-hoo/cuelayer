import { open, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  sha256,
  exclusive,
  readJSON,
  EvidenceWriter,
  ExecutionDiscipline,
} from "./evidence.mjs";
import { expectations } from "./contract.mjs";
import { assessCanary, stateContract } from "./assessment.mjs";
import { scoreScenario } from "./score.mjs";
import { assessProjection } from "./projection.mjs";
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
const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

function operationalFailure(attempts, guardError, manifest) {
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

async function runCaptured(verified, snapshot, scope, transport, apiKey, mode) {
  const { manifest, product, out, scenarios } = verified,
    id = snapshot.snapshot_id,
    directory = resolve(out, id);
  await mkdir(directory, { recursive: false });
  const journal = new EvidenceWriter(resolve(directory, "evidence")),
    attempts = [];
  await journal.append("frozen-input", {
    snapshot,
    request_bytes_sha256: sha256(snapshot.payload),
    dependency_mode: mode,
  });
  const store = new product.storage.EventStore(
    "gate3b-canary-" + crypto.randomUUID(),
  );
  let session,
    activeAttempt = null,
    guardError = null,
    validationStart = null,
    acceptancePrestate = null;
  const parsers = [];
  // Only the production SDK can enter this fetch boundary, with this exact request.
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
    const method = init.method ?? input.method,
      body = init.body;
    try {
      scope.assertActive();
      if (
        url !== manifest.provider_url ||
        url !== PROVIDER_URL ||
        method !== "POST" ||
        typeof body !== "string" ||
        body !== JSON.stringify(snapshot.payload) ||
        !same(snapshot.payload.model, manifest.profile.model_requested)
      )
        throw Error("unapproved-provider-request");
      if (activeAttempt) throw Error("unexpected-concurrent-sdk-attempt");
      const reservation = reserveApprovedAttempt(
        manifest,
        scope.authorization,
        scope.discipline,
        id,
        url,
        method,
        body,
      );
      const number = attempts.length + 1,
        start = performance.now();
      const attempt = {
        number,
        reservation,
        started_at: new Date().toISOString(),
        request_bytes_sha256: sha256(body),
        model_requested: manifest.profile.model_requested,
        actual_model: null,
        response_id: null,
        usage: null,
        cached_input_tokens: null,
        raw_response_file: `attempt-${number}-raw-response.bin`,
        provider_error: null,
        terminal_type: null,
        completed: false,
      };
      attempts.push(attempt);
      activeAttempt = attempt;
      await journal.append("attempt-reserved", {
        ...attempt,
        budget_reserved_usd: scope.discipline.budget.cost(),
      });
      const file = await open(
        resolve(directory, attempt.raw_response_file),
        "wx",
        0o600,
      );
      let closed = false;
      attempt.closeRaw = async () => {
        if (!closed) {
          closed = true;
          await file.close();
        }
      };
      let finishPromise;
      attempt.finish = () =>
        (finishPromise ??= (async () => {
          await attempt.closeRaw();
          attempt.latency_ms = performance.now() - start;
          scope.discipline.budget.settle(
            reservation,
            attempt.usage,
            attempt.actual_model,
          );
          const budget = scope.discipline.budget.calls.find(
            (c) => c.id === reservation,
          );
          Object.assign(attempt, {
            completed: true,
            cached_input_tokens: budget.cached_input_tokens,
            cache_state: budget.cache_state,
            cost_upper_bound_usd: budget.cost,
            reserved_cost_usd: budget.cost === null ? budget.reserved : 0,
            published_rate_estimate_usd:
              budget.published_rate_estimate_usd ?? null,
          });
          await exclusive(
            resolve(directory, `attempt-${number}.json`),
            attempt,
          );
          await journal.append("attempt-persisted", attempt);
          activeAttempt = null;
        })());
      // Reservation and request evidence are durable before any network dispatch.
      scope.assertActive();
      let response;
      try {
        response = await transport(input, { ...init, redirect: "error" });
      } catch (error) {
        attempt.provider_error = errorRecord(error);
        throw error;
      }
      attempt.http_status = response.status;
      attempt.response_headers = Object.fromEntries(
        [...response.headers].filter(([k]) =>
          /^(content-type|x-request-id|request-id|retry-after|x-ratelimit-)/i.test(
            k,
          ),
        ),
      );
      await journal.append("provider-headers", {
        number,
        status: response.status,
        headers: attempt.response_headers,
      });
      if (!response.body) return response;
      const reader = response.body.getReader();
      const recorded = new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              await attempt.closeRaw();
              controller.close();
              return;
            }
            await file.write(value);
            attempt.raw_response_bytes =
              (attempt.raw_response_bytes ?? 0) + value.byteLength;
            controller.enqueue(value);
          } catch (error) {
            attempt.stream_error = errorRecord(error);
            await attempt.closeRaw();
            controller.error(error);
          }
        },
        async cancel(reason) {
          await reader.cancel(reason).catch(() => {});
          await attempt.closeRaw();
        },
      });
      return new Response(recorded, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (!activeAttempt || !activeAttempt.provider_error)
        guardError = error.message;
      throw error;
    }
  };
  const requestPort = async (url, init) => {
    if (
      url !== "/api/v2/live" ||
      init.method !== "POST" ||
      init.body !== JSON.stringify(snapshot.request)
    )
      throw Error("captured-host-request-drift");
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, init.signal]);
    const timer = setTimeout(
      () => controller.abort("model-timeout"),
      product.provider.modelProfile.providerTimeoutMs,
    );
    const finalize = async () => {
      clearTimeout(timer);
      if (activeAttempt) await activeAttempt.finish();
    };
    try {
      const upstream = await product.provider.openLiveResponse(
        snapshot.request,
        apiKey,
        manifest.profile.model_requested,
        signal,
      );
      const forwarded = new product.stream.Stream(async function* () {
        try {
          for await (const event of upstream) {
            if (event.response && activeAttempt) {
              activeAttempt.actual_model =
                event.response.model ?? activeAttempt.actual_model;
              activeAttempt.response_id =
                event.response.id ?? activeAttempt.response_id;
              activeAttempt.usage = event.response.usage ?? activeAttempt.usage;
              if (
                [
                  "response.completed",
                  "response.incomplete",
                  "response.failed",
                ].includes(event.type)
              )
                activeAttempt.terminal_type = event.type;
            }
            yield event;
          }
          if (signal.aborted)
            yield { type: "v2.failure", reason: "model-timeout" };
        } catch (error) {
          if (activeAttempt) activeAttempt.stream_error = errorRecord(error);
          yield {
            type: "v2.failure",
            reason: signal.aborted ? "model-timeout" : "model-stream-failed",
          };
        } finally {
          await finalize();
        }
      }, controller);
      return new Response(forwarded.toReadableStream(), {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson",
          "X-V2-Provider-Request-Bytes": String(
            Buffer.byteLength(JSON.stringify(snapshot.payload)),
          ),
        },
      });
    } catch (error) {
      if (activeAttempt) activeAttempt.provider_error = errorRecord(error);
      await finalize();
      const status = Number(error.status) || 0;
      const reason = signal.aborted
        ? "model-timeout"
        : status === 429 || status >= 500
          ? "model-transient"
          : status === 401
            ? "model-auth"
            : "model-request-failed";
      return jsonResponse(reason === "model-transient" ? 503 : 502, {
        error: reason,
        errorType: error.name,
        providerStatus: status,
      });
    }
  };
  const interpreter = product.interpreter.realInterpreter(
    () => session?.trace,
    requestPort,
  );
  const start = performance.now();
  try {
    session = new product.session.Session(
      snapshot.task.sessionId,
      store,
      async (task, signal, first) => {
        let parser;
        try {
          const value = await interpreter(task, signal, first);
          parser = { success: true, value };
          return value;
        } catch (error) {
          const failure = session.trace.spans.findLast(
            (s) => s.name === "model-failure",
          );
          parser = {
            success: false,
            error: error.message,
            output_text: failure?.attributes.output ?? null,
          };
          throw error;
        } finally {
          // Stream cancellation may finish after the parser rejects. Persist it before retry.
          if (activeAttempt) await activeAttempt.finish();
          parsers.push(parser);
          await exclusive(
            resolve(directory, `parser-${parsers.length}.json`),
            parser,
          );
          await journal.append("parser-result", parser);
        }
      },
    );
    session.pause();
    // T1 restores one captured invitation, not a free-running lesson. Pause before
    // hydrating the exact accepted-event prefix so recovery cannot launch extra Stage work.
    let replay = product.contract.emptyReplay();
    for (const event of snapshot.generation.precondition_events) {
      await store.append(event, event.sequence - 1);
      replay = product.contract.fold(replay, event);
    }
    session.value = replay;
    if (!same(session.replay, snapshot.prestate))
      throw Error("restored-precondition-drift");
    const mark = session.trace.mark.bind(session.trace);
    session.trace.mark = (name, ...args) => {
      if (name === "semantic-validation-start") {
        validationStart = Date.now();
        acceptancePrestate = session.replay;
      }
      return mark(name, ...args);
    };
    // Restore the immutable captured invitation. Never recapture new aliases or gold state.
    session.captures.set(snapshot.task.id, structuredClone(snapshot.task));
    const queue = snapshot.task.lane === "Stage" ? session.stage : session.live;
    session.enqueue(structuredClone(snapshot.task), queue);
    queue.start();
    await queue.onIdle();
    const events = await store.read(session.id),
      poststate = session.replay,
      parser = parsers.at(-1);
    const scenario = scenarios.find(
      (s) => s.scenario_id === snapshot.oracle_reference.scenario_id,
    );
    const recorded = {
      ...snapshot,
      prestate: acceptancePrestate ?? snapshot.prestate,
      dependency_mode: mode,
      events,
      poststate,
      validation_clock_interval: {
        before: validationStart ?? Date.now(),
        after: Date.now(),
      },
    };
    // Full real response replaces the local mechanical fixture; the frozen scorer is unchanged.
    const assessment = parser?.success
      ? assessCanary(product, scenario, { ...recorded, response: parser.value })
      : partialAssessment(
          product,
          scenario,
          snapshot,
          events,
          poststate,
          parser,
        );
    const operational = operationalFailure(attempts, guardError, manifest);
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
      poststate,
      host_error: session.error,
      attempts,
      latency_ms: performance.now() - start,
      provider_attempt_count: attempts.length,
      real_provider_attempt_count: mode === "LIVE" ? attempts.length : 0,
      budget: scope.discipline.budget.calls.filter((c) => c.run_id === id),
      provenance: verified.provenance?.snapshot() ?? null,
    };
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
    session?.close();
    if (activeAttempt) await activeAttempt.finish();
    globalThis.fetch = previousFetch;
    await new Promise((r) => setTimeout(r, 0));
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
    discipline.budget.profile = { ...manifest.profile, max_cost_usd: Infinity, max_requests: Infinity };
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
      if (continuation?.retained_runs.some((r) => r.run_id === snapshot.snapshot_id)) continue;
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
      );
      // Raw attempts, parser, assessment and actual host events have all been persisted.
      discipline.finish(current, result);
      if (continuation?.pending_adjudication_policy &&
          result.adjudication_status === "ADJUDICATION_REQUIRED" &&
          !result.hard_fail && result.status !== "INVALID") {
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
      : results.some((r) => r.adjudication_status === "ADJUDICATION_REQUIRED") ||
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
    ...(continuation ? {
      prior_provider_attempts: continuation.prior_budget.length,
      new_provider_attempts: discipline.budget.calls.length - continuation.prior_budget.length,
      continuation,
    } : {}),
    real_provider_attempts:
      mode === "LIVE" ? discipline.budget.calls.length : 0,
    budget: discipline.budget.calls,
    accounted_cost_upper_bound_usd: discipline.budget.cost(),
    next_phase_eligible: status === "PASS",
    other_phases: "NOT_RUN",
    finished_at: new Date().toISOString(),
  };
  await exclusive(resolve(out, "execution-result.json"), report);
  return report;
}

export async function executeAuthorized(manifestPath, authorizationPath) {
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
  );
}
