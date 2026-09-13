import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeNaturalPerformance,
  naturalArrivalFidelity,
} from "./performance.mjs";

const CLOCK = "browser:100000",
  MONOTONIC = "monotonic:100000";
const trace = (name, at, attributes = {}, extra = {}) => ({
  type: "trace",
  clockId: CLOCK,
  span: { name, start: at, end: at, attributes },
  ...extra,
});
const frame = (at, recorded, accounted, age, clockId = CLOCK) => ({
  type: "frame",
  clockId,
  product_at: at,
  frontier: { R: recorded, A: accounted },
  oldest_pending_ms: age,
});
function fixture() {
  const lesson = {
    duration_ms: 10000,
    transcript_events: [
      { event_id: "e0", at_ms: 0, text: "One." },
      { event_id: "e1", at_ms: 1000, text: "Two." },
    ],
  };
  const result = {
    observations: [],
    requests: [],
    attempts: [],
    checkpoints: [
      { id: "empty", clockId: CLOCK, product_at: 0 },
      { id: "pre_reload", clockId: CLOCK, product_at: 12000 },
    ],
    clock_start: { offset: -100000, uncertainty: 1 },
    driver: {
      start: 100000,
      end: 110001,
      rows: lesson.transcript_events.map((e) => ({
        ...e,
        kind: "source",
        scheduled_at: 100000 + e.at_ms,
        evaluator_dispatch_at: 100001 + e.at_ms,
      })),
    },
    admissions: lesson.transcript_events.map((e) => ({
      event_id: e.event_id,
      clockId: CLOCK,
      status: "ADMITTED",
      page_received_at: e.at_ms + 2,
    })),
  };
  return { lesson, result };
}
function addAttempt(
  result,
  {
    id = "a1",
    taskId = "task1",
    lane = "Live",
    at = 10,
    parsed = true,
    accepted = true,
    changed = true,
    revision = 1,
    visible = true,
    providerComplete = true,
    providerMs = 500,
    timeout = false,
  } = {},
) {
  const unitId = "unit-" + taskId;
  const info = { taskId, lane, attemptId: id, clockId: MONOTONIC };
  result.requests.push({
    task: { id: taskId, lane },
    attempt_id: id,
    clockId: CLOCK,
    product_at: at + 2,
  });
  const attempt = {
    browser_attempt_id: id,
    task_id: taskId,
    lane,
    reservation: id + ":reserved",
    provider_completed: providerComplete,
    attempt_finished: true,
    first_answer_ms: 999999,
    provider_complete_ms: 999999,
    phases: [
      {
        phase: "provider-dispatch",
        at: 200,
        clockId: "provider:200000",
        details: {},
      },
      {
        phase: "first-upstream-answer-text",
        at: 210,
        clockId: "provider:200000",
        details: {},
      },
      ...(providerComplete
        ? [
            {
              phase: "upstream-terminal",
              at: 200 + providerMs,
              clockId: "provider:200000",
              details: { completed: true },
            },
          ]
        : []),
    ],
  };
  result.attempts.push(attempt);
  result.observations.push(trace("model-request", at, info));
  if (parsed)
    result.observations.push(
      trace(
        lane === "Live"
          ? "schema-valid-live-decision"
          : "schema-valid-stage-review",
        at + 1000,
        { ...info, succeeded: true },
      ),
    );
  else
    result.observations.push(
      trace("model-parser-failed", at + 1000, { ...info, succeeded: false }),
    );
  result.observations.push(trace("model-attempt-finished", at + 1001, info));
  if (timeout)
    result.observations.push(
      trace("model-failure", at + 1000, {
        ...info,
        reason: "model-timeout-or-cancelled",
      }),
    );
  const state = {
    revision,
    units: { [unitId]: { id: unitId, valid: true, version: 3 } },
    cue: null,
    cueVersion: 0,
  };
  if (accepted)
    result.observations.push(
      trace(
        "semantic-accepted",
        at + 1100,
        {
          taskId,
          lane,
          revision,
          changed,
          changedUnits: changed ? [unitId] : [],
          attentionTargets: [],
        },
        { replay: { state } },
      ),
    );
  if (visible)
    result.observations.push({
      ...trace("learner-visible-dom", at + 1105, {
        revision,
        complete: true,
        targets: [unitId],
        required: [unitId],
        versions: { [unitId]: 3 },
      }),
      span: {
        name: "learner-visible-dom",
        start: at + 1105,
        end: at + 1140,
        attributes: {
          revision,
          complete: true,
          targets: [unitId],
          required: [unitId],
          versions: { [unitId]: 3 },
        },
      },
    });
  return { attempt, unitId, state };
}

