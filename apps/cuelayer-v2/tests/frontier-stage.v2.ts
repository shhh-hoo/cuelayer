import { fixtureBasis } from "./frontier-fixtures";
import { afterEach, it, expect, vi } from "vitest";
import { Session } from "../src/session";
import { type Task } from "../src/contract";
import {
  stageReviewSchema,
  validateStage,
  type StageReview,
} from "../src/stage";
import { compileStageDeclarations } from "../src/stage-wire";
import { liveRequest } from "../server/live";
import {
  admit,
  openSession,
  fullGroup,
  establish,
  currentQuote,
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
const still = (t: Task): StageReview => ({
  scope: t.review!.namespace,
  results: t.review!.items.map((i) => ({
    item: i.id,
    outcome: "STILL_OPEN",
  })),
});
const resolved = (
  t: Task,
): Omit<StageReview, "results"> & {
  results: Extract<StageReview["results"][number], { outcome: "RESOLVED" }>[];
} => ({
  scope: t.review!.namespace,
  results: t.review!.items.map((i) => ({
    item: i.id,
    outcome: "RESOLVED",
    operations: [],
    resolution: null,
  })),
});
async function concern() {
  const s = await open();
  s.pause();
  await admit(s, "A mole fraction is a ratio.");
  const t = s.capture("Live");
  const d = establish(t, currentQuote(s, t));
  d.reviewRequests = [
    {
      core: t.capture!.request.newCores[0],
      targets: [t.capture!.request.newUnits[0]],
      purpose: "Review terminology with wider teaching context",
    },
  ];
  await s.accept(t, d);
  return s;
}
it("Stage has a distinct strict contract, host-captured scope, and no consumption fields", async () => {
  const s = await concern(),
    t = s.capture("Stage");
  expect(t.review!.request).not.toHaveProperty("source");
  expect(t.review!.request).not.toHaveProperty("accountThrough");
  const provider = await liveRequest(t.review!.request);
  expect(provider.text.format.strict).toBe(true);
  const schema = provider.text.format.schema as any;
  expect(JSON.stringify(schema)).not.toContain('"oneOf"');
  const check = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(check);
    const node = value as Record<string, any>;
    expect(node).not.toHaveProperty("allOf");
    if (node.$ref) {
      expect(node.$ref.startsWith("#/")).toBe(true);
      expect(
        node.$ref
          .slice(2)
          .split("/")
          .reduce((result: any, key: string) => result?.[key], schema),
      ).toBeDefined();
    }
    if (node.type === "object") {
      expect(node.additionalProperties).toBe(false);
      expect(node.required?.sort()).toEqual(
        Object.keys(node.properties).sort(),
      );
    }
    Object.values(node).forEach(check);
  };
  check(schema);
  const resolved = schema.properties.results.items.anyOf[1].properties;
  expect(resolved).not.toHaveProperty("operations");
  expect(resolved).not.toHaveProperty("resolution");
  const declarations = resolved.declarations.items;
  expect(declarations.anyOf).toHaveLength(6);
  expect(declarations.anyOf[4].properties.action.enum).toEqual([
    "REVALIDATE",
    "INVALIDATE",
  ]);
  expect(declarations.anyOf[0].properties.meaning.anyOf).toHaveLength(4);
  expect(declarations.anyOf[0].properties).not.toHaveProperty("id");
  expect(declarations.anyOf[0].properties).not.toHaveProperty("coreId");
  expect(declarations.anyOf[1].required).toContain("fieldBasis");
  expect(declarations.anyOf[1].properties).not.toHaveProperty("basis");
  const d = still(t);
  expect(stageReviewSchema.safeParse({ ...d, dispositions: [] }).success).toBe(
    false,
  );
  expect(stageReviewSchema.safeParse({ ...d, reviewed: ["e0"] }).success).toBe(
    false,
  );
  await s.accept(t, d);
  const e = (await s.store.read(s.id)).at(-1)!;
  expect(e.type).toBe("accepted");
  if (e.type === "accepted") {
    expect(e.accepted.dispositions).toEqual([]);
    expect(e.accepted.processing).toBeUndefined();
    expect(e.accepted.reviews?.[0].range).toEqual(t.review!.items[0].range);
  }
});
it("checks reconciliation CONFIRM source even when no knowledge mutation is needed", async () => {
  const s = await concern(),
    task = s.capture("Stage"),
    request = task.review!.request,
    basis = fixtureBasis(task, "A mole fraction is a ratio.")[0];
  const reply = (grounding: typeof basis) =>
    compileStageDeclarations(request, {
      scope: request.scope,
      results: [
        {
          item: request.items[0].id,
          outcome: "RESOLVED",
          referents: [],
          declarations: [
            {
              action: "CONFIRM",
              unit: request.units[0].id,
              basis: [grounding],
            },
          ],
        },
      ],
    });
  for (const invalid of [
    { ...basis, source: "uncaptured-source" },
    { ...basis, end: "unissued-cut" },
    { ...basis, end: basis.start },
  ])
    expect(() => validateStage(s.replay, task, reply(invalid))).toThrow();
  const before = structuredClone(s.state),
    accounted = structuredClone(s.replay.accounted);
  await s.accept(task, reply(basis));
  expect(s.state).toEqual(before);
  expect(s.replay.accounted).toEqual(accounted);
  expect(s.replay.reviewConcerns).toEqual({});
  expect((await s.store.read(s.id)).at(-1)).toMatchObject({
    type: "accepted",
    accepted: {
      reviews: [{ basis: [{ quote: "A mole fraction is a ratio." }] }],
    },
  });
});
it("STILL_OPEN succeeds without Live dispositions or duplicate obligation, and suppresses repeat review", async () => {
  const s = await open();
  s.pause();
  await admit(s, "That value is larger.");
  const t = s.capture("Live");
  await s.accept(t, fullGroup(t, "CARRY"));
  const before = s.replay.accounted;
  const review = s.capture("Stage");
  await s.accept(review, still(review));
  expect(s.replay.accounted).toEqual(before);
  expect(Object.keys(s.replay.unresolved)).toHaveLength(1);
  expect(() => s.capture("Stage")).toThrow("no-eligible");
});
it("relevant accepted dependency change rejects stale Stage", async () => {
  const s = await concern(),
    review = s.capture("Stage");
  await admit(s, "Correction: a mole fraction is a ratio of amounts.");
  const t = s.capture("Live");
  await s.accept(t, establish(t, currentQuote(s, t)));
  await expect(s.accept(review, still(review))).rejects.toThrow(
    "stale-dependency:unit",
  );
});
it("unrelated mainline/Core change does not invalidate scoped Stage work", async () => {
  const s = await concern(),
    review = s.capture("Stage");
  await admit(s, "This lesson also discusses poetry.");
  const t = s.capture("Live", undefined, []);
  const d = establish(t, currentQuote(s, t));
  await s.accept(t, d);
  await s.accept(review, still(review));
  expect(Object.keys(s.replay.reviewInspections)).toHaveLength(1);
});
it("Stage cannot create Core, switch mainline, write Cue or publish attention", async () => {
  const s = await concern(),
    t = s.capture("Stage"),
    d = still(t);
  for (const extra of [
    { attentionCandidate: null },
    { accountThrough: "b0" },
    { reviewed: [] },
  ])
    await expect(s.accept(t, { ...d, ...extra })).rejects.toThrow(
      "malformed-stage",
    );
  (d.results[0] as any).operations = [
    { type: "mainline", coreId: "c0", basis: [] },
  ];
  await expect(s.accept(t, d)).rejects.toThrow("malformed-stage");
});
it("WITHDRAWN is rejected without authoritative accepted retraction", async () => {
  const s = await concern(),
    t = s.capture("Stage"),
    d = still(t);
  d.results[0] = {
    item: d.results[0].item,
    outcome: "WITHDRAWN",
    supersededBy: t.review!.request.units[0].id,
  };
  await expect(s.accept(t, d)).rejects.toThrow(
    "withdrawal-without-authoritative-retraction",
  );
  expect(Object.keys(s.replay.reviewConcerns)).toHaveLength(1);
});
it("a slow semantic result remains valid while its attention expires", async () => {
  const s = await open(async (t) => {
    await new Promise((r) => setTimeout(r, 800));
    return establish(t, "A mole fraction is a ratio.");
  });
  await admit(s, "A mole fraction is a ratio.");
  await s.drainLive();
  expect(s.state.revision).toBeGreaterThan(0);
  expect(s.attention).toBeNull();
  expect(s.trace.spans.some((x) => x.name === "attention-expired")).toBe(true);
});
it("new teacher source supersedes attention without rejecting valid semantic prefix", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let calls = 0;
  const s = await open(async (t) => {
    if (++calls === 1) {
      await held;
      return establish(t, "A mole fraction is a ratio.");
    }
    return fullGroup(t);
  });
  await admit(s, "A mole fraction is a ratio.");
  await vi.waitFor(() => expect(calls).toBe(1));
  await admit(s, "Please turn to the next page.");
  release();
  await s.drainLive();
  expect(s.window.unaccountedChars).toBe(0);
  expect(s.trace.spans.some((x) => x.name === "attention-superseded")).toBe(
    true,
  );
});
it("Stage may remain occupied while Live admits and accounts subsequent source", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let started = false;
  const s = await open(async (t) => {
    if (t.lane === "Stage") {
      started = true;
      await held;
      return still(t);
    }
    return fullGroup(t, "CARRY");
  });
  await admit(s, "An unresolved reference.");
  await s.drainLive();
  await vi.waitFor(() => expect(started).toBe(true));
  await admit(s, "Another unresolved reference.");
  await s.drainLive();
  expect(s.window.unaccountedChars).toBe(0);
  expect(s.window.activeStage).not.toBeNull();
  release();
});
it("Stage resolution updates existing Core and removes CARRY without advancing A", async () => {
  let s = await concern();
  await admit(s, "That fraction determines its share.");
  const t = s.capture("Live");
  const d = fullGroup(t, "CARRY");
  d.groups[0].core = t.capture!.request.cores[0].id;
  await s.accept(t, d);
  await admit(s, "By that fraction I mean the mole fraction.");
  const clue = s.capture("Live");
  await s.accept(clue, fullGroup(clue));
  s.close();
  s = await Session.open(
    s.id,
    async (t) => (t.lane === "Stage" ? still(t) : waitDecision(t)),
    s.store,
    s.config,
  );
  sessions.push(s);
  s.pause();
  let review = s.capture("Stage");
  if (review.review!.items[0].kind === "RECONCILIATION") {
    await s.accept(review, still(review));
    review = s.capture("Stage");
  }
  const req = review.review!.request;
  const result = resolved(review);
  result.results[0].operations = [
    {
      type: "put",
      id: req.newUnits[0],
      coreId: req.cores[0].id,
      meaning: {
        kind: "annotation",
        target: req.units[0].id,
        text: "Mole fraction determines a component’s share.",
      },
      dependencies: [{ target: req.units[0].id, kind: "IDENTITY" }],
      basis: [
        ...fixtureBasis(
          review,
          "That fraction determines its share.",
          req.items[0].source,
        ),
        ...fixtureBasis(review, "By that fraction I mean the mole fraction."),
      ],
    },
  ];
  result.results[0].resolution = {
    targets: [req.newUnits[0]],
    referents: [req.units[0].id],
    basis: result.results[0].operations.flatMap((op) => op.basis),
  };
  const before = s.replay.accounted;
  await s.accept(review, result);
  expect(s.replay.accounted).toEqual(before);
  expect(s.replay.unresolved).toEqual({});
  expect(
    Object.values(s.state.units).some((u) => u.meaning.kind === "annotation"),
  ).toBe(true);
});

