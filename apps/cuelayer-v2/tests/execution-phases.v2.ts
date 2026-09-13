import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const temporary: string[] = [];
afterEach(() =>
  temporary
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);
const span = (
  name: string,
  at: number,
  attributes: Record<string, unknown> = {},
) => ({
  spanId: crypto.randomUUID(),
  name,
  start: at,
  end: at,
  attributes: {
    taskId: "task",
    attemptId: "attempt",
    lane: "Live",
    traceSourceId: "browser-session",
    clockId: "browser-clock",
    ...attributes,
  },
});
function analyze(spans: ReturnType<typeof span>[]) {
  const dir = mkdtempSync(join(tmpdir(), "v2-execution-phases-"));
  temporary.push(dir);
  const path = join(dir, "run.json");
  writeFileSync(
    path,
    JSON.stringify({
      identity: "offline-phase-contract",
      snapshot: {
        spans,
        events: [],
        replay: { evidence: [], consumed: {}, unresolved: {} },
      },
    }),
  );
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL("../scripts/analyze-run.mjs", import.meta.url)),
      path,
    ],
    { stdio: "pipe" },
  );
  return JSON.parse(readFileSync(join(dir, "analysis.json"), "utf8"));
}

it("keeps timeout teardown distinct from provider/parser/host completion and in the latency denominator", () => {
  const report = analyze([
    span("model-request", 0),
    span("model-failure", 6000, { reason: "model-timeout" }),
    span("model-attempt-finished", 6001, {
      providerCompleted: false,
      parserSucceeded: false,
    }),
  ]).execution;
  expect(report.attempts[0]).toMatchObject({
    attemptFinished: true,
    providerCompleted: false,
    parserAttempted: false,
    parserSucceeded: false,
    hostEvaluated: false,
    hostAccepted: false,
    outcome: "execution-failed",
    failure: "model-timeout",
    timings: {
      attemptElapsedMs: 6001,
      browserFirstAnswerMs: null,
      browserCompleteMs: null,
      browserToAcceptedMs: null,
    },
  });
  expect(report.metrics.Live.browserCompleteMs).toMatchObject({
    attempts: 1,
    observed: 0,
    unavailable: 1,
    medianMs: null,
  });
});

it("joins retries by attempt and measures upstream and browser phases on separate monotonic clocks", () => {
  const second = { attemptId: "retry" };
  const report = analyze([
    span("model-request", 0),
    span("model-failure", 100, { reason: "model-transient" }),
    span("model-attempt-finished", 101),
    span("model-request", 200, second),
    span("model-provider-dispatch", 1000000, {
      ...second,
      clockId: "provider-clock",
    }),
    span("model-provider-headers", 1000010, {
      ...second,
      clockId: "provider-clock",
    }),
    span("model-first-upstream-byte", 1000020, {
      ...second,
      clockId: "provider-clock",
    }),
    span("model-first-upstream-answer-text", 1000030, {
      ...second,
      clockId: "provider-clock",
    }),
    span("model-first-output", 240, second),
    span("model-upstream-terminal", 1000100, {
      ...second,
      clockId: "provider-clock",
      completed: true,
    }),
    span("model-complete", 310, {
      ...second,
      completed: true,
      terminalType: "response.completed",
      output: "{}",
    }),
    span("model-parser-start", 318, second),
    span("schema-valid-live-decision", 320, second),
    span("model-attempt-finished", 321, second),
    span("semantic-accepted", 350, {
      attemptId: undefined,
      clockId: undefined,
      revision: 2,
      changed: true,
      changedUnits: ["u1"],
    }),
    span("learner-visible-dom", 400, {
      attemptId: undefined,
      clockId: undefined,
      revision: 2,
      complete: true,
      targets: ["u1"],
    }),
  ]).execution;
  expect(report.counts).toMatchObject({
    instrumentedAttempts: 2,
    finished: 2,
    providerCompleted: 1,
    parserSucceeded: 1,
    hostAccepted: 1,
    failed: 1,
  });
  expect(report.attempts[0].hostAccepted).toBe(false);
  expect(report.attempts[1].timings).toMatchObject({
    providerHeadersMs: 10,
    providerFirstByteMs: 20,
    providerFirstAnswerMs: 30,
    providerCompleteMs: 100,
    browserFirstAnswerMs: 40,
    browserCompleteMs: 110,
    terminalToParserMs: 10,
    parserMs: 2,
    browserToAcceptedMs: 150,
    acceptedToDomMs: 50,
    browserToDomMs: 200,
  });
  expect(report.metrics.Live.browserCompleteMs).toMatchObject({
    attempts: 2,
    observed: 1,
    unavailable: 1,
    medianMs: 110,
    p95Ms: null,
  });
});