test("actual page arrival fidelity retains all frozen sources and includes calibration uncertainty", () => {
  const { result, lesson } = fixture(),
    report = naturalArrivalFidelity(result, lesson);
  assert.equal(report.status, "PASS");
  assert.equal(report.lateness.denominator, 2);
  assert.equal(report.lateness.samples, 2);
  assert.equal(report.lateness.p95_ms, 2);
  assert.equal(report.p95_upper_bound_ms, 3);
  assert.equal(report.rows[0].dispatch_to_browser_ms, 1);
});

test("missing, duplicate, unplanned and incorrectly clocked admissions fail evidence validity", () => {
  for (const mutate of [
    (r) => {
      r.admissions.pop();
    },
    (r) => {
      r.admissions.push(structuredClone(r.admissions[0]));
    },
    (r) => {
      r.admissions[0].clockId = "browser:reload";
    },
    (r) => {
      r.driver.rows[0].scheduled_at += 10;
    },
    (r) => {
      r.clock_start.uncertainty = 101;
    },
    (r) => {
      r.admissions.push({ event_id: "unplanned" });
    },
  ]) {
    const { result, lesson } = fixture();
    mutate(result);
    const report = naturalArrivalFidelity(result, lesson);
    assert.equal(report.status, "INVALID");
    assert.equal(report.lateness.denominator, lesson.transcript_events.length);
  }
});

test("browser delay remains descriptive even beyond evaluator dispatch limits", () => {
  const { result, lesson } = fixture();
  result.admissions.forEach((a, i) => {
    a.page_received_at = lesson.transcript_events[i].at_ms + 1600;
  });
  const delayed = naturalArrivalFidelity(result, lesson);
  assert.equal(delayed.status, "PASS");
  assert.equal(delayed.lateness.p95_ms, 1600);
  assert.equal(delayed.p95_upper_bound_ms, 1601);
  assert.equal(delayed.max_upper_bound_ms, 1601);
  assert.equal("thresholds_ms" in delayed, false);
  assert.equal(delayed.rows[0].scheduled_at_driver, result.driver.start);
  assert.equal(delayed.rows[0].received_at_driver, result.driver.start + 1600);
  delete result.clock_start;
  const absent = naturalArrivalFidelity(result, lesson);
  assert.equal(absent.lateness.samples, 0);
  assert.equal(absent.lateness.missing_telemetry, 2);
  assert.equal(absent.rows[0].lateness_ms, null);
});

test("request, host acceptance and useful DOM use actual matching trace endpoints", () => {
  const { result, lesson } = fixture();
  addAttempt(result);
  const report = summarizeNaturalPerformance(result, lesson),
    lane = report.lanes.Live;
  assert.equal(lane.provider_first_answer_ms.p50_ms, 10);
  assert.equal(lane.provider_complete_ms.p50_ms, 500);
  assert.equal(lane.request_to_host_accepted_ms.p50_ms, 1100);
  assert.equal(lane.request_to_useful_dom_ms.p50_ms, 1140);
  assert.equal(lane.accepted_to_useful_dom_ms.p50_ms, 40);
  assert.equal(report.browser_outcomes[0].dispatch_at, 10);
  assert.equal(report.browser_outcomes[0].visible_at, 1150);
  assert.equal(
    report.browser_outcomes[0].visible_boundary,
    "learner-visible-dom",
  );
});

