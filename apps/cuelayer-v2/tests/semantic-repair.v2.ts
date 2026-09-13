import { afterEach, expect, it } from "vitest";
import { Session } from "../src/session";
import { isCurrent, type Task, type Meaning } from "../src/contract";
import {
  projectMeaning,
  projectExpression,
  type LiveDecision,
  type WireOperation,
} from "../src/live-wire";
import {
  admit,
  openSession,
  waitDecision,
  fullGroup,
  fixtureBasis,
  authoredPut,
  establish,
  type ApplyDecision,
} from "./frontier-fixtures";
const sessions: Session[] = [];
afterEach(() => sessions.splice(0).forEach((s) => s.close()));
async function open() {
  const s = await openSession();
  sessions.push(s);
  s.pause();
  return s;
}
function apply(t: Task, operations: WireOperation[] = []): ApplyDecision {
  return {
    ...waitDecision(t),
    suffixStatus: "NONE",
    groups: [
      {
        outcome: "APPLY",
        throughBoundary: t.capture!.request.source.end,
        operations,
        resolutions: [],
      },
    ],
  };
}
function alias(t: Task, id: string) {
  return Object.keys(t.capture!.units).find((a) => t.capture!.units[a] === id)!;
}
const quantity = (symbol: string, value: number): Meaning => ({
  kind: "quantity",
  expression: ["Equal", symbol, value],
  symbols: {
    [symbol]: {
      label: symbol === "P" ? "pressure" : "derived flow",
      unit: "kPa",
    },
  },
  conditions: ["at constant temperature"],
});
async function seed(s: Session) {
  await admit(
    s,
    "At constant temperature, pressure P is 200 kPa. Derived Q is 400 kPa. R identifies P. D uses Q.",
  );
  const t = s.capture("Live"),
    r = t.capture!.request,
    b = fixtureBasis(
      t,
      "At constant temperature, pressure P is 200 kPa. Derived Q is 400 kPa. R identifies P. D uses Q.",
    ),
    c = r.newCores[0];
  await s.accept(
    t,
    apply(t, [
      { type: "core", id: c, label: "Pressure", basis: b },
      { type: "mainline", coreId: c, basis: b },
      ...[
        quantity("P", 200),
        quantity("Q", 400),
        {
          kind: "annotation",
          target: r.newUnits[0],
          text: "R identifies pressure.",
        } as Meaning,
        quantity("D", 800),
      ].map((m, i) =>
        authoredPut({
          type: "put",
          id: r.newUnits[i],
          coreId: c,
          meaning: projectMeaning(m, (x) => x),
          dependencies:
            i === 1
              ? [{ target: r.newUnits[0], kind: "VALUE" }]
              : i === 3
                ? [{ target: r.newUnits[1], kind: "VALUE" }]
                : [],
          basis: b,
        }),
      ),
    ]),
  );
  return Object.keys(s.state.units);
}
it("coreless CARRY can resolve onto correct captured knowledge without changing its identity, version, or visible knowledge event", async () => {
  const s = await open();
  await admit(s, "A mole fraction is a ratio.");
  let t = s.capture("Live");
  await s.accept(t, establish(t, "A mole fraction is a ratio."));
  const before = structuredClone(Object.values(s.state.units)[0]);
  await admit(s, "That reference.");
  t = s.capture("Live");
  await s.accept(t, fullGroup(t, "CARRY"));
  s.close();
  const restored = await Session.open(
    s.id,
    async (t) => waitDecision(t),
    s.store,
    s.config,
  );
  sessions.push(restored);
  restored.pause();
  await admit(
    restored,
    "That reference means the existing mole fraction definition.",
  );
  t = restored.capture("Live");
  const d = apply(t);
  d.groups[0].resolutions = [
    {
      obligation: t.capture!.request.obligations[0].id,
      targets: [alias(t, before.id)],
      basis: [
        ...fixtureBasis(
          t,
          "That reference.",
          t.capture!.request.obligations[0].source,
        ),
        ...fixtureBasis(
          t,
          "That reference means the existing mole fraction definition.",
          t.capture!.request.source.source,
        ),
      ],
    },
  ];
  const revision = restored.state.revision;
  await restored.accept(t, d);
  expect(restored.replay.unresolved).toEqual({});
  expect(restored.window.unaccountedChars).toBe(0);
  expect(Object.values(restored.state.units)).toEqual([before]);
  expect(restored.state.revision).toBe(revision);
  const event = (await restored.store.read(s.id)).at(-1)!;
  expect(event.type).toBe("accepted");
  if (event.type === "accepted") {
    expect(event.accepted.operations).toEqual([]);
    expect(event.accepted.resolutions).toHaveLength(1);
  }
  await restored.accept(t, d);
  expect(Object.values(restored.state.units)).toEqual([before]);
});
it("resolution requires original and current ranges, and a valid captured target", async () => {
  const s = await open();
  await admit(s, "Unknown reference.");
  let t = s.capture("Live");
  await s.accept(t, fullGroup(t, "CARRY"));
  await admit(s, "The reference names a ratio.");
  t = s.capture("Live");
  const good = establish(t, "The reference names a ratio.");
  good.groups[0].resolutions = [
    {
      obligation: t.capture!.request.obligations[0].id,
      targets: good.attentionCandidate!.targets,
      basis: [
        ...fixtureBasis(
          t,
          "Unknown reference.",
          t.capture!.request.obligations[0].source,
        ),
        ...fixtureBasis(t, "The reference names a ratio."),
      ],
    },
  ];
  for (const failure of ["original", "current", "target"]) {
    const d = structuredClone(good);
    const r = d.groups[0].resolutions[0];
    if (failure === "original") r.basis = r.basis.slice(1);
    if (failure === "current") r.basis = r.basis.slice(0, 1);
    if (failure === "target") r.targets = [t.capture!.request.newUnits[7]];
    await expect(s.accept(t, d)).rejects.toThrow();
  }
  expect(Object.keys(s.replay.unresolved)).toHaveLength(1);
  await s.accept(t, good);
  expect(s.replay.unresolved).toEqual({});
});
it("field revision replaces its own provenance and preserves units, conditions and their evidence", async () => {
  const s = await open();
  const [p] = await seed(s),
    before = structuredClone(s.state.units[p]);
  await admit(s, "Correction: P is 250.");
  let t = s.capture("Live");
  await s.accept(
    t,
    apply(t, [
      {
        type: "revise",
        id: alias(t, p),
        change: {
          field: "expression",
          value: projectExpression(["Equal", "P", 250]),
        },
        basis: fixtureBasis(t, "Correction: P is 250."),
      },
    ]),
  );
  const after = s.state.units[p];
  expect(after.version).toBe(before.version + 1);
  expect(after.meaning).toEqual({
    ...before.meaning,
    expression: ["Equal", "P", 250],
  });
  expect(after.fieldBasis?.symbols).toEqual(before.fieldBasis?.symbols);
  expect(after.fieldBasis?.conditions).toEqual(before.fieldBasis?.conditions);
  expect(after.fieldBasis?.expression.map((b) => b.quote)).toEqual([
    "Correction: P is 250.",
  ]);
  await admit(s, "The constant-temperature condition no longer applies.");
  t = s.capture("Live");
  await s.accept(
    t,
    apply(t, [
      {
        type: "revise",
        id: alias(t, p),
        change: { field: "conditions", value: [] },
        basis: fixtureBasis(
          t,
          "The constant-temperature condition no longer applies.",
        ),
      },
    ]),
  );
  expect(s.state.units[p].meaning).toMatchObject({ conditions: [] });
  expect(s.state.units[p].fieldBasis?.conditions[0].quote).toContain(
    "no longer",
  );
  const events = await s.store.read(s.id);
  expect(JSON.stringify(events)).toContain("at constant temperature");
});
it("read-only retrieval needs explicit recapture; out-of-window value dependents lose eligibility transitively, identity references remain current", async () => {
  const s = await open();
  const [p, q, r, d] = await seed(s);
  for (let n = 0; n < 10; n++) {
    const text = `Independent concept ${n}.`;
    await admit(s, text);
    const t = s.capture("Live"),
      req = t.capture!.request;
    await s.accept(
      t,
      apply(t, [
        {
          type: "put",
          id: req.newUnits[0],
          coreId: req.currentCore!,
          meaning: { kind: "statement", text },
          dependencies: [],
          basis: fixtureBasis(t, text),
        },
      ]),
    );
  }
  await admit(s, "Correction: pressure increases to 250.");
  let t = s.capture("Live");
  expect(t.state.units[p]).toBeDefined();
  expect(t.state.units[q]).toBeUndefined();
  expect(t.writeScope!.units).not.toContain(p);
  const revision = (t: Task) =>
    apply(t, [
      {
        type: "revise",
        id: alias(t, p),
        change: {
          field: "expression",
          value: projectExpression(["Equal", "P", 250]),
        },
        basis: fixtureBasis(t, "Correction: pressure increases to 250."),
      },
    ]);
  await expect(s.accept(t, revision(t))).rejects.toThrow("uncaptured-write");
  await s.accept(t, {
    ...waitDecision(t),
    contextRequest: { query: "pressure", purpose: "MODIFY", after: null },
  });
  t = s.capture("Live");
  expect(t.writeScope!.units).toContain(p);
  expect(t.state.units[q]).toBeUndefined();
  await s.accept(t, revision(t));
  expect(s.state.units[q].reviewRequired).toBe(true);
  expect(s.state.units[d].reviewRequired).toBe(true);
  expect(isCurrent(s.state, q)).toBe(false);
  expect(isCurrent(s.state, d)).toBe(false);
  expect(isCurrent(s.state, r)).toBe(true);
  expect(
    Object.values(s.replay.reviewConcerns)
      .flatMap((c) => c.unitIds ?? [])
      .sort(),
  ).toEqual([q, d].sort());
  expect(s.state.units[q].meaning).toEqual(quantity("Q", 400));
  const review = s.capture("Stage");
  expect(review.writeScope!.units).toHaveLength(1);
  expect(
    review.review!.request.writableUnits.map((a) => review.review!.units[a]),
  ).toEqual(review.writeScope!.units);
  await expect(
    s.accept(review, {
      scope: review.review!.namespace,
      results: [
        {
          item: review.review!.items[0].id,
          outcome: "RESOLVED",
          operations: [],
          resolution: null,
        },
      ],
    }),
  ).rejects.toThrow("review-still-required");
});
it("Core metadata does not grant label or creation authority outside the current work", async () => {
  const s = await open();
  const [p] = await seed(s);
  await admit(s, "A new topic about plants.");
  let t = s.capture("Live", undefined, []);
  await s.accept(t, establish(t, "A new topic about plants."));
  await admit(s, "Recall the pressure.");
  t = s.capture("Live");
  const oldCore = t.state.units[p].coreId,
    ca = Object.keys(t.capture!.cores).find(
      (a) => t.capture!.cores[a] === oldCore,
    )!;
  expect(ca).toBeTruthy();
  for (const op of [
    {
      type: "setCoreLabel",
      id: ca,
      label: "Changed",
      basis: fixtureBasis(t, "Recall the pressure."),
    },
    {
      type: "put",
      id: t.capture!.request.newUnits[0],
      coreId: ca,
      meaning: { kind: "statement", text: "Wrong scope" },
      dependencies: [],
      basis: fixtureBasis(t, "Recall the pressure."),
    },
  ])
    await expect(s.accept(t, apply(t, [op as WireOperation]))).rejects.toThrow(
      /scope/,
    );
});
it("range grounding rejects reversed, unissued and cross-source cuts without any quote echo", async () => {
  const s = await open();
  await admit(s, "气压😀 是 200 kPa，条件不变。");
  const t = s.capture("Live"),
    good = establish(t, "气压😀 是 200 kPa，条件不变。");
  expect(JSON.stringify(good)).not.toContain('"quote"');
  for (const mode of ["reverse", "unissued", "source"]) {
    const d = structuredClone(good);
    for (const op of d.groups[0].operations) {
      const b = op.basis[0];
      if (mode === "reverse") [b.start, b.end] = [b.end, b.start];
      if (mode === "unissued") b.end = "b99999";
      if (mode === "source") b.source = "s99999";
    }
    await expect(s.accept(t, d)).rejects.toThrow();
  }
  await s.accept(t, good);
  expect(Object.values(s.state.units)[0].basis[0].quote).toBe(
    "气压😀 是 200 kPa，条件不变。",
  );
});

