import { afterEach, expect, it, vi } from "vitest";
import { Session } from "../src/session";
import { type Task } from "../src/contract";
import { captureLive } from "../src/projection";
import { readable, position } from "../src/source";
import {
  admit,
  openSession,
  fullGroup,
  establish,
  waitDecision,
} from "./frontier-fixtures";

const sessions: Session[] = [];
const open = async (...args: Parameters<typeof openSession>) => {
  const s = await openSession(...args);
  sessions.push(s);
  return s;
};
afterEach(() => {
  sessions.forEach((s) => s.close());
  sessions.length = 0;
  vi.restoreAllMocks();
});
const original = "The ratio we will use next is...";
async function flagged() {
  const s = await open();
  s.pause();
  await admit(s, original);
  const t = s.capture("Live");
  await s.accept(t, fullGroup(t));
  const concern = Object.values(s.replay.reviewConcerns)[0];
  expect(concern.kind).toBe("SOURCE_NO_CHANGE");
  return { s, concern };
}
async function classify(
  s: Session,
  outcome: "CARRY" | "READY_FOR_LIVE" = "READY_FOR_LIVE",
) {
  const t = s.capture("Stage");
  await s.accept(t, {
    scope: t.review!.namespace,
    results: [
      {
        item: t.review!.items[0].id,
        outcome,
        ...(outcome === "CARRY"
          ? { kind: "INCOMPLETE_PROPOSITION", core: null }
          : {}),
      },
    ],
  });
}
const allBasis = (t: Task, source: string) => {
  const cuts = Object.keys(t.capture!.sourceBoundaries[source]);
  return { source, start: cuts[0], end: cuts.at(-1)! };
};
function complete(t: Task) {
  const d = establish(t, original, {
    kind: "statement",
    text: "The ratio is pressure divided by temperature.",
  });
  d.attentionCandidate = null;
  const basis = [
    allBasis(t, t.capture!.request.source.source),
    ...t
      .capture!.request.context.filter((c) => c.role === "FOLLOWING_CONTEXT")
      .map((c) => allBasis(t, c.source)),
  ];
  d.groups[0].operations.forEach((o) => {
    o.basis = basis;
  });
  d.groups[0].resolutions = [
    {
      obligation: t.capture!.request.obligations[0].id,
      targets: [t.capture!.request.newUnits[0]],
      basis,
    },
  ];
  return d;
}
it("risky terminal no-change persists exact original source and reloads without inventing an obligation", async () => {
  const { s, concern } = await flagged();
  expect(s.replay.unresolved).toEqual({});
  expect(readable(s.replay.evidence, concern.range)).toBe(original);
  const { id, store } = s;
  s.close();
  const restored = await Session.open(id, async (t) => waitDecision(t), store);
  restored.pause();
  sessions.push(restored);
  expect(restored.replay.reviewConcerns[concern.id]).toEqual(concern);
  expect(restored.replay.accounted).toEqual(restored.replay.recorded);
  expect(restored.state.cores).toEqual({});
});
it("normal clean no-change never creates source review or additional Stage work", async () => {
  let calls = 0;
  const s = await open(async (t) => {
    calls++;
    expect(t.lane).toBe("Live");
    return fullGroup(t);
  });
  await admit(s, "Please turn to the next page.");
  await s.drainLive();
  await new Promise((r) => setTimeout(r, 25));
  expect(calls).toBe(1);
  expect(s.replay.reviewConcerns).toEqual({});
});
it("Stage CARRY preserves original identity and range instead of the later promise", async () => {
  const { s, concern } = await flagged();
  await admit(s, "We will finish that sentence later.");
  const admin = s.capture("Live");
  await s.accept(admin, fullGroup(admin));
  await classify(s, "CARRY");
  const carried = s.replay.unresolved[concern.id];
  expect(carried.range).toEqual(concern.range);
  expect(carried.phrase).toBe(original);
  const review = s.capture("Live");
  expect(review.capture!.request.mode).toBe("REVIEW");
  await s.accept(review, fullGroup(review, "CARRY"));
  expect(s.replay.unresolved[concern.id].phrase).toBe(original);
  expect(s.state.cores).toEqual({});
  expect(() => s.capture("Live")).toThrow("no-eligible-source-review");
});
it("already-accounted clarification recovers coreless meaning through Live without changing A or consumed", async () => {
  const { s, concern } = await flagged();
  await admit(s, "The ratio is pressure divided by temperature.");
  const clue = s.capture("Live");
  await s.accept(clue, fullGroup(clue));
  await classify(s);
  const before = structuredClone({
    accounted: s.replay.accounted,
    consumed: s.replay.consumed,
  });
  const t = s.capture("Live");
  expect(t.capture!.request.source.role).toBe("REVIEW");
  await s.accept(t, complete(t));
  expect({
    accounted: s.replay.accounted,
    consumed: s.replay.consumed,
  }).toEqual(before);
  expect(s.replay.reviewConcerns[concern.id]).toBeUndefined();
  expect(s.replay.unresolved[concern.id]).toBeUndefined();
  expect(Object.values(s.state.units)[0].meaning).toEqual({
    kind: "statement",
    text: "The ratio is pressure divided by temperature.",
  });
  const event = (await s.store.read(s.id)).at(-1)!;
  expect(event.type).toBe("accepted");
  if (event.type === "accepted") {
    expect(event.accepted.processing).toBeUndefined();
    expect(event.accepted.recovery?.version).toBe("v2-live-source-review-1");
  }
});
it("ordinary Live can resolve a pending flag before Stage returns, making the late result stale", async () => {
  const { s, concern } = await flagged();
  const stage = s.capture("Stage");
  await admit(s, "The ratio is pressure divided by temperature.");
  const t = s.capture("Live");
  const d = establish(t, "The ratio is pressure divided by temperature.");
  d.attentionCandidate = null;
  d.groups[0].resolutions = [
    {
      obligation: t.capture!.request.obligations[0].id,
      targets: [t.capture!.request.newUnits[0]],
      basis: [
        allBasis(t, "s0"),
        allBasis(t, t.capture!.request.obligations[0].source),
      ],
    },
  ];
  await s.accept(t, d);
  expect(s.replay.reviewConcerns[concern.id]).toBeUndefined();
  await expect(
    s.accept(stage, {
      scope: stage.review!.namespace,
      results: [
        {
          item: "r0",
          outcome: "CARRY",
          kind: "INCOMPLETE_PROPOSITION",
          core: null,
        },
      ],
    }),
  ).rejects.toThrow("stale-dependency");
});
it("Stage promotion invalidates a previously captured Live resolution without losing original source", async () => {
  const { s, concern } = await flagged();
  await admit(s, "The ratio is pressure divided by temperature.");
  const t = s.capture("Live");
  await classify(s, "CARRY");
  await expect(s.accept(t, fullGroup(t))).rejects.toThrow(
    "stale-dependency:obligation",
  );
  expect(
    readable(s.replay.evidence, s.replay.unresolved[concern.id].range!),
  ).toBe(original);
  expect(position(s.replay.evidence, s.replay.accounted)).toBe(original.length);
});
it("recovery rejects partial completion, missing original resolution, uncaptured source and stale attention", async () => {
  const { s } = await flagged();
  await classify(s);
  const t = s.capture("Live");
  const partial = fullGroup(t);
  partial.groups[0].throughBoundary = "b1";
  await expect(s.accept(t, partial)).rejects.toThrow(
    "source-review-must-cover-whole-subject",
  );
  const missing = complete(t);
  missing.groups[0].resolutions = [];
  await expect(s.accept(t, missing)).rejects.toThrow(
    "source-review-needs-original-resolution",
  );
  const unbound = complete(t);
  unbound.groups[0].resolutions[0].basis[0].source = "uncaptured";
  await expect(s.accept(t, unbound)).rejects.toThrow("source-alias");
  const attention = complete(t);
  attention.attentionCandidate = {
    mode: "FOCUS",
    targets: [t.capture!.request.newUnits[0]],
  };
  await expect(s.accept(t, attention)).rejects.toThrow(
    "source-review-cannot-publish",
  );
  expect(s.state.units).toEqual({});
});
it("recovery cannot smuggle an unrelated mutation beside an original-subject resolution", async () => {
  const { s } = await flagged();
  await classify(s);
  const t = s.capture("Live"),
    d = complete(t);
  d.groups[0].operations.push({
    type: "put",
    id: t.capture!.request.newUnits[1],
    coreId: t.capture!.request.newCores[0],
    meaning: { kind: "statement", text: "Unrelated claim" },
    dependencies: [],
    basis: [allBasis(t, "s0")],
  });
  await expect(s.accept(t, d)).rejects.toThrow(
    "unrelated-source-review-mutation",
  );
  expect(s.state.units).toEqual({});
});
it("WAIT suppression survives reload; later accounted evidence authorizes one new recovery page", async () => {
  const { s, concern } = await flagged();
  await classify(s);
  const t = s.capture("Live");
  await s.accept(t, waitDecision(t));
  expect(() => s.capture("Live")).toThrow("no-eligible-source-review");
  const { id, store } = s;
  s.close();
  const restored = await Session.open(id, async (t) => waitDecision(t), store);
  restored.pause();
  sessions.push(restored);
  expect(() => restored.capture("Live")).toThrow("no-eligible-source-review");
  await admit(restored, "We will return to that sentence.");
  const admin = restored.capture("Live");
  await restored.accept(admin, fullGroup(admin));
  const next = restored.capture("Live");
  expect(next.capture!.recovery?.subjectId).toBe(concern.id);
  expect(next.inspectionKey).not.toBe(t.inspectionKey);
  await restored.accept(next, waitDecision(next));
  expect(() => restored.capture("Live")).toThrow("no-eligible-source-review");
});
it("bounded recovery pages start after the original and never skip an aged clarification", async () => {
  const { s, concern } = await flagged();
  await admit(s, "The ratio is pressure divided by temperature.");
  for (let i = 0; i < 12; i++)
    await admit(
      s,
      "Please continue reading the handout and review the examples on the following pages. ".repeat(
        5,
      ),
    );
  while (s.window.unaccountedChars) {
    const t = s.capture("Live");
    await s.accept(t, fullGroup(t));
  }
  await classify(s);
  const t = s.capture("Live");
  const page = t.capture!.request.context.find(
    (c) => c.role === "FOLLOWING_CONTEXT",
  )!;
  expect(page.text.replace(/<b\d+>/g, "")).toContain(
    "The ratio is pressure divided by temperature.",
  );
  expect(t.capture!.request.omitted.sourceAfter).toBe(true);
  expect(readable(s.replay.evidence, t.capture!.range)).toBe(original);
  const direct = captureLive(
    s.replay,
    s.id,
    "bounded",
    0,
    undefined,
    undefined,
    concern.id,
  );
  expect(JSON.stringify(direct.capture!.request).length).toBeLessThan(28000);
});
it("capture closure retains incomplete source review and rejects a late recovery", async () => {
  const { s, concern } = await flagged();
  await classify(s);
  const t = s.capture("Live");
  s.resume();
  await s.finish();
  expect(s.replay.reviewConcerns[concern.id]).toBeDefined();
  expect(s.replay.ended).toBe(true);
  await expect(s.accept(t, complete(t))).rejects.toThrow("session-closed");
});

