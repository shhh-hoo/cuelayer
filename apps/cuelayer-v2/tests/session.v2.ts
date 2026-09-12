import { afterEach, it, expect, vi } from "vitest";
import { Session, TransientFailure } from "../src/session";
import { EventStore } from "../src/adapters/storage";
import { deterministicInterpreter, inject, story, delay } from "../src/story";
import { emptyReplay, fold } from "../src/contract";
import {
  admit,
  openSession,
  fullGroup,
  waitDecision,
  establish,
  currentQuote,
  fast,
} from "./frontier-fixtures";
const sessions: Session[] = [];
async function open(...args: Parameters<typeof openSession>) {
  const s = await openSession(...args);
  sessions.push(s);
  return s;
}
afterEach(() => {
  sessions.forEach((s) => s.close());
  sessions.length = 0;
  vi.restoreAllMocks();
});
it("volatile partial, preflight and EndOfUtterance cannot establish evidence", async () => {
  const s = await open();
  for (const message of ["AddPartialTranscript", "EndOfUtterance"] as const) {
    await s.speech.receive({
      message,
      metadata: { transcript: story[0], start_time: 0, end_time: 1 },
    });
    s.speech.preflight();
  }
  expect(s.replay.evidence).toHaveLength(0);
  expect(s.state.revision).toBe(0);
});
it("same interval retransmits idempotently; changed content collides", async () => {
  const s = await open(async (t) => fullGroup(t));
  await inject(s, "Please continue.", 0);
  await inject(s, "Please continue.", 0);
  await s.drainLive();
  expect(s.replay.evidence).toHaveLength(1);
  await expect(inject(s, "Different source.", 0)).rejects.toThrow(
    "evidence-identity-collision",
  );
});
it("failed N blocks N+1 and sealing until exact evidence is retried", async () => {
  const s = await open(async (t) => fullGroup(t)),
    append = s.store.append.bind(s.store);
  let fail = true;
  vi.spyOn(s.store, "append").mockImplementation(async (e, n) => {
    if (e.type === "evidence" && fail) throw new Error("disk-failed");
    await append(e, n);
  });
  await expect(inject(s, story[0], 0)).rejects.toThrow("disk-failed");
  await expect(inject(s, story[2], 1)).rejects.toThrow("frontier-blocked");
  await expect(s.finish()).rejects.toThrow("frontier-blocked");
  fail = false;
  await expect(inject(s, "Changed", 0)).rejects.toThrow("identity-collision");
  await inject(s, story[0], 0);
  await inject(s, story[2], 1);
  await s.drainLive();
  expect(s.replay.evidence.map((e) => e.sequence)).toEqual([1, 2]);
});
it("acceptance persists before publication and observer failures cannot undo committed state", async () => {
  const s = await open(async (t) => fullGroup(t));
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r)),
    append = s.store.append.bind(s.store);
  vi.spyOn(s.store, "append").mockImplementation(async (e, n) => {
    if (e.type === "accepted") await hold;
    await append(e, n);
  });
  s.subscribe(() => {
    throw new Error("observer");
  });
  await admit(s, "Please continue.");
  await vi.waitFor(() => expect(s.window.activeLive).not.toBeNull());
  expect(s.window.consumedEvidenceIds).toHaveLength(0);
  release();
  await s.drainLive();
  expect(s.window.unaccountedChars).toBe(0);
  expect(s.replay).toEqual(
    (await s.store.read(s.id)).reduce(fold, emptyReplay()),
  );
});
it("transient retries retain task identity; semantic failures do not retry", async () => {
  const ids: string[] = [];
  const s = await open(async (t) => {
    ids.push(t.id);
    if (ids.length < 3) throw new TransientFailure("temporary");
    return fullGroup(t);
  });
  await admit(s, "Please continue.");
  await s.drainLive();
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(1);
  const bad = vi.fn(async () => ({ complete: false })),
    b = await open(bad);
  await admit(b, "Please continue.");
  await expect(b.drainLive()).rejects.toThrow("malformed");
  b.resume();
  await delay(30);
  expect(bad).toHaveBeenCalledTimes(1);
});
it("competing writers cannot both commit the same durable prefix", async () => {
  const store = new EventStore(`race-${crypto.randomUUID()}`),
    id = crypto.randomUUID();
  const a = await Session.open(id, async (t) => waitDecision(t), store, fast),
    b = await Session.open(id, async (t) => waitDecision(t), store, fast);
  sessions.push(a, b);
  a.pause();
  b.pause();
  const results = await Promise.allSettled([admit(a, "A"), admit(b, "B")]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await store.read(id)).toHaveLength(1);
});
it("mutable or foreign captured task cannot authorize acceptance", async () => {
  const s = await open();
  s.pause();
  await admit(s, "Please continue.");
  const t = s.capture("Live");
  await expect(
    s.accept({ ...t, sessionId: "foreign" }, fullGroup(t)),
  ).rejects.toThrow("task-binding");
  await expect(s.accept({ ...t, createdAt: 0 }, fullGroup(t))).rejects.toThrow(
    "task-binding",
  );
  expect(s.window.unaccountedChars).toBeGreaterThan(0);
});
it("a newer source arriving during prefix WAIT is eligible and not suppressed", async () => {
  let release!: () => void,
    calls = 0;
  const held = new Promise<void>((r) => (release = r));
  const s = await open(async (t) => {
    if (++calls === 1) {
      await held;
      return waitDecision(t);
    }
    return fullGroup(t);
  });
  await admit(s, "Please");
  await vi.waitFor(() => expect(calls).toBe(1));
  await admit(s, "continue.");
  release();
  await s.drainLive();
  await s.drainLive();
  expect(calls).toBe(2);
  expect(s.window.unaccountedChars).toBe(0);
});
it("representation unsupported keeps accepted meaning and creates no semantic obligation", async () => {
  const s = await open();
  s.pause();
  await admit(s, "The function is y equals x plus one.");
  const t = s.capture("Live");
  const d = establish(t, currentQuote(s, t), {
    kind: "quantity",
    expression: ["Equal", "y", ["Add", "x", 1]],
    symbols: {
      y: { label: "dependent", unit: "dimensionless" },
      x: { label: "independent", unit: "dimensionless" },
    },
    conditions: [],
    domain: [0, 5],
    independent: "x",
  });
  await s.accept(t, d);
  expect(s.state.revision).toBeGreaterThan(0);
  expect(s.replay.unresolved).toEqual({});
});
it("authored synthetic story uses the new wire and preserves math, correction, relation and Cue history", async () => {
  const s = await open(deterministicInterpreter({ live: 1, stage: 5 }));
  for (const i of [0, 2, 3, 4, 7, 8, 9, 10]) {
    await inject(s, story[i], s.replay.evidence.length);
    await s.drainLive();
  }
  const units = Object.values(s.state.units);
  expect(
    units.some(
      (u) =>
        u.meaning.kind === "quantity" &&
        u.meaning.symbols.p_i &&
        u.version === 2,
    ),
  ).toBe(true);
  expect(units.some((u) => u.meaning.kind === "relation")).toBe(true);
  expect(s.state.cue?.origin).toBe("TEACHER");
  expect(s.window.unaccountedChars).toBe(0);
});

it("ordered groups may extend a Core established by an earlier group in the same decision", async () => {
  const s = await open(deterministicInterpreter({ live: 1, stage: 5 }));
  s.pause();
  for (const i of [0, 2, 3])
    await inject(s, story[i], s.replay.evidence.length);
  s.resume();
  await s.drainLive();
  expect(Object.keys(s.state.cores)).toHaveLength(1);
  expect(Object.keys(s.state.units)).toHaveLength(3);
  expect(s.window.unaccountedChars).toBe(0);
});