it("multi-group acceptance replays the same dependency versions as validation", async () => {
  const s = await open(),
    [p, q] = await seed(s);
  await admit(
    s,
    "Correction: P is 250. Q is still 400 under the new pressure.",
  );
  const t = s.capture("Live"),
    d = apply(t),
    first = fixtureBasis(t, "Correction: P is 250.");
  d.groups = [
    {
      outcome: "APPLY",
      throughBoundary: first[0].end,
      operations: [
        {
          type: "revise",
          id: alias(t, p),
          change: {
            field: "expression",
            value: projectExpression(["Equal", "P", 250]),
          },
          basis: first,
        },
      ],
      resolutions: [],
    },
    {
      outcome: "APPLY",
      throughBoundary: t.capture!.request.source.end,
      operations: [
        {
          type: "revalidate",
          id: alias(t, q),
          basis: fixtureBasis(t, "Q is still 400 under the new pressure."),
        },
      ],
      resolutions: [],
    },
  ];
  await s.accept(t, d);
  expect(s.state.units[q].version).toBe(3);
  expect(isCurrent(s.state, q)).toBe(true);
  s.close();
  const restored = await Session.open(
    s.id,
    async (t) => waitDecision(t),
    s.store,
    s.config,
  );
  sessions.push(restored);
  restored.pause();
  expect(restored.state).toEqual(s.state);
});

