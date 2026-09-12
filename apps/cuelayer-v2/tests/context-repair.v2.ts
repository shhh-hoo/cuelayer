import { afterEach, expect, it } from "vitest";
import { Session } from "../src/session";
import { captureLive, selectState } from "../src/projection";
import { isCurrent } from "../src/contract";
import {
  admit,
  establish,
  fullGroup,
  fixtureBasis,
  openSession,
  waitDecision,
} from "./frontier-fixtures";
const sessions: Session[] = [];
afterEach(() => sessions.splice(0).forEach((s) => s.close()));
async function open() {
  const s = await openSession();
  sessions.push(s);
  s.pause();
  return s;
}
it("unrelated index insertions neither repeat an identical context nor rewind a stable retrieval page", async () => {
  const s = await open();
  await admit(s, "Current source.");
  const r = s.replay;
  r.state.cores.c = {
    id: "c",
    label: "Other",
    version: 1,
    membership: 24,
    unitIds: [],
  };
  r.state.cores.active = {
    id: "active",
    label: "Current",
    version: 1,
    membership: 0,
    unitIds: [],
  };
  r.state.currentCoreId = "active";
  for (let n = 0; n < 24; n++) {
    const id = `u${n}`;
    r.state.cores.c.unitIds.push(id);
    r.state.units[id] = {
      id,
      coreId: "c",
      version: 1,
      valid: true,
      meaning: { kind: "statement", text: `spectral candidate ${n}` },
      basis: [],
      requires: [],
    };
  }
  const initial = captureLive(r, s.id, "first", 0);
  r.inspectionContexts.first = {
    anchor: initial.capture!.range,
    query: { query: "spectral", purpose: "READ", after: null },
  };
  const first = captureLive(r, s.id, "page1", 0),
    ids = first.capture!.request.search!.results.map(
      (a) => first.capture!.units[a],
    );
  expect(ids).toHaveLength(8);
  r.inspectionContexts.page1 = {
    ...first.capture!.inspectionContext!,
    query: { query: "spectral", purpose: "READ", after: ids.at(-1)! },
  };
  const second = captureLive(r, s.id, "page2", 0);
  const secondIds = second.capture!.request.search!.results.map(
    (a) => second.capture!.units[a],
  );
  expect(secondIds.every((id) => !ids.includes(id))).toBe(true);
  r.inspectionContexts.page2 = second.capture!.inspectionContext!;
  r.state.units.unrelated = {
    id: "unrelated",
    coreId: "c",
    version: 1,
    valid: true,
    meaning: { kind: "statement", text: "botany" },
    requires: [],
    basis: [],
  };
  r.state.cores.c.unitIds.push("unrelated");
  r.state.cores.c.membership++;
  r.state.revision++;
  expect(captureLive(r, s.id, "again", 0).inspectionKey).toBe(
    second.inspectionKey,
  );
  r.state.units[ids.at(-1)!].valid = false;
  r.state.units[ids.at(-1)!].version++;
  const missingCursor = captureLive(r, s.id, "cursor-removed", 0);
  expect(
    missingCursor.capture!.request.search!.results.map(
      (a) => missingCursor.capture!.units[a],
    ),
  ).toEqual(secondIds);
  const changed = structuredClone(r);
  changed.state.units[secondIds[0]].meaning = {
    kind: "statement",
    text: "spectral revised candidate",
  };
  changed.state.units[secondIds[0]].version++;
  expect(captureLive(changed, s.id, "changed", 0).inspectionKey).not.toBe(
    second.inspectionKey,
  );
});
it("required dependency closure blocks visibly at the budget instead of silently omitting references", async () => {
  const s = await open();
  await admit(s, "A new result.");
  const r = s.replay;
  r.state.cores.c = {
    id: "c",
    label: "Dependency chain",
    version: 1,
    membership: 50,
    unitIds: [],
  };
  r.state.currentCoreId = "c";
  for (let n = 0; n < 50; n++) {
    const id = `u${n}`;
    r.state.cores.c.unitIds.push(id);
    r.state.units[id] = {
      id,
      coreId: "c",
      valid: true,
      version: 1,
      meaning: { kind: "statement", text: id },
      requires: n ? [`u${n - 1}`] : [],
      basis: [],
    };
  }
  expect(() => selectState(r, undefined, { roots: ["u49"] })).toThrow(
    "context-blocked:semantic-closure",
  );
  expect(Object.keys(r.state.units)).toHaveLength(50);
});
it("a prior following page is not current grounding authority after paging onward", async () => {
  const s = await open();
  s.config.sourceChars = 16;
  await admit(
    s,
    "Unfinished idea. " + "Earlier page. ".repeat(70) + "Later page.",
  );
  let t = s.capture("Live");
  await s.accept(t, waitDecision(t));
  t = s.capture("Live");
  const old = t.capture!.request.context.find(
    (c) => c.role === "FOLLOWING_CONTEXT",
  )!;
  const oldProof = fixtureBasis(t, "Earlier page.", old.source);
  await s.accept(t, waitDecision(t));
  const next = s.capture("Live");
  expect(next.capture!.request.omitted.sourceGaps.length).toBe(1);
  // The alias is reusable only inside this fresh scope; old canonical ranges are never inherited.
  const { expandRangeBasis } = await import("../src/projection");
  const oldRange = t.capture!.sources[old.source],
    now = next.capture!.sources[old.source];
  expect(now.start).not.toEqual(oldRange.start);
  const grounded = expandRangeBasis(
    s.replay.evidence,
    next.capture!,
    oldProof[0],
  );
  expect(grounded[0].range.start.offset).toBeGreaterThanOrEqual(
    now.start.offset,
  );
  const d = establish(
    next,
    next.capture!.request.source.text.replace(/<b\d+>/g, ""),
  );
  d.scope = t.capture!.namespace;
  await expect(s.accept(next, d)).rejects.toThrow("task-binding");
});
it("Cue invitation survives new speech, expires on target change, and never resurrects on reload", async () => {
  const s = await open();
  await admit(s, "Pressure is 200 kPa. Compare it.");
  let t = s.capture("Live"),
    d = establish(t, "Pressure is 200 kPa. Compare it.");
  const p = d.groups[0].operations.find((o) => o.type === "put")!;
  d.groups[0].operations.push({
    type: "cue",
    value: { text: "Compare it.", targets: [p.id] },
    basis: p.basis,
  });
  d.attentionCandidate = null;
  await s.accept(t, d);
  const invitation = structuredClone(s.cuePresentation);
  await admit(s, "Please continue.");
  expect(s.cuePresentation).toEqual(invitation);
  t = s.capture("Live");
  await s.accept(t, fullGroup(t));
  expect(s.cuePresentation).toEqual(invitation);
  await admit(s, "Correction: pressure is 250 kPa.");
  t = s.capture("Live");
  await s.accept(t, establish(t, "Correction: pressure is 250 kPa."));
  expect(s.cuePresentation).toBeNull();
  expect(s.state.cue?.text).toBe("Compare it.");
  s.close();
  const restored = await Session.open(
    s.id,
    async (t) => waitDecision(t),
    s.store,
    s.config,
  );
  sessions.push(restored);
  expect(restored.cuePresentation).toBeNull();
  expect(restored.state.cue?.text).toBe("Compare it.");
  expect(
    Object.values(restored.state.units).every((u) =>
      isCurrent(restored.state, u.id),
    ),
  ).toBe(true);
});
it("a manual retry consumed before a crash stays interrupted after reload until another explicit authorization", async () => {
  let calls = 0;
  const s = await openSession(async () => {
    calls++;
    throw new Error("offline-failure");
  });
  sessions.push(s);
  await admit(s, "Please continue.");
  await expect(s.drainLive()).rejects.toThrow();
  const replay = s.replay,
    key = Object.keys(replay.attempts)[0],
    sequence = replay.sequence + 1;
  // Crash immediately after the durable claim, before provider dispatch.
  await s.store.append(
    {
      schema: "cuelayer-v2-event-3",
      type: "live-attempt",
      id: `${s.id}:${sequence}`,
      sessionId: s.id,
      sequence,
      at: Date.now(),
      inspectionKey: key,
      attempt: {
        id: "manual-crash",
        manual: true,
        outcome: "STARTED",
        reason: null,
      },
    },
    replay.sequence,
  );
  s.close();
  const restored = await Session.open(
    s.id,
    async (t) => {
      calls++;
      return fullGroup(t);
    },
    s.store,
    s.config,
  );
  sessions.push(restored);
  await new Promise((r) => setTimeout(r, 30));
  expect(calls).toBe(1);
  expect(restored.error).toBe("retry-interrupted");
  expect(await restored.retryFailedLive()).toBe(true);
  await restored.drainLive();
  expect(calls).toBe(2);
  expect(restored.window.unaccountedChars).toBe(0);
});

