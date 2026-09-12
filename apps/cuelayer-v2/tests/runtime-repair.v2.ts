import { afterEach, expect, it, vi } from "vitest";
import { Session } from "../src/session";
import { captureLive } from "../src/projection";
import {
  admit,
  establish,
  fullGroup,
  openSession,
  waitDecision,
} from "./frontier-fixtures";
const sessions: Session[] = [];
afterEach(() => {
  sessions.splice(0).forEach((s) => s.close());
  vi.restoreAllMocks();
});
async function open(interpreter: Parameters<typeof openSession>[0]) {
  const s = await openSession(interpreter);
  sessions.push(s);
  return s;
}
it("a failed older Live does not pause source already committed while it was running", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const calls: string[] = [];
  const s = await open(async (t) => {
    calls.push(t.id);
    if (calls.length === 1) {
      await held;
      throw new Error("malformed-old-result");
    }
    return fullGroup(t);
  });
  await admit(s, "Please");
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  await admit(s, "continue.");
  release();
  await vi.waitFor(() => expect(s.window.unaccountedChars).toBe(0), {
    timeout: 300,
  });
  expect(calls).toHaveLength(2);
  expect(s.window.status).not.toBe("INTERPRETATION_PAUSED");
});
it("an explicit retry makes one fresh attempt, unlike resume", async () => {
  let calls = 0;
  const s = await open(async (t) => {
    if (++calls === 1) throw new Error("malformed-result");
    return fullGroup(t);
  });
  await admit(s, "Please continue.");
  await expect(s.drainLive()).rejects.toThrow();
  expect(typeof (s as any).retryFailedLive).toBe("function");
  await Promise.all([
    (s as any).retryFailedLive(),
    (s as any).retryFailedLive(),
  ]);
  await vi.waitFor(() => expect(s.window.unaccountedChars).toBe(0));
  expect(calls).toBe(2);
  expect(s.replay.acceptedTaskIds).toHaveLength(1);
});
it("reload preserves a failed inspection instead of implicitly retrying it", async () => {
  const s = await open(async () => {
    throw new Error("malformed-result");
  });
  await admit(s, "Please continue.");
  await expect(s.drainLive()).rejects.toThrow();
  s.close();
  const interpreter = vi.fn(async (t) => fullGroup(t));
  const restored = await Session.open(s.id, interpreter, s.store, s.config);
  sessions.push(restored);
  await new Promise((r) => setTimeout(r, 40));
  expect(interpreter).not.toHaveBeenCalled();
  expect(restored.window.status).toBe("INTERPRETATION_PAUSED");
});
it("a valid teacher Cue can publish without optional attention", async () => {
  const s = await open(async (t) => waitDecision(t));
  s.pause();
  await admit(s, "Pressure is 200 kPa. Compare the pressure.");
  const t = s.capture("Live");
  const d = establish(t, "Pressure is 200 kPa. Compare the pressure.");
  const put = d.groups[0].operations.find((o) => o.type === "put")!;
  d.groups[0].operations.push({
    type: "cue",
    value: { text: "Compare the pressure.", targets: [put.id] },
    basis: put.basis,
  });
  d.attentionCandidate = null;
  await s.accept(t, d);
  expect(s.cuePresentation).not.toBeNull();
});
it("accepted attention actually expires without another semantic event", async () => {
  const s = await open(async (t) => waitDecision(t));
  s.pause();
  await admit(s, "Pressure is 200 kPa.");
  const t = s.capture("Live");
  await s.accept(t, establish(t, "Pressure is 200 kPa."));
  expect(s.attention).not.toBeNull();
  const revision = s.state.revision;
  await new Promise((r) => setTimeout(r, 780));
  expect(s.attention).toBeNull();
  expect(s.state.revision).toBe(revision);
});
it("a large Core is a bounded neighborhood rather than an all-members closure", async () => {
  const s = await open(async (t) => waitDecision(t));
  s.pause();
  await admit(s, "A new independent proposition.");
  const replay = s.replay;
  replay.state.cores.c = {
    id: "c",
    title: "Topic",
    version: 1,
    membership: 200,
    unitIds: [],
  };
  replay.state.currentCoreId = "c";
  for (let i = 0; i < 200; i++) {
    const id = `u${i}`;
    replay.state.cores.c.unitIds.push(id);
    replay.state.units[id] = {
      id,
      coreId: "c",
      version: 1,
      valid: true,
      meaning: { kind: "statement", text: `Known proposition ${i}.` },
      basis: [],
      requires: [],
    };
  }
  const t = captureLive(replay, s.id, "large", 0);
  expect(Object.keys(t.state.units).length).toBeLessThanOrEqual(48);
  expect(Object.keys(t.state.units).length).toBeGreaterThan(0);
  expect(Object.keys(replay.state.units)).toHaveLength(200);
});
it("a truncated WAIT sees new following context without consuming it twice", async () => {
  const observations: string[] = [];
  const s = await open(async (t) => {
    const r = t.capture!.request;
    observations.push(r.source.text + JSON.stringify(r.context));
    if (r.units.length) return fullGroup(t);
    if (
      !r.context.some((c) =>
        c.text.replace(/<b\d+>/g, "").includes("successful collisions"),
      )
    )
      return waitDecision(t);
    return establish(t, r.source.text.replace(/<b\d+>/g, ""), {
      kind: "statement",
      text: "Activation energy is required for successful collisions.",
    });
  });
  s.config.sourceChars = 24;
  await admit(s, "Activation energy is the minimum energy");
  await vi.waitFor(() => expect(observations.length).toBeGreaterThanOrEqual(2));
  const count = observations.length;
  await new Promise((r) => setTimeout(r, 20));
  expect(observations).toHaveLength(count);
  await admit(s, "required for successful collisions.");
  await vi.waitFor(() => expect(s.window.unaccountedChars).toBe(0));
  expect(Object.keys(s.state.units)).toHaveLength(1);
  expect(Object.values(s.state.units)[0].version).toBe(1);
});
it("unrelated semantic changes do not change the actual inspection basis", async () => {
  const s = await open(async (t) => waitDecision(t));
  s.pause();
  await admit(s, "Wait for a continuation.");
  const r = s.replay;
  r.state.cores.a = {
    id: "a",
    title: "Current",
    version: 1,
    membership: 0,
    unitIds: [],
  };
  r.state.cores.b = {
    id: "b",
    title: "Unrelated",
    version: 1,
    membership: 1,
    unitIds: ["other"],
  };
  r.state.currentCoreId = "a";
  r.state.units.other = {
    id: "other",
    coreId: "b",
    version: 1,
    valid: true,
    meaning: { kind: "statement", text: "Hydrogen." },
    basis: [],
    requires: [],
  };
  const first = captureLive(r, s.id, "one", 0);
  const newer = structuredClone(r);
  newer.state.units.other.version++;
  newer.state.units.other.meaning = { kind: "statement", text: "Helium." };
  newer.state.revision++;
  expect(captureLive(newer, s.id, "two", 0).inspectionKey).toBe(
    first.inspectionKey,
  );
});

