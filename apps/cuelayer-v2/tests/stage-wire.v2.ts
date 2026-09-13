import { afterEach, expect, it } from "vitest";
import { Session } from "../src/session";
import type { Task } from "../src/contract";
import { validateStage } from "../src/stage";
import {
  compileStageDeclarations,
  stageDeclarationReviewSchema,
  type StageDeclarationReview,
} from "../src/stage-wire";
import { liveRequest } from "../server/live";
import {
  admit,
  establish,
  fixtureBasis,
  fullGroup,
  openSession,
} from "./frontier-fixtures";

const sessions: Session[] = [];
afterEach(() => {
  sessions.forEach((s) => s.close());
  sessions.length = 0;
});
type Resolved = Extract<
  StageDeclarationReview["results"][number],
  { outcome: "RESOLVED" }
>;

async function setup(original = "That interval grows.") {
  const s = await openSession();
  sessions.push(s);
  s.pause();
  await admit(s, "The pendulum period is the time needed for one cycle.");
  let task = s.capture("Live");
  await s.accept(
    task,
    establish(task, "The pendulum period is the time needed for one cycle."),
  );
  await admit(s, original);
  task = s.capture("Live");
  const carry = fullGroup(task, "CARRY");
  carry.groups[0].core = task.capture!.request.cores[0].id;
  await s.accept(task, carry);
  await admit(s, "By that interval I mean the pendulum period.");
  task = s.capture("Live");
  await s.accept(task, fullGroup(task));
  const t = s.capture("Stage"),
    r = t.review!.request;
  const basis = [
    ...fixtureBasis(t, original, r.items[0].source),
    ...fixtureBasis(t, "By that interval I mean the pendulum period."),
  ];
  return { s, t, r, basis, referent: r.units[0].id };
}

function reply(t: Task, declarations: Resolved["declarations"]) {
  const r = t.review!.request;
  return {
    scope: r.scope,
    results: [
      {
        item: r.items[0].id,
        outcome: "RESOLVED" as const,
        referents: [r.units[0].id],
        declarations,
      },
    ],
  };
}

it("compiles selected meaning into deterministic allocated IDs and implied typed edges", async () => {
  const { s, t, r, basis, referent } = await setup();
  const declaration = reply(t, [
    {
      action: "ADD",
      meaning: {
        kind: "annotation",
        target: referent,
        text: "The pendulum period grows.",
      },
      basis,
      about: [],
      usesValue: [],
    },
  ]);
  const requestBefore = structuredClone(r),
    stateBefore = structuredClone(s.replay);
  const compiled = compileStageDeclarations(r, declaration);
  expect(compileStageDeclarations(r, declaration)).toEqual(compiled);
  expect(r).toEqual(requestBefore);
  expect(s.replay).toEqual(stateBefore);
  expect(compiled).toEqual({
    scope: r.scope,
    results: [
      {
        item: r.items[0].id,
        outcome: "RESOLVED",
        operations: [
          {
            type: "put",
            id: r.newUnits[0],
            coreId: r.items[0].core,
            meaning: {
              kind: "annotation",
              target: referent,
              text: "The pendulum period grows.",
            },
            dependencies: [],
            basis,
          },
        ],
        resolution: { targets: [r.newUnits[0]], referents: [referent], basis },
      },
    ],
  });
  const accepted = validateStage(s.replay, t, compiled).accepted;
  await s.accept(t, compiled);
  const newUnit = s.state.units[t.review!.units[r.newUnits[0]]];
  expect(newUnit.links).toEqual([
    { target: t.review!.units[referent], kind: "IDENTITY", version: 1 },
  ]);
  expect(s.replay.accounted).toEqual(stateBefore.accounted);
  expect(s.replay.unresolved).toEqual({});
  expect(accepted.operationBatches).toEqual([1]);
});

