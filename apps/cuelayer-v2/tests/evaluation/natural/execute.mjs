import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startBrowserHarness, clockMapping, now } from "../browser.mjs";
import { drive } from "../driver.mjs";
import {
  EvidenceWriter,
  exclusive,
  readJSON,
  recordResponse,
  sha256,
} from "../evidence.mjs";
import { settleCandidateAttempt } from "../qualification/provider.mjs";
import {
  summarizeNaturalPerformance,
  naturalArrivalFidelity,
} from "./performance.mjs";
export { summarizeNaturalPerformance as naturalPerformance } from "./performance.mjs";
import { verifyNatural } from "./manifest.mjs";
import { createNaturalScope } from "./guard.mjs";
import { verifyNaturalAssets } from "./assets.mjs";
import {
  armNaturalObserver,
  naturalCheckpoint,
  admitNaturalTranscript,
  flushNaturalObserver,
  reloadNaturalObserver,
} from "./observer.mjs";

const same = (a, b) => sha256(a) === sha256(b);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function duration(phases, start, end, successful = false) {
  const a = phases.find((p) => p.phase === start);
  const b = phases.find(
    (p) => p.phase === end && (!successful || p.details.completed === true),
  );
  return a && b && a.clockId === b.clockId && b.at >= a.at ? b.at - a.at : null;
}

export function naturalMechanicalChecks(product, lesson, result) {
  const checks = [];
  const check = (id, condition, reason) =>
    checks.push({ id, status: condition ? "PASS" : "FAIL", reason });
  const after = result.checkpoints.find(
    (c) => c.id === "post_reload",
  )?.snapshot;
  const before = result.checkpoints.find(
    (c) => c.id === "pre_reload",
  )?.snapshot;
  const observed = lesson.transcript_events.flatMap(
    (e) =>
      result.admissions.find((a) => a.event_id === e.event_id)?.evidence ?? [],
  );
  const empty = result.checkpoints.find((c) => c.id === "empty")?.snapshot;
  check(
    "empty-baseline",
    Boolean(empty) &&
      empty.events.length === 0 &&
      same(empty.replay, product.contract.emptyReplay()),
    "The run starts from an empty real Session with no authored preconditions.",
  );
  check(
    "complete-formal-admission",
    result.admissions.length === lesson.transcript_events.length &&
      lesson.transcript_events.every((event) => {
        const a = result.admissions.find((x) => x.event_id === event.event_id);
        return (
          a?.status === "ADMITTED" &&
          a.evidence?.length === 1 &&
          a.evidence[0].text === event.text &&
          a.evidence[0].stability === "COMMITTED" &&
          a.evidence[0].audioObservedAt === null
        );
      }),
    "Every frozen final must be durably admitted once through speech.receive, with exact text.",
  );
  check(
    "durable-source-integrity",
    Boolean(after) &&
      same(after.replay.evidence, observed) &&
      new Set(observed.map((e) => e.id)).size === observed.length,
    "Reload evidence equals the actual admitted evidence, including identities and source metadata.",
  );
  check(
    "reload-exact-history",
    Boolean(before && after) &&
      same(before.events, after.events) &&
      same(before.replay, after.replay),
    "Reload uses the same actual IndexedDB history; no seeded accepted events.",
  );
  check(
    "event-fold-integrity",
    Boolean(after) &&
      result.checkpoints.length > 0 &&
      result.checkpoints.every((checkpoint) => {
        let folded = product.contract.emptyReplay();
        try {
          for (const event of checkpoint.snapshot.events)
            folded = product.contract.fold(folded, event);
        } catch {
          return false;
        }
        return same(folded, checkpoint.snapshot.replay);
      }),
    "Every retained checkpoint replay equals the fold of its exact durable event prefix.",
  );
  check(
    "all-source-accounted",
    Boolean(after) && same(after.replay.recorded, after.replay.accounted),
    "Live accounting must reach recorded evidence; unresolved meaning is reviewed separately.",
  );
  const scheduledCheckpoints = [
    ...lesson.checkpoints,
    { id: "input_end", at_ms: lesson.duration_ms },
  ];
  check(
    "checkpoint-coverage",
    scheduledCheckpoints.every((expected) => {
      const actual = result.checkpoints.filter((c) => c.id === expected.id);
      return (
        actual.length === 1 &&
        actual[0].at_ms === expected.at_ms &&
        actual[0].within_observation_tolerance === true
      );
    }),
    "Each required checkpoint is acquired on its frozen schedule within the explicit observation tolerance; storage completion cannot move its anchor.",
  );
  const endCheckpoint = result.checkpoints.find((c) => c.id === "input_end"),
    inputEnd = endCheckpoint?.snapshot;
  check(
    "input-end-accounted",
    endCheckpoint?.within_observation_tolerance === true &&
      Boolean(inputEnd) &&
      same(inputEnd.replay.recorded, inputEnd.replay.accounted),
    "The last frozen arrival is at 82s and this lesson's completion checkpoint is 97s; post-input drain cannot substitute. This is not a general capacity claim.",
  );
  check(
    "source-during-inference",
    result.admissions.some((a) =>
      result.requests.some(
        (r) =>
          a.clockId === r.clockId &&
          a.page_received_at > r.product_at &&
          result.observations.some(
            (o) =>
              o.type === "trace" &&
              o.clockId === a.clockId &&
              o.span.name === "model-attempt-finished" &&
              o.span.attributes.attemptId === r.attempt_id &&
              o.span.start > a.page_received_at,
          ),
      ),
    ),
    "At least one real final arrives between an actual request and its attempt finish; no provider stall is inserted in a paid run.",
  );
  check(
    "no-provider-on-reload",
    Number.isFinite(result.reload_started_at) &&
      !result.attempts.some((a) => a.started_at >= result.reload_started_at),
    "Reload must restore the recorded lesson without a new provider call.",
  );
  check(
    "observer-integrity",
    !result.observations.some((o) => o.type === "observer-error"),
    "Read-only observation did not lose required captures.",
  );
  check(
    "attempt-evidence",
    result.attempts.every(
      (a) =>
        a.reservation &&
        a.raw_sha256 &&
        a.attempt_finished &&
        !a.raw?.truncated,
    ),
    "Every dispatched attempt has reserved cost and sealed bounded raw evidence, including failures.",
  );
  check(
    "driver-fidelity",
    result.driver?.fidelity?.status === "PASS",
    "Arrival timing is measured independently of inference and drain.",
  );
  check(
    "browser-arrival-fidelity",
    naturalArrivalFidelity(result, lesson).status === "PASS",
    "Every browser receipt maps to exactly one frozen source and a valid clock/schedule; actual delivery lateness remains descriptive product evidence.",
  );
  check(
    "execution-policy",
    result.failures.length === 0,
    "Policy, browser and recording failures remain explicit.",
  );
  return checks;
}