it("Stage relevant refinement wakes a Live WAIT snapshot without new source", async () => {
  let liveCalls = 0;
  const s = await open(async (t) => {
    if (t.lane === "Stage") {
      const d = resolved(t),
        req = t.review!.request;
      d.results[0].outcome = "RESOLVED";
      d.results[0].operations = [
        {
          type: "revise",
          id: req.units[0].id,
          change: {
            field: "text",
            value: "A mole fraction is a ratio of amounts.",
          },
          basis: fixtureBasis(
            t,
            "A mole fraction is a ratio of amounts.",
            req.items[0].source,
          ),
        },
      ];
      await new Promise((r) => setTimeout(r, 30));
      return d;
    }
    liveCalls++;
    return liveCalls === 1 ? waitDecision(t) : fullGroup(t);
  });
  s.pause();
  await admit(s, "A mole fraction is a ratio of amounts.");
  const t = s.capture("Live"),
    d = establish(t, currentQuote(s, t), {
      kind: "statement",
      text: "A mole fraction is a ratio.",
    });
  d.reviewRequests = [
    {
      core: t.capture!.request.newCores[0],
      targets: [t.capture!.request.newUnits[0]],
      purpose: "Refine the explicitly spoken definition",
    },
  ];
  await s.accept(t, d);
  await admit(s, "That ratio");
  s.resume();
  await vi.waitFor(() => expect(liveCalls).toBe(2));
  await s.drainLive();
  expect(s.window.unaccountedChars).toBe(0);
});

