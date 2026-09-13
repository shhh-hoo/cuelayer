import { latencyStatistics } from "../qualification/report.mjs";

const number = (value) => Number.isFinite(value) && value >= 0;
const list = (value) => (Array.isArray(value) ? value : []);
const attrs = (row) => row.span?.attributes ?? {};
const stamp = (row) => (number(row.span?.end) ? row.span.end : null);
const key = (clock, attempt) => `${clock}\0${attempt}`;
const traces = (result) =>
  list(result.observations).filter((row) => row.type === "trace");
const initialClock = (result) =>
  result.checkpoints?.find((row) => row.id === "empty")?.clockId;

// Product execution calls its browser clock "monotonic:<origin>". The observer
// calls the same clock "browser:<origin>"; forwarded provider clocks stay distinct.
function browserClock(row) {
  const outer = row.clockId,
    inner = attrs(row).clockId;
  return typeof outer === "string" &&
    outer.startsWith("browser:") &&
    (!inner ||
      inner === outer ||
      inner === outer.replace("browser:", "monotonic:"))
    ? outer
    : null;
}
function calibration(result) {
  const clockId = initialClock(result),
    mapping = result.clock_start;
  return typeof clockId === "string" &&
    Number.isFinite(mapping?.offset) &&
    number(mapping?.uncertainty_ms ?? mapping?.uncertainty) &&
    (mapping.uncertainty_ms ?? mapping.uncertainty) <= 100
    ? {
        clockId,
        offset: mapping.offset,
        uncertainty: mapping.uncertainty_ms ?? mapping.uncertainty,
      }
    : null;
}
function driverTime(row, at, mapping) {
  return mapping && row.clockId === mapping.clockId && number(at)
    ? at - mapping.offset
    : null;
}
function entry(value, state = "MISSING") {
  return {
    value: number(value) ? value : null,
    state: number(value) ? "OBSERVED" : state,
  };
}
function distribution(entries) {
  const notRequired = entries.filter(
    (row) => row.state === "NOT_REQUIRED",
  ).length;
  const stats = latencyStatistics(
    entries.map((row) =>
      row.state === "NOT_REQUIRED" ? { ...row, state: "NOT_REACHED" } : row,
    ),
  );
  return {
    ...stats,
    endpoint_not_reached: stats.endpoint_not_reached - notRequired,
    not_required: notRequired,
  };
}

/** Browser receipt verifies evidence completeness and clock identity. Its delay
 * is descriptive: the canonical lateness limits apply only to evaluator dispatch.
 */