it("compiles earlier declaration references into the same bounded connected component", async () => {
  const { s, t, r, basis, referent } = await setup();
  const value = reply(t, [
    {
      action: "ADD",
      meaning: { kind: "statement", text: "The interval grows." },
      basis,
      about: [],
      usesValue: [],
    },
    {
      action: "ADD",
      meaning: {
        kind: "annotation",
        target: 0,
        text: "Its duration increases.",
      },
      basis,
      about: [],
      usesValue: [],
    },
    {
      action: "ADD",
      meaning: {
        kind: "relation",
        targets: [referent, 0, 1],
        relation: "dependency",
        text: "The growing interval is the pendulum period.",
      },
      basis,
      about: [],
      usesValue: [],
    },
  ]);
  await s.accept(t, compileStageDeclarations(r, value));
  const units = r.newUnits
    .slice(0, 3)
    .map((a) => s.state.units[t.review!.units[a]]);
  expect(units[0].requires).toEqual([]);
  expect(units[1].requires).toEqual([units[0].id]);
  expect(units[2].requires).toEqual([
    t.review!.units[referent],
    units[0].id,
    units[1].id,
  ]);
});

it("keeps ABOUT and USES_VALUE explicit and retains their different validity semantics", async () => {
  const { s, t, r, basis, referent } = await setup();
  for (const kind of ["IDENTITY", "VALUE"] as const) {
    const value = reply(t, [
      {
        action: "ADD",
        meaning: { kind: "statement", text: "The interval grows." },
        basis,
        about: kind === "IDENTITY" ? [referent] : [],
        usesValue: kind === "VALUE" ? [referent] : [],
      },
    ]);
    const accepted = validateStage(
      s.replay,
      t,
      compileStageDeclarations(r, value),
    ).accepted;
    expect(accepted.operations[0]).toMatchObject({
      type: "put",
      dependencies: [{ target: t.review!.units[referent], kind }],
    });
  }
});

it("does not infer a graph edge from prose or let an unrelated declaration piggyback", async () => {
  const { s, t, r, basis, referent } = await setup();
  const value = reply(t, [
    {
      action: "ADD",
      meaning: {
        kind: "annotation",
        target: referent,
        text: "The interval grows.",
      },
      basis,
      about: [],
      usesValue: [],
    },
    {
      action: "ADD",
      meaning: { kind: "statement", text: "The pendulum period grows." },
      basis,
      about: [],
      usesValue: [],
    },
  ]);
  expect(() =>
    validateStage(s.replay, t, compileStageDeclarations(r, value)),
  ).toThrow("unbound-stage-referent");
});

it("rejects missing, cross-task, slot, forward and cyclic references without reading prose", async () => {
  const { t, r, basis } = await setup();
  for (const target of ["unknown", "c0", r.newUnits[0], 0, 1, -1, 0.5]) {
    const value = reply(t, [
      {
        action: "ADD",
        meaning: {
          kind: "annotation",
          target,
          text: "This means the pendulum period.",
        },
        basis,
        about: [],
        usesValue: [],
      },
    ]);
    expect(() => compileStageDeclarations(r, value)).toThrow();
  }
  const value = reply(t, [{ action: "CONFIRM", unit: r.units[0].id, basis }]);
  expect(() =>
    compileStageDeclarations(r, {
      ...value,
      results: [{ ...value.results[0], referents: undefined }],
    }),
  ).toThrow();
  value.results[0].referents = ["unknown"];
  expect(() => compileStageDeclarations(r, value)).toThrow(
    "uncaptured-reference",
  );
});

it("resolves directly to confirmed existing knowledge without inventing an operation", async () => {
  const { s, t, r, basis, referent } = await setup("That interval.");
  const before = structuredClone(s.state);
  const value = reply(t, [{ action: "CONFIRM", unit: referent, basis }], basis);
  await s.accept(t, compileStageDeclarations(r, value));
  expect(s.state).toEqual(before);
  expect(s.replay.unresolved).toEqual({});
});