test("provider quantiles use all attempt denominators and exact R7 values", () => {
  const { result, lesson } = fixture();
  [100, 200, 300, 400].forEach((providerMs, i) =>
    addAttempt(result, {
      id: "a" + i,
      taskId: "t" + i,
      at: i * 2000,
      revision: i + 1,
      providerMs,
    }),
  );
  addAttempt(result, {
    id: "timeout",
    taskId: "timeout",
    at: 9000,
    parsed: false,
    accepted: false,
    visible: false,
    providerComplete: false,
    timeout: true,
  });
  const report = summarizeNaturalPerformance(result, lesson).lanes.Live;
  assert.equal(report.provider_complete_ms.denominator, 5);
  assert.equal(report.provider_complete_ms.samples, 4);
  assert.equal(report.provider_complete_ms.p50_ms, 250);
  assert.equal(report.provider_complete_ms.p95_ms, 385);
  assert.ok(
    Math.abs(
      report.provider_complete_ms.sample_variance_ms2 - 16666.666666666668,
    ) < 1e-8,
  );
  assert.equal(report.provider_complete_ms.censored, 1);
  assert.equal(report.provider_first_answer_ms.samples, 5);
  assert.equal(report.request_to_host_accepted_ms.denominator, 5);
  assert.equal(report.request_to_host_accepted_ms.censored, 1);
  assert.equal(report.request_to_useful_dom_ms.denominator, 5);
});

test("provider latency starts at actual network dispatch and exposes earlier local overhead", () => {
  const { result, lesson } = fixture(),
    { attempt } = addAttempt(result);
  attempt.phases.splice(1, 0, {
    phase: "network-dispatch",
    at: 205,
    clockId: "provider:200000",
    details: {},
  });
  let lane = summarizeNaturalPerformance(result, lesson).lanes.Live;
  assert.equal(lane.provider_first_answer_ms.p50_ms, 5);
  assert.equal(lane.provider_complete_ms.p50_ms, 495);
  assert.equal(lane.provider_dispatch_to_network_ms.p50_ms, 5);
  assert.equal(
    lane.provider_rows[0].latency_start_boundary,
    "network-dispatch",
  );
  assert.equal(lane.latency_start_boundaries.network_dispatch, 1);
  attempt.phases.splice(1, 1);
  lane = summarizeNaturalPerformance(result, lesson).lanes.Live;
  assert.equal(lane.provider_complete_ms.p50_ms, 500);
  assert.equal(
    lane.provider_rows[0].latency_start_boundary,
    "provider-dispatch-fallback",
  );
  assert.equal(lane.latency_start_boundaries.provider_dispatch_fallback, 1);
});

test("forwarded provider clocks cannot be subtracted from browser or other provider clocks", () => {
  const { result, lesson } = fixture(),
    { attempt } = addAttempt(result);
  attempt.phases[2].clockId = "provider:another-origin";
  const accepted = result.observations.find(
    (row) => row.span?.name === "semantic-accepted",
  );
  accepted.span.attributes.clockId = "natural-provider:200000";
  const report = summarizeNaturalPerformance(result, lesson).lanes.Live;
  assert.equal(report.provider_complete_ms.samples, 0);
  assert.equal(report.provider_complete_ms.missing_telemetry, 1);
  assert.equal(report.request_to_host_accepted_ms.samples, 0);
  assert.equal(report.request_to_useful_dom_ms.samples, 0);
});

test("acceptance binds the latest successful parser attempt and never an earlier failed retry", () => {
  const { result, lesson } = fixture();
  addAttempt(result, {
    id: "first",
    parsed: false,
    accepted: false,
    visible: false,
  });
  addAttempt(result, { id: "second", at: 2000 });
  const report = summarizeNaturalPerformance(result, lesson);
  assert.equal(report.lanes.Live.browser_requests, 2);
  assert.equal(report.lanes.Live.host_accepted, 1);
  assert.equal(report.browser_outcomes[0].accepted_at, null);
  assert.equal(report.browser_outcomes[1].accepted_at, 3100);
  assert.equal(report.browser_outcomes[1].request_to_accepted.value, 1100);
});