export async function runNatural(
  verified,
  approval,
  transport,
  apiKey,
  { mode = "LIVE" } = {},
) {
  const { manifest, product, provenance, lesson } = verified;
  if (
    !["LIVE", "STUB"].includes(mode) ||
    (mode === "LIVE" && (manifest.test_only || approval?.test_only))
  )
    throw Error("natural-test-authorization-not-live");
  const scope = createNaturalScope(manifest, approval, apiKey);
  const renderer = manifest.renderer_assets
    ? await verifyNaturalAssets(manifest.renderer_assets)
    : null;
  if (mode === "LIVE" && !renderer)
    throw Error("natural-frozen-renderer-assets-required");
  const out = resolve(verified.out, "execution");
  await mkdir(out, { recursive: false });
  const journal = new EvidenceWriter(resolve(out, "journal"));
  await exclusive(resolve(out, "execution-start.json"), {
    manifest_sha256: sha256(manifest),
    approval,
    approval_sha256: sha256(approval),
    dependency_mode: mode,
    started_at: new Date().toISOString(),
  });
  await exclusive(
    resolve(out, "planned-arrivals.json"),
    lesson.transcript_events.map((e) => ({ ...e, status: "NOT_RUN" })),
  );
  const admissions = [],
    checkpoints = [],
    attempts = [],
    failures = [],
    writes = [],
    active = new Set(),
    pendingAdmissions = new Set();
  let h,
    timeline,
    clock_start,
    browser_graph = null,
    reload_started_at = null,
    stop = null;
  const fail = (boundary, error) => {
    const reason = error?.message ?? String(error);
    failures.push({ boundary, reason });
    stop ??= reason;
    scope.halt(reason);
  };
  const enqueue = (operation) => {
    const promise = Promise.resolve()
      .then(operation)
      .catch((error) => fail("diagnostic-persistence", error));
    writes.push(promise);
  };
  const providerBridge = async ({
    captured,
    request,
    payload,
    signal,
    deadline,
  }) => {
    const capture = { ...captured, request };
    const generated = product.execution.capturedRequest(captured.task);
    const generatedPayload = await product.provider.liveRequest(
      generated.request,
    );
    try {
      const known = new Set(admissions.flatMap((a) => a.evidence_ids ?? []));
      if (captured.prestate.evidence.some((e) => !known.has(e.id))) {
        let aborted;
        try {
          await Promise.race([
            Promise.all([...pendingAdmissions]),
            new Promise((_, reject) => {
              aborted = () => reject(Error("natural-admission-proof-timeout"));
              deadline.controller.signal.addEventListener("abort", aborted, {
                once: true,
              });
              if (deadline.controller.signal.aborted) aborted();
            }),
          ]);
        } finally {
          deadline.controller.signal.removeEventListener("abort", aborted);
        }
      }
      scope.registerCapture(capture, payload, {
        request: generated.request,
        payload: generatedPayload,
        admission_ids: admissions.flatMap((a) => a.evidence_ids ?? []),
      });
    } catch (error) {
      fail("provider-guard", error);
      throw error;
    }
    const attempt = {
      index: attempts.length + 1,
      task_id: captured.task.id,
      lane: captured.task.lane,
      started_at: now(),
      provider_dispatched: false,
      browser_attempt_id: captured.attempt_id,
      clockId: `natural-provider:${performance.timeOrigin}`,
      request_sha256: sha256(request),
      payload_sha256: sha256(JSON.stringify(payload)),
      reservation: null,
      provider_completed: false,
      actual_model: null,
      usage: null,
      phases: [],
      attempt_finished: false,
      dependency_mode: mode,
    };
    attempts.push(attempt);
    let raw, forwarded;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      const rawBytes = raw?.bytes() ?? Buffer.alloc(0);
      const forwardedBytes = forwarded?.bytes() ?? Buffer.alloc(0);
      attempt.raw = raw?.evidence ?? null;
      attempt.raw_sha256 = sha256(rawBytes);
      attempt.forwarded_sha256 = sha256(forwardedBytes);
      attempt.forwarded_recording = forwarded?.evidence ?? null;
      attempt.raw_path = resolve(out, `attempt-${attempt.index}.sse`);
      attempt.forwarded_path = resolve(out, `attempt-${attempt.index}.ndjson`);
      attempt.attempt_finished = true;
      attempt.phases.push({
        phase: "attempt-finished",
        at: performance.now(),
        clockId: attempt.clockId,
        details: {},
      });
      attempt.first_answer_ms = duration(
        attempt.phases,
        "network-dispatch",
        "first-upstream-answer-text",
      );
      attempt.provider_complete_ms = duration(
        attempt.phases,
        "network-dispatch",
        "upstream-terminal",
        true,
      );
      if (attempt.reservation) {
        try {
          settleCandidateAttempt(attempt, rawBytes, scope);
        } catch (error) {
          fail("provider-settlement", error);
        } finally {
          scope.finish(attempt.reservation);
        }
        if (
          scope.stopReason &&
          !failures.some((f) => f.reason === scope.stopReason)
        )
          fail("provider-settlement", Error(scope.stopReason));
      }
      if (attempt.raw?.truncated || attempt.forwarded_recording?.truncated)
        fail("raw-truncation", Error("natural-raw-evidence-truncated"));
      enqueue(async () => {
        const parseStarted = performance.now();
        const deltas = [];
        for (const line of forwardedBytes.toString("utf8").split("\n")) {
          try {
            const event = JSON.parse(line);
            if (
              event.type === "response.output_text.delta" &&
              typeof event.delta === "string"
            )
              deltas.push(event.delta);
          } catch {
            /* A truncated final line remains bounded raw evidence, not a fabricated event. */
          }
        }
        attempt.output_text = deltas.join("");
        try {
          attempt.raw_provider_proposal = JSON.parse(attempt.output_text);
        } catch {
          attempt.raw_provider_proposal = null;
        }
        attempt.proposal_scope =
          "Raw provider JSON only; browser parser/compiler and host outcomes remain separate observations.";
        attempt.diagnostic_parse_ms = performance.now() - parseStarted;
        await writeFile(attempt.raw_path, rawBytes, {
          flag: "wx",
          mode: 0o600,
        });
        await writeFile(attempt.forwarded_path, forwardedBytes, {
          flag: "wx",
          mode: 0o600,
        });
        await exclusive(resolve(out, `attempt-${attempt.index}.json`), attempt);
        await journal.append("attempt-finished", {
          attempt,
          budget: scope.budget.calls,
        });
      });
      active.delete(attempt);
    };
    active.add(attempt);
    try {
      const response = await product.providerExecution.providerResponse(
        request,
        {
          apiKey,
          model: manifest.candidate.model,
          signal,
          deadline,
          clockId: attempt.clockId,
          observe: (event) => {
            attempt.phases.push(event);
            if (event.phase === "upstream-terminal") {
              attempt.provider_completed = event.details.completed === true;
              attempt.actual_model = event.details.actualModel ?? null;
              attempt.usage = event.details.usage ?? null;
              attempt.terminal_type = event.details.terminalType;
            }
          },
          fetch: async (url, init) => {
            const reservationStarted = performance.now();
            try {
              scope.assertCredential(
                new Headers(init?.headers).get("authorization"),
              );
              attempt.reservation = scope.reserve(
                capture,
                payload,
                String(url),
                init?.method ?? "GET",
                init?.body,
              );
            } catch (error) {
              fail("provider-guard", error);
              throw error;
            }
            attempt.request_path = resolve(
              out,
              `attempt-${attempt.index}-request.json`,
            );
            const requestArtifact = {
              capture,
              payload,
              sdk_body: init.body,
              request_sha256: attempt.request_sha256,
              payload_sha256: attempt.payload_sha256,
            };
            try {
              await exclusive(attempt.request_path, requestArtifact);
              attempt.request_artifact_sha256 = sha256(requestArtifact);
              await journal.append("reservation", {
                attempt: { ...attempt },
                binding: scope.journalBindings,
                budget: scope.budget.calls,
                manifest_sha256: sha256(manifest),
                approval_sha256: sha256(approval),
              });
            } catch (error) {
              fail("reservation-persistence", error);
              throw error;
            }
            try {
              scope.assertActive();
            } catch (error) {
              fail("provider-guard", error);
              throw error;
            }
            if (signal.aborted || deadline.controller.signal.aborted)
              throw Error("natural-aborted-before-egress");
            attempt.reservation_write_ms =
              performance.now() - reservationStarted;
            attempt.provider_dispatched = true;
            attempt.phases.push({
              phase: "network-dispatch",
              at: performance.now(),
              clockId: attempt.clockId,
              details: {
                taskId: attempt.task_id,
                attemptId: captured.attempt_id,
              },
            });
            const response = await transport(url, {
              ...init,
              redirect: "error",
            });
            attempt.http_status = response.status;
            if ([401, 403].includes(response.status))
              fail(
                "provider-account",
                Error("natural-provider-account-unavailable"),
              );
            raw = recordResponse(response);
            return raw.response;
          },
        },
      );
      forwarded = recordResponse(response);
      const reader = forwarded.response.body?.getReader();
      if (!reader) {
        done();
        return response;
      }
      return new Response(
        new ReadableStream({
          async pull(controller) {
            try {
              const result = await reader.read();
              if (result.done) {
                done();
                controller.close();
              } else controller.enqueue(result.value);
            } catch (error) {
              attempt.error = error.message;
              done();
              controller.error(error);
            }
          },
          async cancel(reason) {
            await reader.cancel(reason).catch(() => {});
            done();
          },
        }),
        { status: response.status, headers: response.headers },
      );
    } catch (error) {
      attempt.error = error.message;
      done();
      throw error;
    }
  };
  try {
    h = await startBrowserHarness(provenance, product, out, {
      providerBridge,
      allowRendererNetwork: false,
      rendererAssets: renderer?.bytes,
      serviceConfig: {
        dependencyMode: mode,
        effectiveLatencyPolicy: manifest.latency_policy,
        runtimeLatencyPolicy: manifest.latency_policy,
      },
    });
    h.provenance = provenance;
    await armNaturalObserver(h.page);
    const url = `${h.url}/?services=real&session=natural-${crypto.randomUUID()}`;
    await h.page.goto(url);
    await h.page.waitForFunction(() =>
      Boolean(window.__gate && window.v2?.handle.editor),
    );
    checkpoints.push(await naturalCheckpoint(h.page, "empty", 0));
    if (
      checkpoints[0].snapshot.replay.evidence.length ||
      checkpoints[0].snapshot.events.length
    )
      throw Error("natural-lesson-not-empty");
    clock_start = await clockMapping(h.page);
    const actions = [
      ...lesson.transcript_events.map((e) => ({ ...e, kind: "source" })),
      ...lesson.checkpoints.map((c) => ({
        ...c,
        event_id: `checkpoint:${c.id}`,
        kind: "checkpoint",
      })),
      {
        id: "input_end",
        event_id: "checkpoint:input_end",
        kind: "checkpoint",
        at_ms: lesson.duration_ms,
      },
    ].sort((a, b) => a.at_ms - b.at_ms);
    timeline = await drive(actions, lesson.duration_ms, async (row) => {
      if (row.kind === "checkpoint") {
        const checkpoint = await naturalCheckpoint(h.page, row.id, row.at_ms);
        const lateness =
          checkpoint.product_at - clock_start.offset - row.scheduled_at;
        checkpoints.push({
          ...checkpoint,
          scheduled_at_driver: row.scheduled_at,
          acquisition_lateness_ms: lateness,
          clock_uncertainty_ms: clock_start.uncertainty,
          observation_tolerance_ms:
            manifest.execution_policy.checkpoint_acquisition_tolerance_ms,
          within_observation_tolerance:
            lateness >= -clock_start.uncertainty &&
            lateness + clock_start.uncertainty <=
              manifest.execution_policy.checkpoint_acquisition_tolerance_ms,
        });
        return { checkpoint_id: row.id };
      }
      try {
        const pending = admitNaturalTranscript(h.page, row).then((value) => {
          const admitted = { ...value, status: "ADMITTED" };
          admissions.push(admitted);
          enqueue(() => journal.append("source-admitted", admitted));
          return admitted;
        });
        pendingAdmissions.add(pending);
        try {
          return await pending;
        } finally {
          pendingAdmissions.delete(pending);
        }
      } catch (error) {
        admissions.push({
          event_id: row.event_id,
          status: "NOT_RUN",
          reason: error.message,
        });
        fail("source-admission", error);
        return { error: error.message };
      }
    });
    await delay(manifest.execution_policy.post_input_observation_ms);
    checkpoints.push(
      await naturalCheckpoint(
        h.page,
        "pre_reload",
        lesson.duration_ms +
          manifest.execution_policy.post_input_observation_ms,
      ),
    );
    await h.page.screenshot({ path: resolve(out, "pre-reload.png") });
    reload_started_at = now();
    await reloadNaturalObserver(h);
    await h.page.waitForFunction(() =>
      Boolean(window.__gate && window.v2?.handle.editor),
    );
    await delay(manifest.execution_policy.reload_observation_ms);
    checkpoints.push(
      await naturalCheckpoint(
        h.page,
        "post_reload",
        lesson.duration_ms +
          manifest.execution_policy.post_input_observation_ms +
          manifest.execution_policy.reload_observation_ms,
      ),
    );
    await h.page.screenshot({ path: resolve(out, "post-reload.png") });
    await flushNaturalObserver(h);
  } catch (error) {
    fail("natural-run", error);
  } finally {
    if (h) {
      try {
        browser_graph = provenance.verifyBrowserGraph(h.server, h.loadedURLs);
      } catch (error) {
        fail("browser-provenance", error);
      }
      try {
        await h.close();
      } catch (error) {
        fail("browser-cleanup", error);
      }
    }
    // Browser closure propagates abort to every active provider stream. Settled
    // diagnostics are awaited only after the measured lesson/host path ends.
    for (let i = 0; active.size && i < 100; i++) await delay(20);
    if (active.size)
      fail("attempt-lifecycle", Error("natural-attempt-cleanup-incomplete"));
    await Promise.all(writes);
    await journal.pending.catch((error) => fail("journal-persistence", error));
  }
  for (const event of lesson.transcript_events)
    if (!admissions.some((a) => a.event_id === event.event_id))
      admissions.push({
        event_id: event.event_id,
        status: "NOT_RUN",
        reason: stop ?? "not-reached",
      });
  const result = {
    identity: "cuelayer-v2-natural-short-results-1",
    manifest_sha256: sha256(manifest),
    lesson_sha256: manifest.lesson_sha256,
    dependency_mode: mode,
    admissions,
    checkpoints,
    requests: (h?.journal ?? []).flatMap((o) => {
      if (!o.request) return [];
      const attempt = attempts.find(
        (a) => a.browser_attempt_id === o.request.attempt_id,
      );
      return [
        {
          ...o.request,
          execution_status: attempt?.provider_dispatched
            ? "DISPATCHED"
            : "NOT_RUN",
          ...(attempt?.provider_dispatched
            ? {}
            : { reason: stop ?? attempt?.error ?? "provider-not-dispatched" }),
        },
      ];
    }),
    attempts,
    observations: h?.journal ?? [],
    driver: timeline,
    clock_start,
    provider_attempt_count: attempts.filter((a) => a.provider_dispatched)
      .length,
    real_provider_attempt_count:
      mode === "LIVE"
        ? attempts.filter((a) => a.provider_dispatched).length
        : 0,
    reload_started_at,
    coverage: {
      natural_stage: (h?.journal ?? []).some(
        (o) => o.request?.task.lane === "Stage",
      )
        ? "EXERCISED"
        : "NOT_EXERCISED",
      stage_required: false,
      reason:
        "This lesson permits ordinary Live clarification; actual Session eligibility controls Stage.",
    },
    failures: [
      ...failures,
      ...(h?.errors ?? []).filter((e) => e.boundary !== "egress-denied"),
    ],
    denied_egress: (h?.errors ?? []).filter(
      (e) => e.boundary === "egress-denied",
    ),
    budget: scope.budget.calls,
    cost_upper_bound_usd: scope.budget.cost(),
    integrity: {
      runtime_identity: provenance.snapshot(),
      journal_tip: journal.previous,
      journal_records: journal.sequence,
      captures: scope.journalBindings,
      browser_graph,
    },
  };
  result.mechanical_checks = naturalMechanicalChecks(product, lesson, result);
  result.performance = summarizeNaturalPerformance(result, lesson);
  result.status = result.mechanical_checks.some((c) => c.status !== "PASS")
    ? "FAIL"
    : "ADJUDICATION_REQUIRED";
  result.full_cohort = "BLOCKED";
  await exclusive(resolve(out, "natural-results.json"), result);
  await exclusive(resolve(out, "natural-results-seal.json"), {
    object_sha256: sha256(result),
    file_sha256: sha256(await readFile(resolve(out, "natural-results.json"))),
  });
  return result;
}