it("retrieval candidates omitted by a full required window are never recorded as inspected pages", async () => {
  const s = await open();
  await admit(s, "Current source.");
  const r = s.replay;
  r.state.cores.c = {
    id: "c",
    label: "Current",
    version: 1,
    membership: 48,
    unitIds: [],
  };
  r.state.cores.other = {
    id: "other",
    label: "Other",
    version: 1,
    membership: 8,
    unitIds: [],
  };
  r.state.currentCoreId = "c";
  for (let i = 0; i < 56; i++) {
    const id = `u${i}`,
      coreId = i < 48 ? "c" : "other";
    r.state.cores[coreId].unitIds.push(id);
    r.state.units[id] = {
      id,
      coreId,
      version: 1,
      valid: true,
      meaning: {
        kind: "statement",
        text: i < 48 ? `Required ${i}` : `spectral ${i}`,
      },
      basis: [],
      requires: [],
    };
  }
  r.state.cue = {
    text: "Consider these.",
    targets: r.state.cores.c.unitIds,
    origin: "TEACHER",
    basis: [],
  };
  r.state.cueVersion = 1;
  const first = captureLive(r, s.id, "first", 0);
  r.inspectionContexts.query = {
    anchor: first.capture!.range,
    query: { query: "spectral", purpose: "READ", after: null },
  };
  const page = captureLive(r, s.id, "query", 0).capture!;
  expect(page.request.search!.results).toEqual([]);
  expect(page.inspectionContext!.results).toEqual([]);
  expect(page.request.search!.nextAfter).toBeNull();
});