export function naturalArrivalFidelity(result, lesson) {
  const mapping = calibration(result),
    planned = list(lesson.transcript_events);
  const rows = planned.map((event) => {
    const admissions = list(result.admissions).filter(
      (a) => a.event_id === event.event_id,
    );
    const schedules = list(result.driver?.rows).filter(
      (row) => row.event_id === event.event_id,
    );
    const a = admissions[0],
      schedule = schedules[0];
    const received = a ? driverTime(a, a.page_received_at, mapping) : null;
    const lateness =
      received !== null && Number.isFinite(schedule?.scheduled_at)
        ? received - schedule.scheduled_at
        : null;
    const valid =
      admissions.length === 1 &&
      schedules.length === 1 &&
      a?.status === "ADMITTED" &&
      schedule.at_ms === event.at_ms &&
      Number.isFinite(result.driver?.start) &&
      schedule.scheduled_at === result.driver.start + event.at_ms &&
      lateness !== null &&
      lateness >= -mapping.uncertainty;
    return {
      event_id: event.event_id,
      status: valid ? "OBSERVED" : "MISSING_OR_INVALID",
      clockId: a?.clockId ?? null,
      scheduled_at_driver: schedule?.scheduled_at ?? null,
      received_at_driver: received,
      lateness_ms: lateness,
      lateness_upper_bound_ms:
        lateness === null ? null : Math.max(0, lateness) + mapping.uncertainty,
      dispatch_to_browser_ms:
        received !== null && Number.isFinite(schedule?.evaluator_dispatch_at)
          ? received - schedule.evaluator_dispatch_at
          : null,
      admission_count: admissions.length,
      schedule_count: schedules.length,
    };
  });
  const stats = latencyStatistics(
    rows.map((row) =>
      entry(row.status === "OBSERVED" ? Math.max(0, row.lateness_ms) : null),
    ),
  );
  const plannedIds = new Set(planned.map((event) => event.event_id));
  const unexpected = list(result.admissions)
    .filter((a) => !plannedIds.has(a.event_id))
    .map((a) => a.event_id);
  const unexpectedSchedules = list(result.driver?.rows)
    .filter((row) => row.kind === "source" && !plannedIds.has(row.event_id))
    .map((row) => row.event_id);
  const p95Upper =
    number(stats.p95_ms) && mapping ? stats.p95_ms + mapping.uncertainty : null;
  const maxUpper =
    number(stats.max_ms) && mapping ? stats.max_ms + mapping.uncertainty : null;
  return {
    status:
      rows.length > 0 &&
      stats.samples === rows.length &&
      !unexpected.length &&
      !unexpectedSchedules.length
        ? "PASS"
        : "INVALID",
    boundary:
      "frozen arrival deadline to actual browser receipt before speech.receive",
    scope:
      "Completeness, source identity and clock validity only. Browser and admission delays are product evidence; no browser-delay SLA is imposed. Scheduled-to-evaluator dispatch uses the separate canonical driver-fidelity gate.",
    calibration: mapping,
    lateness: stats,
    p95_upper_bound_ms: p95Upper,
    max_upper_bound_ms: maxUpper,
    unexpected_admissions: unexpected,
    unexpected_source_schedules: unexpectedSchedules,
    rows,
  };
}

function phaseElapsed(attempt, name, completed = false) {
  const phases = list(attempt.phases);
  const start =
    phases.find((p) => p.phase === "network-dispatch") ??
    phases.find((p) => p.phase === "provider-dispatch");
  const end = phases.find(
    (p) => p.phase === name && (!completed || p.details?.completed === true),
  );
  return start &&
    end &&
    typeof start.clockId === "string" &&
    start.clockId === end.clockId &&
    number(start.at) &&
    number(end.at) &&
    end.at >= start.at
    ? end.at - start.at
    : null;
}
function providerMetric(attempt, name, completed, fallback) {
  const value = phaseElapsed(attempt, name, completed);
  const reached = list(attempt.phases).some(
    (phase) =>
      phase.phase === name && (!completed || phase.details?.completed === true),
  );
  return entry(value, value === null && reached ? "MISSING" : fallback);
}
function censored(attempt, browserRows) {
  const reasons = [
    attempt?.error,
    ...browserRows
      .filter((row) =>
        ["model-failure", "model-http-failure"].includes(row.span.name),
      )
      .map((row) => attrs(row).reason),
  ];
  return reasons.some(
    (reason) =>
      typeof reason === "string" && /timeout|cancel|deadline/.test(reason),
  );
}
function validTargets(dom, state, expected) {
  const a = attrs(dom),
    targets = list(a.targets),
    required = list(a.required);
  return (
    a.complete === true &&
    targets.length > 0 &&
    new Set(targets).size === targets.length &&
    required.length === targets.length &&
    new Set(required).size === required.length &&
    required.every((id) => targets.includes(id)) &&
    targets.some((id) => expected.includes(id)) &&
    targets.every(
      (id) =>
        state?.units?.[id]?.valid === true &&
        a.versions?.[id] === state.units[id].version,
    )
  );
}