test("missing successful parser evidence cannot fabricate host or visible latency", () => {
  const { result, lesson } = fixture();
  addAttempt(result, { parsed: false });
  const report = summarizeNaturalPerformance(result, lesson);
  assert.equal(report.lanes.Live.host_accepted, 0);
  assert.equal(report.lanes.Live.useful_dom_observed, 0);
  assert.equal(report.unmatched_acceptances.length, 1);
});

test("unchanged NO_CHANGE is an explicit not-required DOM denominator", () => {
  const { result, lesson } = fixture();
  addAttempt(result, { changed: false });
  const report = summarizeNaturalPerformance(result, lesson),
    lane = report.lanes.Live;
  assert.equal(lane.host_accepted, 1);
  assert.equal(lane.useful_dom_observed, 0);
  assert.equal(lane.request_to_useful_dom_ms.denominator, 1);
  assert.equal(lane.request_to_useful_dom_ms.not_required, 1);
  assert.equal(lane.request_to_useful_dom_ms.samples, 0);
  assert.equal(lane.request_to_useful_dom_ms.missing_telemetry, 0);
  assert.equal(lane.request_to_useful_dom_ms.endpoint_not_reached, 0);
});

test("complete DOM still needs accepted revision, current unit versions and a related target", () => {
  for (const mutate of [
    (row) => {
      row.span.attributes.revision = 2;
    },
    (row) => {
      row.span.attributes.versions["unit-task1"] = 2;
    },
    (row) => {
      row.span.attributes.targets = ["unrelated"];
      row.span.attributes.versions = { unrelated: 1 };
    },
    (row) => {
      row.span.attributes.complete = false;
    },
    (row) => {
      row.span.attributes.required = ["unit-task1", "also-required"];
    },
    (row) => {
      delete row.span.attributes.required;
    },
    (row) => {
      row.clockId = "browser:reload";
    },
    (row) => {
      row.span.end = 100;
    },
  ]) {
    const { result, lesson } = fixture();
    addAttempt(result);
    mutate(
      result.observations.find(
        (row) => row.span?.name === "learner-visible-dom",
      ),
    );
    const lane = summarizeNaturalPerformance(result, lesson).lanes.Live;
    assert.equal(lane.request_to_useful_dom_ms.samples, 0);
    assert.equal(lane.request_to_useful_dom_ms.endpoint_not_reached, 1);
  }
});

test("Cue visibility associates its publication and exact cueVersion independently of board attention", () => {
  const { result, lesson } = fixture(),
    { state } = addAttempt(result, { visible: false });
  const accepted = result.observations.find(
    (row) => row.span?.name === "semantic-accepted",
  );
  accepted.span.attributes.changedUnits = [];
  state.cue = { text: "Compare these readings." };
  state.cueVersion = 7;
  result.observations.push(
    trace("cue-presentation-published", 1120, { taskId: "task1" }),
    trace("cue-visible-dom", 1160, {
      revision: 1,
      cueVersion: 7,
      complete: true,
    }),
  );
  let report = summarizeNaturalPerformance(result, lesson);
  assert.equal(report.lanes.Live.useful_dom_observed, 1);
  assert.equal(report.browser_outcomes[0].visible_boundary, "cue-visible-dom");
  assert.equal(report.browser_outcomes[0].request_to_useful_dom.value, 1150);
  result.observations.at(-1).span.attributes.cueVersion = 6;
  report = summarizeNaturalPerformance(result, lesson);
  assert.equal(report.lanes.Live.useful_dom_observed, 0);
});