it("late recovery NO_CHANGE cannot erase original source when uncaptured continuation arrived", async () => {
  const { s, concern } = await flagged();
  await classify(s);
  const t = s.capture("Live");
  await admit(s, "The ratio is pressure divided by temperature.");
  await expect(s.accept(t, fullGroup(t))).rejects.toThrow(
    "source-review-unseen-continuation",
  );
  expect(s.replay.reviewConcerns[concern.id]).toBeDefined();
});
it("an unfinished clause and clarification in one NO_CHANGE group retain their full original coverage", async () => {
  const s = await open();
  s.pause();
  const text = `${original} The ratio is pressure divided by temperature.`;
  await admit(s, text);
  const initial = s.capture("Live");
  await s.accept(initial, fullGroup(initial));
  const concern = Object.values(s.replay.reviewConcerns)[0];
  expect(readable(s.replay.evidence, concern.range)).toBe(text);
  await classify(s);
  const t = s.capture("Live");
  const d = establish(t, text, {
    kind: "statement",
    text: "The ratio is pressure divided by temperature.",
  });
  d.attentionCandidate = null;
  d.groups[0].resolutions = [
    {
      obligation: t.capture!.request.obligations[0].id,
      targets: [t.capture!.request.newUnits[0]],
      basis: [allBasis(t, "s0")],
    },
  ];
  const before = structuredClone(s.replay.accounted);
  await s.accept(t, d);
  expect(s.replay.accounted).toEqual(before);
  expect(s.replay.reviewConcerns).toEqual({});
});