function browserOutcomes(result) {
  const events = traces(result),
    requests = list(result.requests);
  const outcomes = requests.map((request) => {
    const rows = events.filter(
      (row) =>
        browserClock(row) === request.clockId &&
        attrs(row).attemptId === request.attempt_id &&
        attrs(row).taskId === request.task?.id,
    );
    const dispatches = rows.filter((row) => row.span.name === "model-request");
    const dispatch =
      dispatches.length === 1 && number(dispatches[0].span.start)
        ? dispatches[0].span.start
        : null;
    const attempts = list(result.attempts).filter(
      (attempt) => attempt.browser_attempt_id === request.attempt_id,
    );
    const attempt = attempts.length === 1 ? attempts[0] : null;
    const finished = rows.some(
      (row) => row.span.name === "model-attempt-finished",
    );
    const fallback = censored(attempt, rows)
      ? "CENSORED"
      : finished
        ? "NOT_REACHED"
        : "MISSING";
    return {
      request,
      rows,
      attempt,
      dispatch,
      fallback,
      acceptance: null,
      task_id: request.task?.id,
      lane: request.task?.lane,
      browser_attempt_id: request.attempt_id,
      clockId: request.clockId,
      association_error:
        dispatches.length > 1 || attempts.length > 1
          ? "duplicate-attempt-record"
          : null,
    };
  });
  const byAttempt = new Map();
  for (const outcome of outcomes) {
    const id = key(outcome.clockId, outcome.browser_attempt_id);
    const previous = byAttempt.get(id);
    if (previous) {
      previous.association_error = "duplicate-browser-request";
      outcome.association_error = "duplicate-browser-request";
    }
    byAttempt.set(id, outcome);
  }
  const accepts = events.filter(
    (row) => row.span.name === "semantic-accepted" && browserClock(row),
  );
  const unmatched = [];
  for (const accepted of accepts) {
    const clock = browserClock(accepted),
      acceptedAt = stamp(accepted);
    const parsers = events
      .filter(
        (row) =>
          browserClock(row) === clock &&
          ["schema-valid-live-decision", "schema-valid-stage-review"].includes(
            row.span.name,
          ) &&
          attrs(row).succeeded === true &&
          attrs(row).taskId === attrs(accepted).taskId &&
          typeof attrs(row).attemptId === "string" &&
          stamp(row) !== null &&
          acceptedAt !== null &&
          stamp(row) <= acceptedAt,
      )
      .sort((a, b) => stamp(b) - stamp(a));
    const parser = parsers[0],
      outcome = parser && byAttempt.get(key(clock, attrs(parser).attemptId));
    if (
      !outcome ||
      outcome.task_id !== attrs(accepted).taskId ||
      outcome.association_error ||
      outcome.dispatch === null ||
      stamp(parser) < outcome.dispatch ||
      (parsers[1] && stamp(parsers[1]) === stamp(parser))
    ) {
      unmatched.push({
        task_id: attrs(accepted).taskId,
        clockId: clock,
        revision: attrs(accepted).revision,
        reason: "no-unambiguous-successful-parser-attempt",
      });
      continue;
    }
    if (outcome.acceptance) {
      outcome.association_error = "duplicate-acceptance";
      unmatched.push({
        task_id: outcome.task_id,
        clockId: clock,
        reason: "duplicate-acceptance",
      });
    } else outcome.acceptance = accepted;
  }
  return {
    unmatched,
    outcomes: outcomes.map((outcome) => {
      const accepted = outcome.association_error ? null : outcome.acceptance;
      const acceptedAt = accepted ? stamp(accepted) : null;
      const a = accepted ? attrs(accepted) : {},
        state = accepted?.replay?.state;
      const expected = [
        ...new Set([...list(a.changedUnits), ...list(a.attentionTargets)]),
      ];
      const nextAcceptance = accepts
        .filter(
          (row) =>
            browserClock(row) === outcome.clockId &&
            stamp(row) !== null &&
            acceptedAt !== null &&
            stamp(row) > acceptedAt,
        )
        .sort((left, right) => stamp(left) - stamp(right))[0];
      const inInterval = (row) =>
        browserClock(row) === outcome.clockId &&
        stamp(row) !== null &&
        acceptedAt !== null &&
        stamp(row) >= acceptedAt &&
        (!nextAcceptance || stamp(row) < stamp(nextAcceptance));
      const cuePublished = events.some(
        (row) =>
          row.span.name === "cue-presentation-published" &&
          attrs(row).taskId === outcome.task_id &&
          inInterval(row),
      );
      const visible =
        accepted &&
        state?.revision === a.revision &&
        events
          .filter(
            (row) =>
              inInterval(row) &&
              attrs(row).revision === a.revision &&
              attrs(row).complete === true &&
              ((row.span.name === "learner-visible-dom" &&
                validTargets(row, state, expected)) ||
                (row.span.name === "cue-visible-dom" &&
                  cuePublished &&
                  state.cue &&
                  Number.isSafeInteger(state.cueVersion) &&
                  attrs(row).cueVersion === state.cueVersion)),
          )
          .sort((left, right) => stamp(left) - stamp(right))[0];
      const notRequired =
        accepted &&
        a.changed === false &&
        !list(a.attentionTargets).length &&
        !cuePublished;
      const versionedTarget = expected.some(
        (id) => state?.units?.[id]?.valid === true,
      );
      const visibility = !accepted
        ? outcome.fallback
        : notRequired
          ? "NOT_REQUIRED"
          : !state || (!versionedTarget && !cuePublished)
            ? "MISSING"
            : "NOT_REACHED";
      const hostLatency =
        acceptedAt !== null &&
        outcome.dispatch !== null &&
        acceptedAt >= outcome.dispatch
          ? acceptedAt - outcome.dispatch
          : null;
      const visibleAt = visible ? stamp(visible) : null;
      return {
        task_id: outcome.task_id,
        lane: outcome.lane,
        browser_attempt_id: outcome.browser_attempt_id,
        clockId: outcome.clockId,
        dispatch_at: outcome.dispatch,
        accepted_at: acceptedAt,
        accepted_revision: accepted ? a.revision : null,
        visible_at: visibleAt,
        visible_boundary: visible?.span.name ?? null,
        visibility_requirement: !accepted
          ? "NOT_ESTABLISHED"
          : notRequired
            ? "NOT_REQUIRED"
            : versionedTarget || cuePublished
              ? "REQUIRED"
              : "UNCLASSIFIED_CHANGE",
        association_error: outcome.association_error,
        request_to_accepted: entry(
          hostLatency,
          outcome.dispatch === null ? "MISSING" : outcome.fallback,
        ),
        request_to_useful_dom: entry(
          visibleAt !== null && outcome.dispatch !== null
            ? visibleAt - outcome.dispatch
            : null,
          visibility,
        ),
        accepted_to_useful_dom: entry(
          visibleAt !== null ? visibleAt - acceptedAt : null,
          visibility,
        ),
      };
    }),
  };
}