it("never grants ADD a Core from a referent, readable metadata or prose", async () => {
  const { t, r, basis, referent } = await setup();
  const value = reply(t, [
    {
      action: "ADD",
      meaning: {
        kind: "annotation",
        target: referent,
        text: "The interval grows.",
      },
      basis,
      about: [],
      usesValue: [],
    },
  ]);
  for (const request of [
    { ...r, items: r.items.map((i) => ({ ...i, core: null })) },
    { ...r, createWithin: [] },
  ])
    expect(() => compileStageDeclarations(request, value)).toThrow(
      "no-core-creation-authority",
    );
});

it("retains host write/version/source checks after compilation", async () => {
  const { s, t, r, basis, referent } = await setup();
  const change = reply(t, [
    {
      action: "AMEND",
      unit: referent,
      changes: [{ field: "text", value: "The duration increases.", basis }],
    },
  ]);
  expect(() =>
    validateStage(s.replay, t, compileStageDeclarations(r, change)),
  ).toThrow("uncaptured-write");
  const value = reply(t, [
    {
      action: "ADD",
      meaning: {
        kind: "annotation",
        target: referent,
        text: "The interval grows.",
      },
      basis,
      about: [],
      usesValue: [],
    },
  ]);
  const stale = structuredClone(s.replay);
  stale.state.units[t.review!.units[referent]].version++;
  expect(() =>
    validateStage(stale, t, compileStageDeclarations(r, value)),
  ).toThrow("stale-dependency");
  const declaration = value.results[0].declarations[0];
  if ("basis" in declaration)
    declaration.basis = [{ source: "unknown", start: "b0", end: "b1" }];
  expect(() =>
    validateStage(s.replay, t, compileStageDeclarations(r, value)),
  ).toThrow();
});

it("leaves STILL_OPEN and authority-bound withdrawal as distinct non-mutating outcomes", async () => {
  const { t, r } = await setup();
  const open = {
    scope: r.scope,
    results: [{ item: r.items[0].id, outcome: "STILL_OPEN" }],
  };
  expect(compileStageDeclarations(r, open)).toEqual(open);
  expect(
    stageDeclarationReviewSchema.safeParse({
      ...open,
      results: [{ ...open.results[0], declarations: [] }],
    }).success,
  ).toBe(false);
  const withdrawn = {
    scope: r.scope,
    results: [
      {
        item: r.items[0].id,
        outcome: "WITHDRAWN",
        supersededBy: r.units[0].id,
      },
    ],
  };
  expect(compileStageDeclarations(r, withdrawn)).toEqual(withdrawn);
});

it("serializes an equivalent grounded annotation with less mechanical response data", async () => {
  const { t, r, basis, referent } = await setup();
  const meaning = {
    kind: "annotation" as const,
    target: referent,
    text: "The pendulum period grows.",
  };
  const declarative = reply(t, [
    { action: "ADD", meaning, basis, about: [], usesValue: [] },
  ]);
  const mechanical = {
    scope: r.scope,
    results: [
      {
        item: r.items[0].id,
        outcome: "RESOLVED",
        operations: [
          {
            type: "put",
            id: r.newUnits[0],
            coreId: r.items[0].core,
            meaning,
            dependencies: [],
            basis,
          },
        ],
        resolution: { targets: [r.newUnits[0]], referents: [referent], basis },
      },
    ],
  };
  expect(compileStageDeclarations(r, declarative)).toEqual(mechanical);
  const oldBytes = new TextEncoder().encode(JSON.stringify(mechanical)).length;
  const newBytes = new TextEncoder().encode(JSON.stringify(declarative)).length;
  expect(newBytes).toBeLessThan(oldBytes * 0.75);
  console.info("Stage annotation response bytes", { oldBytes, newBytes });
  const payload = await liveRequest(r);
  expect(payload.text.format.name).toBe("v2_stage_declarations_1");
});
