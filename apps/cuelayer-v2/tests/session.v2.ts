import { afterEach, describe, expect, it, vi } from "vitest";
import { Session, TransientFailure } from "../src/session";
import { EventStore } from "../src/adapters/storage";
import { SpeechEvidenceAdapter } from "../src/adapters/speech";
import {
  deterministicInterpreter,
  fixtureProposal,
  inject,
  story,
  delay,
} from "../src/story";
import { emptyReplay, fold, type Event, type Task } from "../src/contract";
import { validate } from "../src/acceptance";
const sessions: Session[] = [];
const open = async (
  interpreter = deterministicInterpreter({ live: 2, stage: 80 }),
) => {
  const session = await Session.open(
    crypto.randomUUID(),
    interpreter,
    new EventStore(`test-${crypto.randomUUID()}`),
  );
  sessions.push(session);
  return session;
};
const step = async (
  s: Session,
  i: number,
  index = s.replay.evidence.length,
) => {
  await inject(s, story[i], index);
  await s.drainLive();
};
afterEach(() => {
  sessions.forEach((s) => s.close());
  sessions.length = 0;
  vi.restoreAllMocks();
});

describe("authoritative evidence frontier", () => {
  it("partials and preflight cannot establish truth; EndOfUtterance does not finalize them", async () => {
    const s = await open();
    await s.speech.receive({
      message: "AddPartialTranscript",
      metadata: { transcript: story[0], start_time: 0, end_time: 1 },
    });
    s.speech.preflight();
    expect(s.window.preflight).toMatchObject({ stability: "PREFLIGHT" });
    await s.speech.receive({
      message: "EndOfUtterance",
      metadata: { transcript: story[0], start_time: 0, end_time: 1 },
    });
    expect(s.replay.evidence).toHaveLength(0);
    expect(s.state.revision).toBe(0);
  });
  it("retransmission is idempotent; different interval repeats stay distinct; conflicts fail closed", async () => {
    const s = await open();
    await inject(s, story[0], 0);
    await inject(s, story[0], 0);
    await s.drainLive();
    expect(s.replay.evidence).toHaveLength(1);
    await inject(s, "Continue.", 1);
    await inject(s, "Continue.", 2);
    await s.drainLive();
    expect(s.replay.evidence).toHaveLength(3);
    await expect(inject(s, "Conflicting text", 0)).rejects.toThrow(
      "evidence-identity-collision",
    );
    expect(s.window.consumedEvidenceIds).toHaveLength(3);
  });
  it("failed N blocks N+1 and sealing until N is durably retried", async () => {
    const s = await open(),
      original = s.store.append.bind(s.store);
    let fail = true;
    vi.spyOn(s.store, "append").mockImplementation(async (event, expected) => {
      if (event.type === "evidence" && fail) throw new Error("disk-failed");
      return original(event, expected);
    });
    await expect(inject(s, story[0], 0)).rejects.toThrow("disk-failed");
    await expect(inject(s, story[2], 1)).rejects.toThrow("frontier-blocked");
    expect(s.replay.evidence).toHaveLength(0);
    await expect(s.finish()).rejects.toThrow("frontier-blocked");
    fail = false;
    await expect(inject(s, "Changed failed final", 0)).rejects.toThrow(
      "evidence-identity-collision",
    );
    await inject(s, story[0], 0);
    await inject(s, story[2], 1);
    await s.drainLive();
    expect(s.replay.evidence.map((e) => e.sequence)).toEqual([1, 2]);
    expect(s.window.consumedEvidenceIds).toHaveLength(2);
  });
  it("persist before publish, recover lost acknowledgement, and no double acceptance", async () => {
    const s = await open();
    const original = s.store.append.bind(s.store);
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    vi.spyOn(s.store, "append").mockImplementation(async (event, expected) => {
      if (event.type === "accepted") {
        await hold;
        await original(event, expected);
        throw new Error("ack-lost");
      }
      await original(event, expected);
    });
    await inject(s, story[0], 0);
    await delay(50);
    expect(s.state.revision).toBe(0);
    expect(s.window.consumedEvidenceIds).toHaveLength(0);
    release();
    await s.drainLive();
    expect(s.state.currentCoreId).toBe("gases");
    const events = await s.store.read(s.id);
    expect(events.filter((e) => e.type === "accepted")).toHaveLength(1);
    expect(events.reduce(fold, emptyReplay())).toEqual(s.replay);
  });
});
describe("semantic coordination and acceptance", () => {
  it("Live runs while evidence keeps arriving; independent max wait bounds dispatch", async () => {
    const starts: number[] = [],
      sizes: number[] = [];
    const s = await open(async (task, signal, first) => {
      if (task.lane === "Live") {
        starts.push(performance.now());
        sizes.push(task.evidence.length);
      }
      await delay(35, signal);
      first();
      return fixtureProposal(task);
    });
    const begin = performance.now();
    let maxAge = 0;
    for (let i = 0; i < 60; i++) {
      await inject(s, i === 0 ? story[0] : "Continue.", i);
      maxAge = Math.max(maxAge, s.window.oldestPendingAge);
      await delay(8);
    }
    expect(s.window.consumedEvidenceIds.length).toBeGreaterThan(10);
    await s.drainLive();
    expect(starts[0] - begin).toBeLessThan(150);
    expect(maxAge).toBeLessThan(200);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(4);
    expect(s.window.consumedEvidenceIds).toEqual(
      s.replay.evidence.map((e) => e.id),
    );
  });
  it("incomplete and quantitative missing-operand proposals fail before consumption", async () => {
    const s = await open();
    s.pause();
    await inject(s, story[0], 0);
    const task = s.capture("Live", s.replay.evidence, []),
      raw = fixtureProposal(task);
    expect(() => validate(s.replay, task, { ...raw, complete: false })).toThrow(
      "malformed",
    );
    raw.operations.push({
      type: "put",
      id: "bad",
      coreId: "gases",
      meaning: {
        kind: "quantity",
        expression: ["Equal", "x", ["Divide", 1]],
        symbols: { x: { label: "x", unit: "m" } },
        conditions: [],
      },
      basis: [
        { evidenceId: task.evidence[0].id, quote: task.evidence[0].text },
      ],
      requires: [],
    });
    await expect(s.accept(task, raw)).rejects.toThrow("missing-operand");
    expect(s.state.revision).toBe(0);
  });
  it("explicit no-change differs from unresolved and Stage never consumes again", async () => {
    const s = await open();
    for (const i of [0, 1, 2, 3, 5, 6]) await step(s, i);
    await vi.waitFor(() =>
      expect(s.state.units["fraction-share"]).toBeDefined(),
    );
    expect(Object.values(s.replay.unresolved).map((o) => o.phrase)).toEqual([
      story[1],
    ]);
    expect(Object.values(s.replay.consumed).map((d) => d.status)).toContain(
      "no-change",
    );
    expect(s.window.consumedEvidenceIds).toHaveLength(6);
    const events = await s.store.read(s.id);
    for (const e of events)
      if (e.type === "accepted" && e.accepted.lane === "Stage")
        expect(e.accepted.dispositions).toEqual([]);
  });
  it("relevant dependency change rejects stale Stage; unrelated mainline keeps historical refinement valid and discards attention", async () => {
    const s = await open();
    for (const i of [0, 2, 3, 5, 6]) await step(s, i);
    s.pause();
    await delay(100);
    // Use a detached task with a different snapshot identity for explicit conflict checks.
    const evidence = s.replay.evidence;
    const stale = s.capture("Stage", evidence, ["gases"]);
    stale.id += ":stale";
    s.resume();
    await step(s, 9);
    s.pause();
    await expect(s.accept(stale, fixtureProposal(stale))).rejects.toThrow(
      "stale-dependency",
    );
    const late = s.capture("Stage", s.replay.evidence, ["gases"]);
    late.id += ":late";
    late.createdAt -= 1000;
    s.resume();
    await step(s, 7);
    s.pause();
    const p = fixtureProposal(late);
    p.attention = { mode: "FOCUS", targets: ["pressure"] };
    await s.accept(late, p);
    expect(s.state.currentCoreId).toBe("reactions");
    expect(
      s.trace.spans.some(
        (span) =>
          span.name === "attention-discarded" &&
          span.attributes.taskId === late.id,
      ),
    ).toBe(true);
  });
  it("reload restores accepted state, unresolved obligations and unconsumed evidence from log only", async () => {
    const s = await open();
    for (const i of [0, 1, 2]) await step(s, i);
    s.pause();
    await inject(s, "Continue.", 3);
    const before = s.state,
      obligations = s.replay.unresolved;
    s.close();
    const restored = await Session.open(
      s.id,
      deterministicInterpreter({ live: 2, stage: 2 }),
      s.store,
    );
    sessions.push(restored);
    expect(restored.state).toEqual(before);
    expect(restored.replay.unresolved).toEqual(obligations);
    expect(restored.attention).toBeNull();
    await restored.drainLive();
    expect(restored.window.consumedEvidenceIds).toHaveLength(4);
  });
  it("transient interpreter retry uses same task; invalid output does not retry or consume", async () => {
    let calls = 0;
    const ids: string[] = [];
    const s = await open(async (task) => {
      calls++;
      ids.push(task.id);
      if (calls < 3) throw new TransientFailure("temporary");
      return fixtureProposal(task);
    });
    await step(s, 0);
    expect(calls).toBe(3);
    expect(new Set(ids).size).toBe(1);
    const bad = await open(async () => ({ complete: false }));
    await inject(bad, story[0], 0);
    await vi.waitFor(() => expect(bad.error).toContain("malformed"));
    expect(bad.window.consumedEvidenceIds).toHaveLength(0);
  });
  it("competing durable writers cannot both append the same prefix", async () => {
    const store = new EventStore(`competing-${crypto.randomUUID()}`),
      id = crypto.randomUUID();
    const first = await Session.open(id, deterministicInterpreter(), store),
      second = await Session.open(id, deterministicInterpreter(), store);
    sessions.push(first, second);
    first.pause();
    second.pause();
    const results = await Promise.allSettled([
      inject(first, story[0], 0),
      inject(second, story[2], 1),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await store.read(id)).toHaveLength(1);
  });
});
it("local correction keeps identity; invalidation must close required dependencies", async () => {
  const s = await open();
  for (const i of [0, 2, 3, 9]) await step(s, i);
  s.pause();
  expect(s.state.units.pressure.version).toBe(2);
  expect(s.state.units.fraction.valid).toBe(true);
  await inject(s, "Withdraw both relationships.", 10);
  const task = s.capture(
    "Live",
    s.replay.evidence.filter((e) => !s.replay.consumed[e.id]),
    ["gases"],
  );
  const raw = fixtureProposal(task),
    basis = [{ evidenceId: task.evidence[0].id, quote: task.evidence[0].text }];
  raw.operations = [{ type: "invalidate", id: "pressure", basis }];
  raw.dispositions[0].status = "established";
  await expect(s.accept(task, raw)).rejects.toThrow(
    "invalid-semantic-dependency",
  );
  raw.operations.unshift({ type: "invalidate", id: "fraction", basis });
  await s.accept(task, raw);
  expect(s.state.units.pressure.valid).toBe(false);
  expect(s.state.units.mixture.valid).toBe(true);
});
