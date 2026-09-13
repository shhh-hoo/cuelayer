import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Session, type Interpreter } from "../src/session";
import { EventStore } from "../src/adapters/storage";
import type { Task } from "../src/contract";
import { ExecutionFailure } from "../src/execution-contract";
import {
  latencyPolicy,
  type RuntimeLatencyPolicy,
} from "../src/latency-policy";
import {
  admit,
  establish,
  fixtureBasis,
  fullGroup,
  waitDecision,
} from "./frontier-fixtures";

const sessions: Session[] = [];
const policy: RuntimeLatencyPolicy = {
  ...latencyPolicy,
  lanes: {
    Live: {
      providerHardMs: 400,
      hostTotalMs: 500,
      freshness: {
        firstAnswerMs: 50,
        completeMs: 80,
        acceptedMs: 100,
        visibleMs: 120,
      },
    },
    Stage: {
      providerHardMs: 400,
      hostTotalMs: 500,
      freshness: { completeMs: 100, acceptedMs: 150 },
    },
  },
  attention: { admissionMs: 100, publishedTtlMs: 30 },
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
  });
});
afterEach(() => {
  sessions.forEach((s) => s.close());
  sessions.length = 0;
  vi.useRealTimers();
});
async function open(interpreter: Interpreter = async (t) => waitDecision(t)) {
  const s = await Session.open(
    crypto.randomUUID(),
    interpreter,
    new EventStore(`latency-policy-${crypto.randomUUID()}`),
    {
      coalesceMs: 1,
      maxWaitMs: 2,
      deadlineMs: 500,
      sourceChars: 2400,
      maxRequestBytes: 28000,
      latencyPolicy: structuredClone(policy),
    },
  );
  sessions.push(s);
  return s;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const names = (s: Session) => s.trace.spans.map((span) => span.name);

it("rejects a fast stale Live result after a Stage revision without accounting its source", async () => {
  const s = await open();
  s.pause();
  const source = "A mole fraction is a ratio of amounts.";
  await admit(s, source);
  const initial = s.capture("Live");
  const first = establish(initial, source, {
    kind: "statement",
    text: "A mole fraction is a ratio.",
  });
  first.attentionCandidate = null;
  first.reviewRequests = [
    {
      core: initial.capture!.request.newCores[0],
      targets: [initial.capture!.request.newUnits[0]],
      purpose: "Check the complete definition",
    },
  ];
  await s.accept(initial, first);
  await admit(s, "The mole fraction determines its share.");
  const stale = s.capture("Live");
  const oldAnswer = establish(stale, "The mole fraction determines its share.");
  const stage = s.capture("Stage");
  const reviewed = stage.review!.request;
  await s.accept(stage, {
    scope: reviewed.scope,
    results: [
      {
        item: reviewed.items[0].id,
        outcome: "RESOLVED",
        operations: [
          {
            type: "revise",
            id: reviewed.units[0].id,
            change: { field: "text", value: source },
            basis: fixtureBasis(stage, source),
          },
        ],
        resolution: null,
      },
    ],
  });
  const before = s.replay;
  await vi.advanceTimersByTimeAsync(1);
  await expect(s.accept(stale, oldAnswer)).rejects.toThrow(
    "stale-dependency:unit",
  );
  expect(performance.now() - stale.createdAt).toBeLessThan(
    policy.attention.admissionMs,
  );
  expect(s.replay.accounted).toEqual(before.accounted);
  expect(s.replay.evidence.map((e) => e.text)).toEqual([
    source,
    "The mole fraction determines its share.",
  ]);
  expect(s.window.unaccountedChars).toBeGreaterThan(0);
  expect(Object.values(s.state.units).map((u) => u.meaning)).toEqual([
    { kind: "statement", text: source },
  ]);
  expect(s.attention).toBeNull();
});

it("accepts valid slow meaning before the hard deadline after its attention freshness target", async () => {
  const started = deferred<void>();
  const answer = deferred<unknown>();
  let task!: Task;
  const s = await open(async (t) => {
    task = t;
    started.resolve();
    return answer.promise;
  });
  await admit(s, "A mole fraction is a ratio.");
  const drained = s.drainLive();
  await started.promise;
  await vi.advanceTimersByTimeAsync(150);
  answer.resolve(establish(task, "A mole fraction is a ratio."));
  await drained;
  expect(performance.now() - task.createdAt).toBeLessThan(
    policy.lanes.Live.hostTotalMs,
  );
  expect(s.window.unaccountedChars).toBe(0);
  expect(Object.values(s.state.units).map((u) => u.meaning)).toEqual([
    { kind: "statement", text: "A mole fraction is a ratio." },
  ]);
  expect(s.attention).toBeNull();
  expect(names(s)).toContain("semantic-accepted");
  expect(names(s)).toContain("attention-expired");
});

it("releases a hard-deadline slot for queued newer evidence even when the old interpreter ignores abort", async () => {
  const firstStarted = deferred<void>();
  const secondStarted = deferred<void>();
  const firstAnswer = deferred<unknown>();
  const secondAnswer = deferred<unknown>();
  const calls: Task[] = [];
  let firstSignal!: AbortSignal;
  let lateFirstByte!: () => void;
  const s = await open(async (task, signal, onFirstByte) => {
    calls.push(task);
    if (calls.length === 1) {
      firstSignal = signal;
      lateFirstByte = onFirstByte;
      firstStarted.resolve();
      return firstAnswer.promise; // Deliberately never observes signal.
    }
    secondStarted.resolve();
    return secondAnswer.promise;
  });
  await admit(s, "The pressure is 90 kPa.");
  const drained = s.drainLive();
  const drainResult = drained.then(
    () => null,
    (error: unknown) => error,
  );
  await firstStarted.promise;
  await vi.advanceTimersByTimeAsync(10);
  await admit(s, "Correction: the pressure is 95 kPa.");
  await vi.advanceTimersByTimeAsync(491);
  expect(firstSignal.aborted).toBe(true);
  // Allow native IndexedDB to persist the failure before the new capture starts.
  await vi.waitFor(() => expect(calls).toHaveLength(2), {
    timeout: 100,
    interval: 1,
  });
  await secondStarted.promise;
  expect(s.window.activeLive?.id).toBe(calls[1].id);
  expect(s.replay.accounted.sequence).toBe(0);
  expect(calls[1].evidence.map((e) => e.id)).toEqual(["e0", "e1"]);
  expect(calls[1].id).not.toBe(calls[0].id);
  secondAnswer.resolve(
    establish(
      calls[1],
      "The pressure is 90 kPa. Correction: the pressure is 95 kPa.",
      { kind: "statement", text: "The pressure is 95 kPa." },
    ),
  );
  expect(await drainResult).toBeNull();
  const settled = s.replay;
  const bytesBefore = names(s).filter(
    (n) => n === "first-provider-byte",
  ).length;
  lateFirstByte();
  firstAnswer.resolve(establish(calls[0], "The pressure is 90 kPa."));
  await vi.advanceTimersByTimeAsync(0);
  expect(s.replay).toEqual(settled);
  expect(names(s).filter((n) => n === "first-provider-byte")).toHaveLength(
    bytesBefore,
  );
  expect(s.window.activeLive).toBeNull();
  expect(s.window.unaccountedChars).toBe(0);
  expect(Object.values(s.state.units).map((u) => u.meaning)).toEqual([
    { kind: "statement", text: "The pressure is 95 kPa." },
  ]);
  const failures = (await s.store.read(s.id)).filter(
    (e) => e.type === "live-attempt" && e.attempt.outcome === "FAILED",
  );
  expect(failures).toHaveLength(1);
  expect(failures[0]).toMatchObject({
    attempt: { id: calls[0].id, category: "transport" },
  });
  expect(settled.acceptedTaskIds).not.toContain(calls[0].id);
  expect(settled.acceptedTaskIds).toContain(calls[1].id);
});

it("starts published attention TTL at publication rather than at capture freshness", async () => {
  const s = await open();
  s.pause();
  await admit(s, "A mole fraction is a ratio.");
  const task = s.capture("Live");
  await vi.advanceTimersByTimeAsync(90);
  await s.accept(task, establish(task, "A mole fraction is a ratio."));
  expect(s.attention?.expiresAt).toBe(120);
  const state = s.state;
  await vi.advanceTimersByTimeAsync(20);
  expect(performance.now() - task.createdAt).toBeGreaterThan(
    policy.attention.admissionMs,
  );
  expect(s.attention).not.toBeNull();
  await vi.advanceTimersByTimeAsync(10);
  expect(s.attention).toBeNull();
  expect(s.state).toEqual(state);
});

it("suppresses fresh attention on a valid semantic prefix when newer teacher source exists", async () => {
  const s = await open();
  s.pause();
  await admit(s, "A mole fraction is a ratio.");
  const task = s.capture("Live");
  await vi.advanceTimersByTimeAsync(1);
  await admit(s, "Now discuss the next example.");
  await s.accept(task, establish(task, "A mole fraction is a ratio."));
  expect(performance.now() - task.createdAt).toBeLessThan(
    policy.attention.admissionMs,
  );
  expect(s.attention).toBeNull();
  expect(names(s)).toContain("attention-superseded");
  expect(s.replay.accounted.evidenceId).toBe("e0");
  expect(s.window.unaccountedChars).toBeGreaterThan(0);
  expect(Object.values(s.state.units)).toHaveLength(1);
  const current = s.capture("Live");
  await s.accept(current, fullGroup(current));
  expect(s.window.unaccountedChars).toBe(0);
});

it("persists a parser schema failure as semantic without retrying or accounting its source", async () => {
  const interpreter = vi.fn(async () => {
    throw new ExecutionFailure("model-schema-invalid");
  });
  const s = await open(interpreter);
  await admit(s, "A mole fraction is a ratio.");
  await expect(s.drainLive()).rejects.toThrow("model-schema-invalid");
  await vi.advanceTimersByTimeAsync(1000);
  expect(interpreter).toHaveBeenCalledTimes(1);
  expect(
    s.trace.spans.filter((span) => span.name === "inference-attempt"),
  ).toHaveLength(1);
  const events = await s.store.read(s.id);
  const attempts = events.filter((event) => event.type === "live-attempt");
  expect(attempts).toHaveLength(2);
  expect(attempts).toMatchObject([
    { attempt: { outcome: "STARTED" } },
    {
      attempt: {
        outcome: "FAILED",
        category: "semantic",
        reason: "model-schema-invalid",
      },
    },
  ]);
  expect(events.filter((event) => event.type === "accepted")).toEqual([]);
  expect(s.replay.evidence.map((e) => e.text)).toEqual([
    "A mole fraction is a ratio.",
  ]);
  expect(s.replay.accounted.sequence).toBe(0);
  expect(s.window.unaccountedChars).toBeGreaterThan(0);
  expect(s.window.activeLive).toBeNull();
  expect(s.error).toBe("model-schema-invalid");
});