it("changing a derived field cannot silently clear stale value dependencies or settle its review", async () => {
  const s = await open(),
    [p, q] = await seed(s);
  const text = "Correction: P is 250 and Q is 500 under the new pressure.";
  await admit(s, text);
  let t = s.capture("Live");
  await s.accept(
    t,
    apply(t, [
      {
        type: "revise",
        id: alias(t, p),
        change: {
          field: "expression",
          value: projectExpression(["Equal", "P", 250]),
        },
        basis: fixtureBasis(t, text),
      },
    ]),
  );
  const review = s.capture("Stage"),
    r = review.review!,
    qa = Object.keys(r.units).find((a) => r.units[a] === q)!;
  const basis = fixtureBasis(review, text),
    result = {
      item: r.items[0].id,
      outcome: "RESOLVED",
      resolution: null,
      operations: [
        {
          type: "revise",
          id: qa,
          change: {
            field: "expression",
            value: projectExpression(["Equal", "Q", 500]),
          },
          basis,
        },
      ],
    };
  await expect(
    s.accept(review, { scope: r.namespace, results: [result] }),
  ).rejects.toThrow("review-still-required");
  await s.accept(review, {
    scope: r.namespace,
    results: [
      {
        ...result,
        operations: [
          ...result.operations,
          { type: "revalidate", id: qa, basis },
        ],
      },
    ],
  });
  expect(isCurrent(s.state, q)).toBe(true);
  expect(s.state.units[q].meaning).toMatchObject({
    expression: ["Equal", "Q", 500],
  });
});

it("duplicate puts within one APPLY cannot manufacture two copies of the same knowledge", async () => {
  const s = await open();
  await admit(s, "A ratio compares quantities.");
  const t = s.capture("Live"),
    d = establish(t, "A ratio compares quantities.");
  const op = d.groups[0].operations.find((o) => o.type === "put")!;
  d.groups[0].operations.push({ ...op, id: t.capture!.request.newUnits[1] });
  await expect(s.accept(t, d)).rejects.toThrow("duplicate-existing-knowledge");
  expect(Object.keys(s.state.units)).toHaveLength(0);
});