it("preserves completed-but-malformed and parsed-but-host-rejected outcomes independently", () => {
  const report = analyze([
    span("model-request", 0),
    span("model-complete", 100, {
      completed: true,
      terminalType: "response.completed",
      output: "{broken",
    }),
    span("model-parser-failed", 105, { succeeded: false }),
    span("model-failure", 105, { reason: "model-malformed-json" }),
    span("model-attempt-finished", 106),
    span("model-request", 200, {
      attemptId: "other",
      taskId: "other-task",
      lane: "Stage",
    }),
    span("model-complete", 300, {
      attemptId: "other",
      taskId: "other-task",
      lane: "Stage",
      completed: true,
      terminalType: "response.completed",
    }),
    span("schema-valid-stage-review", 305, {
      attemptId: "other",
      taskId: "other-task",
      lane: "Stage",
    }),
    span("model-attempt-finished", 306, {
      attemptId: "other",
      taskId: "other-task",
      lane: "Stage",
    }),
    span("proposal-rejected", 310, {
      attemptId: undefined,
      taskId: "other-task",
      lane: "Stage",
      clockId: undefined,
      reason: "stale-dependency:unit/u1",
    }),
  ]).execution;
  expect(report.attempts[0]).toMatchObject({
    providerCompleted: true,
    parserAttempted: true,
    parserSucceeded: false,
    hostEvaluated: false,
  });
  expect(report.attempts[1]).toMatchObject({
    providerCompleted: true,
    parserSucceeded: true,
    hostEvaluated: true,
    hostAccepted: false,
    outcome: "host-rejected",
  });
  expect(report.metrics.Stage.browserToHostMs.medianMs).toBe(110);
  expect(report.metrics.Stage.browserToAcceptedMs.observed).toBe(0);
});

it("does not infer new completion flags for historical traces or subtract mismatched clocks", () => {
  const report = analyze([
    span("model-request", 0, { attemptId: undefined, clockId: undefined }),
    span("model-complete", 100, { attemptId: undefined, clockId: undefined }),
    span("model-request", 200, { attemptId: "new" }),
    span("model-complete", 500, {
      attemptId: "new",
      clockId: "wrong-clock",
      completed: true,
    }),
    span("model-attempt-finished", 600, { attemptId: "new" }),
  ]).execution;
  expect(report.counts.legacyRequestsWithoutAttemptIdentity).toBe(1);
  expect(report.attempts).toHaveLength(1);
  expect(report.attempts[0].timings.browserCompleteMs).toBeNull();
});

it("keeps WAIT inspection and missing visible output out of successful acceptance/DOM samples", () => {
  const report = analyze([
    span("model-request", 0),
    span("model-complete", 100, { completed: true }),
    span("schema-valid-live-decision", 105),
    span("model-attempt-finished", 106),
    span("live-wait", 110, { attemptId: undefined, clockId: undefined }),
    // Existing content at the same revision cannot turn an inspection into new output.
    span("learner-visible-dom", 120, {
      attemptId: undefined,
      complete: true,
      targets: ["old"],
    }),
  ]).execution;
  expect(report.attempts[0]).toMatchObject({
    providerCompleted: true,
    parserSucceeded: true,
    hostEvaluated: true,
    hostAccepted: false,
    hostInspected: true,
    visibleDomObserved: false,
    outcome: "inspected",
  });
  expect(report.metrics.Live.browserToHostMs.observed).toBe(1);
  expect(report.metrics.Live.browserToAcceptedMs.unavailable).toBe(1);
  expect(report.metrics.Live.browserToDomMs.unavailable).toBe(1);
});