test("a later acceptance cannot supply the earlier attempt's DOM endpoint", () => {
  const { result, lesson } = fixture();
  addAttempt(result, { visible: false });
  addAttempt(result, {
    id: "next",
    taskId: "next",
    at: 20,
    revision: 2,
    visible: false,
  });
  result.observations.push(
    trace("learner-visible-dom", 1200, {
      revision: 1,
      complete: true,
      targets: ["unit-task1"],
      required: ["unit-task1"],
      versions: { "unit-task1": 3 },
    }),
  );
  const report = summarizeNaturalPerformance(result, lesson);
  assert.equal(report.browser_outcomes[0].visible_at, null);
});

test("Stage has independent denominators and missing attempts stay visible", () => {
  const { result, lesson } = fixture();
  addAttempt(result, { lane: "Stage" });
  result.requests.push({
    task: { id: "guard-stopped", lane: "Stage" },
    attempt_id: "no-provider",
    clockId: CLOCK,
    product_at: 2000,
  });
  result.observations.push(
    trace("model-request", 2000, {
      taskId: "guard-stopped",
      lane: "Stage",
      attemptId: "no-provider",
      clockId: MONOTONIC,
    }),
  );
  const lanes = summarizeNaturalPerformance(result, lesson).lanes;
  assert.equal(lanes.Live.browser_requests, 0);
  assert.equal(lanes.Live.request_to_host_accepted_ms.p50_ms, null);
  assert.equal(lanes.Stage.browser_requests, 2);
  assert.equal(lanes.Stage.recorded_provider_attempts, 1);
  assert.equal(lanes.Stage.request_to_host_accepted_ms.denominator, 2);
  assert.equal(lanes.Stage.request_to_host_accepted_ms.missing_telemetry, 1);
});

test("input backlog growth remains separate from a tail that clears it", () => {
  const { result, lesson } = fixture();
  result.observations.push(
    frame(0, 0, 0, 0),
    frame(5000, 100, 20, 4000),
    frame(10000, 200, 80, 5000),
    frame(11000, 200, 160, 2000),
    frame(12000, 200, 200, 0),
    frame(1, 200, 200, 0, "browser:reload"),
    frame(100, 200, 200, 0, "browser:reload"),
  );
  const report = summarizeNaturalPerformance(result, lesson);
  assert.equal(report.input_period.backlog_chars.first, 0);
  assert.equal(report.input_period.backlog_chars.last, 120);
  assert.equal(report.input_period.backlog_chars.peak, 120);
  assert.equal(report.input_period.backlog_chars.net_change, 120);
  assert.ok(
    report.input_period.backlog_chars.sampled_linear_trend_per_second > 0,
  );
  assert.equal(report.input_period.recorded_chars_change, 200);
  assert.equal(report.input_period.accounted_chars_change, 80);
  assert.equal(report.input_period.oldest_pending_ms.max_ms, 5000);
  assert.equal(report.post_input_tail.backlog_chars.first, 120);
  assert.equal(report.post_input_tail.backlog_chars.last, 0);
  assert.equal(report.post_input_tail.accounted_chars_change, 120);
  assert.equal(report.reload_observation.length, 1);
  assert.equal(report.reload_observation[0].clockId, "browser:reload");
  assert.equal(report.reload_observation[0].first_at_local, 1);
  assert.equal(report.quiet_interval_before_input_end_ms, 8998);
  assert.equal("status" in report.input_period, false);
});

test("missing frame age, invalid frontiers and absent calibration do not become healthy zeroes", () => {
  const { result, lesson } = fixture();
  result.observations.push(
    frame(0, 0, 0, undefined),
    frame(1000, 2, 3, undefined),
  );
  let report = summarizeNaturalPerformance(result, lesson);
  assert.equal(report.input_period.invalid_frontier_samples, 1);
  assert.equal(report.input_period.oldest_pending_ms.samples, 0);
  assert.equal(report.input_period.oldest_pending_ms.missing_telemetry, 2);
  delete result.clock_start;
  report = summarizeNaturalPerformance(result, lesson);
  assert.equal(report.input_period, null);
  assert.equal(report.post_input_tail, null);
});