function frameSummary(frames, start, end) {
  const sorted = frames
    .filter((row) => Number.isFinite(row.at_driver))
    .sort((a, b) => a.at_driver - b.at_driver);
  const baseline = [...sorted].reverse().find((row) => row.at_driver <= start);
  const during = sorted.filter(
    (row) => row.at_driver >= start && row.at_driver <= end,
  );
  const measured =
    baseline && during[0] !== baseline ? [baseline, ...during] : during;
  const valid = measured.filter(
    (row) =>
      number(row.frontier?.A) &&
      number(row.frontier?.R) &&
      row.frontier.A <= row.frontier.R,
  );
  const first = valid[0],
    last = valid.at(-1);
  const values = valid.map((row) => ({
    at: row.at_driver,
    backlog: row.frontier.R - row.frontier.A,
  }));
  const meanTime = values.length
    ? values.reduce((total, row) => total + row.at, 0) / values.length
    : null;
  const meanBacklog = values.length
    ? values.reduce((total, row) => total + row.backlog, 0) / values.length
    : null;
  const varianceTime = values.reduce(
    (total, row) => total + (row.at - meanTime) ** 2,
    0,
  );
  const slope = varianceTime
    ? (values.reduce(
        (total, row) =>
          total + (row.at - meanTime) * (row.backlog - meanBacklog),
        0,
      ) /
        varianceTime) *
      1000
    : null;
  return {
    requested_start_at_driver: start,
    requested_end_at_driver: end,
    samples: during.length,
    valid_frontier_samples: valid.length,
    invalid_frontier_samples: measured.length - valid.length,
    frontier_counts_include_baseline: Boolean(
      baseline && during[0] !== baseline,
    ),
    baseline_at_driver: baseline?.at_driver ?? null,
    first_observed_at_driver: first?.at_driver ?? null,
    last_observed_at_driver: last?.at_driver ?? null,
    last_sample_before_boundary_ms: last ? end - last.at_driver : null,
    max_sample_gap_ms:
      measured.length > 1
        ? Math.max(
            ...measured
              .slice(1)
              .map((row, i) => row.at_driver - measured[i].at_driver),
          )
        : null,
    backlog_chars: {
      first: values[0]?.backlog ?? null,
      last: values.at(-1)?.backlog ?? null,
      peak: values.length
        ? Math.max(...values.map((row) => row.backlog))
        : null,
      net_change:
        values.length > 1 ? values.at(-1).backlog - values[0].backlog : null,
      sampled_linear_trend_per_second: slope,
    },
    recorded_chars_change:
      baseline && first === baseline && last
        ? last.frontier.R - first.frontier.R
        : null,
    accounted_chars_change:
      baseline && first === baseline && last
        ? last.frontier.A - first.frontier.A
        : null,
    oldest_pending_ms: distribution(
      during.map((row) => entry(row.oldest_pending_ms)),
    ),
    interpretation:
      "Sampled source accounting only. CARRY and review obligations remain separate; a falling backlog does not establish semantic correctness or sustained capacity.",
  };
}