it.each(["transport", "semantic", "stale"])(
  "durably classifies a %s failure without enabling an implicit retry",
  async (kind) => {
    let calls = 0;
    const s = await open(async (t) => {
      calls++;
      if (kind === "transport") throw new Error("offline transport");
      if (kind === "stale") throw new Error("stale-generation");
      return {};
    });
    await admit(s, "Please continue.");
    await expect(s.drainLive()).rejects.toThrow();
    const attempts = (await s.store.read(s.id)).filter(
      (e) => e.type === "live-attempt" && e.attempt.outcome === "FAILED",
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ attempt: { category: kind } });
    s.close();
    const restored = await Session.open(
      s.id,
      async () => {
        calls++;
        return {};
      },
      s.store,
      s.config,
    );
    sessions.push(restored);
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(1);
  },
);

it.each([1, 2] as const)(
  "legacy event %s opens read-only and exports its original payload",
  async (v) => {
    const { EventStore } = await import("../src/adapters/storage");
    const store = new EventStore(`legacy-${crypto.randomUUID()}`),
      id = `legacy-${v}`,
      text = "Original teaching.";
    const event: import("../src/contract").Event = {
      schema: `cuelayer-v2-event-${v}`,
      id: `${id}:1`,
      sessionId: id,
      sequence: 1,
      at: 0,
      type: "evidence",
      evidence: {
        id: "e",
        sequence: 1,
        run: "r",
        source: "0",
        text,
        start: 0,
        end: 1,
        receivedAt: 0,
        audioObservedAt: null,
        stability: "COMMITTED",
      },
    };
    await store.append(event, 0);
    const before = await store.exportSession(id),
      interpreter = vi.fn(async () => ({}));
    const s = await Session.open(id, interpreter, store);
    sessions.push(s);
    expect(s.readOnly).toBe(true);
    s.resume();
    await s.retryFailedLive();
    await expect(admit(s, "New teaching.")).rejects.toThrow(
      "legacy-session-read-only",
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(interpreter).not.toHaveBeenCalled();
    expect(await store.exportSession(id)).toBe(before);
    expect(JSON.parse(before).schema).toBe(`cuelayer-v2-export-${v}`);
  },
);

it("the authored story requests MODIFY when a topic return and correction share a capture", async () => {
  const { story, fixtureProposal } = await import("../src/story");
  const s = await open(async (t) => waitDecision(t));
  s.pause();
  for (let i = 0; i < 8; i++) {
    await admit(s, story[i]);
    const t = s.capture("Live");
    await s.accept(t, fixtureProposal(t));
  }
  await admit(s, story[8]);
  await admit(s, story[9]);
  let t = s.capture("Live");
  const response = fixtureProposal(t);
  expect(response).toMatchObject({
    suffixStatus: "WAIT_MORE_INPUT",
    contextRequest: { purpose: "MODIFY" },
  });
  await s.accept(t, response);
  t = s.capture("Live");
  await s.accept(t, fixtureProposal(t));
  expect(s.window.unaccountedChars).toBe(0);
  expect(
    Object.values(s.state.units).find(
      (u) => u.meaning.kind === "quantity" && u.meaning.symbols.p_i,
    )?.meaning,
  ).toMatchObject({ conditions: ["Ideal gas mixture", "Common temperature"] });
});