it("Stage WITHDRAWN needs accepted retraction covering the entire host concern", async () => {
  for (const partial of [false, true]) {
    const s = await open();
    s.pause();
    await admit(s, "A mole fraction is a ratio. Another concern remains.");
    const t = s.capture("Live"),
      d = establish(
        t,
        partial ? "A mole fraction is a ratio." : currentQuote(s, t),
      );
    d.reviewRequests = [
      {
        core: t.capture!.request.newCores[0],
        targets: [t.capture!.request.newUnits[0]],
        purpose: "Review the entire source concern",
      },
    ];
    await s.accept(t, d);
    await admit(s, "Retract the previous proposition.");
    const correction = s.capture("Live"),
      retraction = establish(correction, currentQuote(s, correction));
    retraction.groups[0].operations = [
      {
        type: "invalidate",
        id: correction.capture!.request.units[0].id,
        basis: fixtureBasis(correction, currentQuote(s, correction)),
      },
    ];
    retraction.attentionCandidate = null;
    await s.accept(correction, retraction);
    const review = s.capture("Stage"),
      result = still(review);
    result.results[0] = {
      item: result.results[0].item,
      outcome: "WITHDRAWN",
      supersededBy: review.review!.request.units[0].id,
    };
    if (partial)
      await expect(s.accept(review, result)).rejects.toThrow(
        "withdrawal-without-authoritative-retraction",
      );
    else {
      await s.accept(review, result);
      expect(s.replay.reviewConcerns).toEqual({});
    }
  }
});