export function summarizeNaturalPerformance(result, lesson) {
  const mapping = calibration(result),
    browser = browserOutcomes(result),
    lanes = {};
  for (const lane of ["Live", "Stage"]) {
    const attempts = list(result.attempts).filter((a) => a.lane === lane);
    const requests = browser.outcomes.filter((row) => row.lane === lane);
    const providerRows = attempts.map((attempt) => {
      const observed = traces(result).filter(
        (row) => attrs(row).attemptId === attempt.browser_attempt_id,
      );
      const state = censored(attempt, observed)
        ? "CENSORED"
        : attempt.attempt_finished
          ? "NOT_REACHED"
          : "MISSING";
      const sdkDispatch = list(attempt.phases).find(
        (phase) => phase.phase === "provider-dispatch",
      );
      const networkDispatch = list(attempt.phases).find(
        (phase) => phase.phase === "network-dispatch",
      );
      const beforeNetwork =
        sdkDispatch &&
        networkDispatch &&
        typeof sdkDispatch.clockId === "string" &&
        sdkDispatch.clockId === networkDispatch.clockId &&
        number(sdkDispatch.at) &&
        number(networkDispatch.at) &&
        networkDispatch.at >= sdkDispatch.at
          ? networkDispatch.at - sdkDispatch.at
          : null;
      return {
        browser_attempt_id: attempt.browser_attempt_id,
        reservation: attempt.reservation ?? null,
        provider_completed: attempt.provider_completed === true,
        latency_start_boundary: networkDispatch
          ? "network-dispatch"
          : sdkDispatch
            ? "provider-dispatch-fallback"
            : null,
        provider_dispatch_to_network: entry(
          beforeNetwork,
          networkDispatch ? "MISSING" : "NOT_REACHED",
        ),
        first_answer: providerMetric(
          attempt,
          "first-upstream-answer-text",
          false,
          state,
        ),
        complete: providerMetric(attempt, "upstream-terminal", true, state),
        terminal: providerMetric(attempt, "upstream-terminal", false, state),
      };
    });
    lanes[lane] = {
      recorded_provider_attempts: attempts.length,
      reserved_attempts: attempts.filter((a) => a.reservation).length,
      provider_completed: attempts.filter((a) => a.provider_completed === true)
        .length,
      browser_requests: requests.length,
      host_accepted: requests.filter((row) => row.accepted_at !== null).length,
      useful_dom_observed: requests.filter((row) => row.visible_at !== null)
        .length,
      visibility_not_required: requests.filter(
        (row) => row.visibility_requirement === "NOT_REQUIRED",
      ).length,
      latency_start_boundaries: {
        network_dispatch: providerRows.filter(
          (row) => row.latency_start_boundary === "network-dispatch",
        ).length,
        provider_dispatch_fallback: providerRows.filter(
          (row) => row.latency_start_boundary === "provider-dispatch-fallback",
        ).length,
        missing: providerRows.filter(
          (row) => row.latency_start_boundary === null,
        ).length,
      },
      provider_dispatch_to_network_ms: distribution(
        providerRows.map((row) => row.provider_dispatch_to_network),
      ),
      provider_first_answer_ms: distribution(
        providerRows.map((row) => row.first_answer),
      ),
      provider_complete_ms: distribution(
        providerRows.map((row) => row.complete),
      ),
      provider_terminal_ms: distribution(
        providerRows.map((row) => row.terminal),
      ),
      request_to_host_accepted_ms: distribution(
        requests.map((row) => row.request_to_accepted),
      ),
      request_to_useful_dom_ms: distribution(
        requests.map((row) => row.request_to_useful_dom),
      ),
      accepted_to_useful_dom_ms: distribution(
        requests.map((row) => row.accepted_to_useful_dom),
      ),
      provider_rows: providerRows,
    };
  }
  const frames = list(result.observations)
    .filter((row) => row.type === "frame")
    .map((row) => ({
      ...row,
      at_driver: driverTime(row, row.product_at, mapping),
    }));
  const start = Number.isFinite(result.driver?.start)
    ? result.driver.start
    : null;
  const end =
    start !== null && number(lesson.duration_ms)
      ? start + lesson.duration_ms
      : null;
  const preReload = result.checkpoints?.find((row) => row.id === "pre_reload");
  const tailEnd = preReload
    ? driverTime(preReload, preReload.product_at, mapping)
    : null;
  const arrivals = list(result.admissions)
    .map((row) => driverTime(row, row.page_received_at, mapping))
    .filter(Number.isFinite);
  const originalClock = initialClock(result);
  const reloadClocks = originalClock
    ? [
        ...new Set(
          frames
            .filter((row) => row.clockId !== originalClock)
            .map((row) => row.clockId),
        ),
      ]
    : [];
  return {
    identity: "cuelayer-v2-natural-performance-1",
    lanes,
    browser_outcomes: browser.outcomes,
    unmatched_acceptances: browser.unmatched,
    arrival_fidelity: naturalArrivalFidelity(result, lesson),
    input_period:
      start !== null && end !== null && mapping
        ? frameSummary(frames, start, end)
        : null,
    post_input_tail:
      end !== null && tailEnd !== null && tailEnd >= end
        ? frameSummary(frames, end, tailEnd)
        : null,
    last_source_arrival_at_driver: arrivals.length
      ? Math.max(...arrivals)
      : null,
    quiet_interval_before_input_end_ms:
      arrivals.length && end !== null ? end - Math.max(...arrivals) : null,
    reload_observation: reloadClocks.map((clockId) => {
      const rows = frames
        .filter((row) => row.clockId === clockId)
        .sort((a, b) => a.product_at - b.product_at);
      return {
        clockId,
        samples: rows.length,
        first_at_local: rows[0]?.product_at ?? null,
        last_at_local: rows.at(-1)?.product_at ?? null,
        oldest_pending_ms: distribution(
          rows.map((row) => entry(row.oldest_pending_ms)),
        ),
        scope:
          "Separate browser clock after reload; no initial-clock subtraction is applied.",
      };
    }),
    interpretation:
      "One short naturally scheduled lesson. All observed provider attempts and browser requests stay in their respective denominators. Useful DOM means a complete version-bound surface observation, not a semantic-quality verdict. Input-period progress is reported separately from quiet intervals, tail observation and reload; none establishes sustained capacity.",
  };
}
