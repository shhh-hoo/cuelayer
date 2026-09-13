import { afterEach, expect, it, vi } from "vitest";
import { Session, TransientFailure, type Interpreter } from "../src/session";
import { EventStore } from "../src/adapters/storage";
import { emptyReplay, fold, type Event, type Task } from "../src/contract";
import { position } from "../src/source";
import { admit, establish, fullGroup, waitDecision } from "./frontier-fixtures";

const original = "The ratio we will use next is...";
const clarification = "The ratio is pressure divided by temperature.";
const sessions: Session[] = [];
const releases: (() => void)[] = [];
const config = {
  coalesceMs: 2,
  maxWaitMs: 8,
  deadlineMs: 2000,
  sourceChars: 2400,
  maxRequestBytes: 28000,
};
const eventually = (assertion: () => void) =>
  vi.waitFor(assertion, { interval: 5, timeout: 1500 });
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
afterEach(() => {
  releases.splice(0).forEach((release) => release());
  sessions.splice(0).forEach((session) => session.close());
  vi.restoreAllMocks();
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
async function open(
  interpreter: Interpreter,
  store = new EventStore(`terminal-runtime-${crypto.randomUUID()}`),
  id: string = crypto.randomUUID(),
) {
  const session = await Session.open(id, interpreter, store, config);
  sessions.push(session);
  return session;
}
function stage(
  task: Task,
  outcome: "CARRY" | "READY_FOR_LIVE" | "STILL_OPEN" = "READY_FOR_LIVE",
) {
  return {
    scope: task.review!.namespace,
    results: task.review!.items.map((item) => ({
      item: item.id,
      outcome,
      ...(outcome === "CARRY"
        ? { kind: "INCOMPLETE_PROPOSITION", core: null }
        : {}),
    })),
  };
}
function complete(task: Task) {
  const request = task.capture!.request;
  const decision = establish(
    task,
    task.capture!.recovery ? original : clarification,
    { kind: "statement", text: clarification },
  );
  decision.attentionCandidate = null;
  const subject = request.obligations.find((item) =>
    item.phrase.includes(original),
  )!;
  const sources = new Set([
    request.source.source,
    subject.source,
    ...request.context
      .filter((item) => item.role === "FOLLOWING_CONTEXT")
      .map((item) => item.source),
  ]);
  const basis = [...sources].map((source) => {
    const cuts = Object.keys(task.capture!.sourceBoundaries[source]);
    return { source, start: cuts[0], end: cuts.at(-1)! };
  });
  for (const operation of decision.groups[0].operations)
    operation.basis = basis;
  decision.groups[0].resolutions = [
    { obligation: subject.id, targets: [request.newUnits[0]], basis },
  ];
  return decision;
}
const failed = (session: Session) =>
  Object.values(session.replay.attempts).find(
    (attempt) => attempt.outcome === "FAILED",
  );

it("the live queue can use clarification before the older Stage classifier returns", async () => {
  const classification = gate();
  let stageStarted = false;
  const session = await open(async (task) => {
    if (task.lane === "Stage") {
      stageStarted = true;
      await classification.promise;
      return stage(task, "CARRY");
    }
    return task.capture!.request.obligations.length
      ? complete(task)
      : fullGroup(task);
  });
  await admit(session, original);
  await eventually(() => expect(stageStarted).toBe(true));
  await admit(session, clarification);
  await eventually(() =>
    expect(Object.keys(session.state.units)).toHaveLength(1),
  );
  classification.release();
  await eventually(() =>
    expect(
      session.trace.spans.some(
        (span) =>
          span.name === "proposal-rejected" &&
          String(span.attributes.reason).startsWith("stale-dependency"),
      ),
    ).toBe(true),
  );
  expect(session.replay.reviewConcerns).toEqual({});
  expect(session.replay.unresolved).toEqual({});
  expect(session.replay.accounted).toEqual(session.replay.recorded);
  const events = await session.store.read(session.id);
  expect(
    events.filter(
      (event) => event.type === "accepted" && event.accepted.lane === "Stage",
    ),
  ).toEqual([]);
});

it("both sources may be accounted before Stage without starving coreless Live recovery", async () => {
  const classification = gate();
  let stageStarted = false;
  let atRecovery: { accounted: unknown; consumed: unknown } | undefined;
  const session = await open(async (task) => {
    if (task.lane === "Stage") {
      stageStarted = true;
      await classification.promise;
      return stage(task);
    }
    if (task.capture!.recovery) {
      atRecovery = structuredClone({
        accounted: session.replay.accounted,
        consumed: session.replay.consumed,
      });
      expect(task.state.cores).toEqual({});
      return complete(task);
    }
    return fullGroup(task);
  });
  await admit(session, original);
  await eventually(() => expect(stageStarted).toBe(true));
  await admit(session, clarification);
  await eventually(() =>
    expect(session.replay.accounted).toEqual(session.replay.recorded),
  );
  classification.release();
  await eventually(() =>
    expect(Object.keys(session.state.units)).toHaveLength(1),
  );
  expect({
    accounted: session.replay.accounted,
    consumed: session.replay.consumed,
  }).toEqual(atRecovery);
  const events = await session.store.read(session.id);
  const accepts = events.flatMap((event) =>
    event.type === "accepted" ? [event.accepted] : [],
  );
  expect(accepts.filter((accepted) => accepted.processing)).toHaveLength(2);
  expect(accepts.filter((accepted) => accepted.recovery)).toHaveLength(1);
  expect(
    accepts
      .filter((accepted) => accepted.lane === "Stage")
      .flatMap((accepted) => accepted.operations),
  ).toEqual([]);
  expect(events.reduce(fold, emptyReplay())).toEqual(session.replay);
});

it("transient recovery retries share one capture and publish once without re-accounting source", async () => {
  const attempts: Task[] = [];
  const session = await open(async (task) => {
    if (task.lane === "Stage") return stage(task);
    if (!task.capture!.recovery) return fullGroup(task);
    attempts.push(task);
    if (attempts.length < 3) throw new TransientFailure("offline-retry");
    return complete(task);
  });
  await admit(session, `${original} ${clarification}`);
  await eventually(() =>
    expect(Object.keys(session.state.units)).toHaveLength(1),
  );
  expect(attempts).toHaveLength(3);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[2]).toEqual(attempts[0]);
  const events = await session.store.read(session.id);
  expect(
    events.filter(
      (event) => event.type === "accepted" && event.accepted.recovery,
    ),
  ).toHaveLength(1);
  expect(session.replay.accounted).toEqual(session.replay.recorded);
});

it("a failed recovery stays suppressed across reload and one explicit retry can finish it", async () => {
  let recoveryCalls = 0;
  let failRecovery = true;
  const interpreter: Interpreter = async (task) => {
    if (task.lane === "Stage") return stage(task);
    if (!task.capture!.recovery) return fullGroup(task);
    recoveryCalls++;
    if (failRecovery) throw new Error("offline-recovery-failure");
    return complete(task);
  };
  const session = await open(interpreter);
  await admit(session, `${original} ${clarification}`);
  await eventually(() =>
    expect(failed(session)?.reason).toBe("offline-recovery-failure"),
  );
  await settle();
  expect(recoveryCalls).toBe(1);
  const { store, id } = session;
  session.close();
  failRecovery = false;
  const restored = await open(interpreter, store, id);
  await settle();
  expect(recoveryCalls).toBe(1);
  expect(await restored.retryFailedLive()).toBe(true);
  await eventually(() =>
    expect(Object.keys(restored.state.units)).toHaveLength(1),
  );
  expect(recoveryCalls).toBe(2);
  expect(await restored.retryFailedLive()).toBe(false);
});

it("a failed no-change append cannot advance accounting without its review ticket", async () => {
  class FailingStore extends EventStore {
    remaining = 1;
    override async append(event: Event, expected: number) {
      if (
        event.type === "accepted" &&
        event.accepted.processing &&
        this.remaining-- > 0
      )
        throw new Error("offline-append-failure");
      return super.append(event, expected);
    }
  }
  let stageCalls = 0;
  const store = new FailingStore(`terminal-append-${crypto.randomUUID()}`);
  const session = await open(async (task) => {
    if (task.lane === "Stage") {
      stageCalls++;
      return stage(task, "STILL_OPEN");
    }
    return fullGroup(task);
  }, store);
  await admit(session, original);
  await eventually(() =>
    expect(failed(session)?.reason).toBe("offline-append-failure"),
  );
  expect(position(session.replay.evidence, session.replay.accounted)).toBe(0);
  expect(session.replay.reviewConcerns).toEqual({});
  expect(stageCalls).toBe(0);
  expect(await session.retryFailedLive()).toBe(true);
  await eventually(() =>
    expect(Object.keys(session.replay.reviewConcerns)).toHaveLength(1),
  );
  await eventually(() => expect(stageCalls).toBe(1));
  const accepted = (await store.read(session.id)).find(
    (event) => event.type === "accepted" && event.accepted.processing,
  );
  expect(accepted).toMatchObject({
    type: "accepted",
    accepted: { reviewRequests: [{ kind: "SOURCE_NO_CHANGE" }] },
  });
  expect(session.replay.accounted).toEqual(session.replay.recorded);
});

it("WAIT recovery inspections survive reload and new accounted context schedules one fresh inspection", async () => {
  let recoveryCalls = 0,
    stageCalls = 0;
  const interpreter: Interpreter = async (task) => {
    if (task.lane === "Stage") {
      stageCalls++;
      return stage(
        task,
        task.review!.items[0].kind === "SOURCE_NO_CHANGE"
          ? "CARRY"
          : "STILL_OPEN",
      );
    }
    if (task.capture!.recovery) {
      recoveryCalls++;
      return waitDecision(task);
    }
    return fullGroup(task);
  };
  const session = await open(interpreter);
  await admit(session, original);
  await eventually(() => expect(recoveryCalls).toBe(1));
  await eventually(() =>
    expect(Object.keys(session.replay.inspections)).toHaveLength(1),
  );
  await settle();
  expect(recoveryCalls).toBe(1);
  const { store, id } = session;
  session.close();
  const restored = await open(interpreter, store, id);
  await settle();
  expect(recoveryCalls).toBe(1);
  await admit(restored, "We will finish that sentence later.");
  await eventually(() => expect(recoveryCalls).toBe(2));
  await settle();
  expect(recoveryCalls).toBe(2);
  expect(Object.values(restored.replay.unresolved)[0].phrase).toBe(original);
  expect(restored.state.units).toEqual({});
  expect(restored.replay.accounted).toEqual(restored.replay.recorded);
  expect(stageCalls).toBe(1);
});

it("capture closure seals without waiting for an in-flight recovery and prevents its late write", async () => {
  const inference = gate();
  let recoveryStarted = false;
  const session = await open(async (task) => {
    if (task.lane === "Stage") return stage(task);
    if (!task.capture!.recovery) return fullGroup(task);
    recoveryStarted = true;
    await inference.promise;
    return complete(task);
  });
  await admit(session, original);
  await eventually(() => expect(recoveryStarted).toBe(true));
  await session.finish();
  expect(session.replay.ended).toBe(true);
  expect(Object.keys(session.replay.reviewConcerns)).toHaveLength(1);
  inference.release();
  await settle();
  expect(session.state.units).toEqual({});
  expect((await session.store.read(session.id)).at(-1)?.type).toBe("ended");
});