it("a failed oldest Stage snapshot does not starve a later independent obligation", async () => {
  const subjects: string[] = [];
  const s = await open(async (t) => {
    if (t.lane === "Live") return waitDecision(t);
    const subject = t.review!.items[0].subjectId;
    subjects.push(subject);
    if (subjects.length === 1)
      throw new Error("incomplete-or-malformed-stage-review");
    return still(t);
  });
  s.pause();
  for (const text of [
    "This unknown reference.",
    "A separate unknown reference.",
  ]) {
    await admit(s, text);
    const t = s.capture("Live");
    await s.accept(t, fullGroup(t, "CARRY"));
  }
  s.resume();
  await vi.waitFor(() => expect(subjects).toHaveLength(2));
  expect(new Set(subjects).size).toBe(2);
  await new Promise((r) => setTimeout(r, 25));
  expect(subjects).toHaveLength(2);
  expect(Object.keys(s.replay.unresolved)).toHaveLength(2);
});

it("lagging Live defers new Stage once while bounding Stage starvation", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let liveStarted = false,
    stageStarted = false;
  const s = await open(async (t) => {
    if (t.lane === "Stage") {
      stageStarted = true;
      return still(t);
    }
    liveStarted = true;
    await held;
    return fullGroup(t);
  });
  s.pause();
  await admit(s, "An unresolved reference.");
  const task = s.capture("Live");
  await s.accept(task, fullGroup(task, "CARRY"));
  await admit(s, "Please continue.");
  const now = performance.now.bind(performance);
  vi.spyOn(performance, "now").mockImplementation(() => now() + 5000);
  s.resume();
  await vi.waitFor(() => expect(liveStarted).toBe(true));
  expect(stageStarted).toBe(false);
  expect(s.trace.spans.some((x) => x.name === "stage-deferred-for-live")).toBe(
    true,
  );
  await admit(s, "Further source continues to arrive.");
  expect(s.replay.evidence).toHaveLength(3);
  await vi.waitFor(() => expect(stageStarted).toBe(true), { timeout: 1800 });
  expect(s.window.activeLive).not.toBeNull();
  release();
  await s.drainLive();
  expect(s.window.unaccountedChars).toBe(0);
});