export async function verifyNaturalResultArtifacts(manifest, result) {
  const root = resolve(manifest.execution_directory, "execution");
  for (const attempt of result.attempts) {
    for (const [field, extension, hash] of [
      ["raw_path", "sse", "raw_sha256"],
      ["forwarded_path", "ndjson", "forwarded_sha256"],
    ]) {
      if (
        attempt[field] !==
          resolve(root, `attempt-${attempt.index}.${extension}`) ||
        sha256(await readFile(attempt[field])) !== attempt[hash]
      )
        throw Error("natural-response-artifact-drift");
    }
    if (attempt.reservation) {
      if (
        attempt.request_path !==
        resolve(root, `attempt-${attempt.index}-request.json`)
      )
        throw Error("natural-request-artifact-path-drift");
      const request = await readJSON(attempt.request_path);
      if (
        sha256(request) !== attempt.request_artifact_sha256 ||
        sha256(request.sdk_body) !== attempt.payload_sha256 ||
        sha256(request.capture.request) !== attempt.request_sha256
      )
        throw Error("natural-request-artifact-drift");
    }
  }
  return true;
}

export async function executeNatural(manifestPath, approvalPath) {
  const verified = await verifyNatural(manifestPath),
    approval = await readJSON(approvalPath);
  if (
    process.env.OPENAI_BASE_URL &&
    process.env.OPENAI_BASE_URL !== "https://api.openai.com/v1"
  )
    throw Error("natural-provider-origin-override");
  return runNatural(
    verified,
    approval,
    globalThis.fetch.bind(globalThis),
    process.env.OPENAI_API_KEY,
  );
}
