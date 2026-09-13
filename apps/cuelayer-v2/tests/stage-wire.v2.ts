import { afterEach, expect, it } from "vitest";
import { Session } from "../src/session";
import { emptyReplay, fold, type Task } from "../src/contract";
import { validateStage, type StageRequest } from "../src/stage";
import {
  compileStageDeclarations,
  stageDeclarationReviewSchema,
  type StageDeclarationReview,
} from "../src/stage-wire";
import { capturedRequest, executeCapturedRequest } from "../src/execution";
import { liveRequest, modelProfile } from "../server/live";
import { providerResponse } from "../server/provider-execution";
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
  const value = reply(t, [{ action: "CONFIRM", unit: referent, basis }]);
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
  expect(payload.text.format.name).toBe("v2_stage_declarations_2");
});

async function sourceSetup() {
  const s = await openSession();
  sessions.push(s);
  s.pause();
  await admit(s, "The ratio we will use next is...");
  const live = s.capture("Live");
  await s.accept(live, fullGroup(live));
  const t = s.capture("Stage"),
    r = t.review!.request;
  expect(r.items[0].kind).toBe("SOURCE_NO_CHANGE");
  return { s, t, r };
}
const sourceResult = (
  r: StageRequest,
  outcome: "STILL_OPEN" | "CONFIRMED_NO_CHANGE" | "READY_FOR_LIVE" | "CARRY",
) => ({
  scope: r.scope,
  results: [
    {
      item: r.items[0].id,
      outcome,
      ...(outcome === "CARRY"
        ? { kind: "INCOMPLETE_PROPOSITION", core: null }
        : {}),
    },
  ],
});

it.each([
  "STILL_OPEN",
  "CONFIRMED_NO_CHANGE",
  "READY_FOR_LIVE",
  "CARRY",
] as const)(
  "passes %s through only for a source-only review item",
  async (outcome) => {
    const { s, t, r } = await sourceSetup();
    const raw = sourceResult(r, outcome);
    const before = structuredClone(s.replay);
    const compiled = compileStageDeclarations(r, raw);
    expect(compiled).toEqual(raw);
    expect(r.newUnits).toEqual([]);
    expect(r.createWithin).toEqual([]);
    const accepted = validateStage(s.replay, t, compiled).accepted;
    expect(accepted.operations).toEqual([]);
    expect(accepted.sourceReviews?.[0].outcome).toBe(outcome);
    await s.accept(t, compiled);
    expect(s.state).toEqual(before.state);
    expect(s.replay.accounted).toEqual(before.accounted);
    expect(s.replay.consumed).toEqual(before.consumed);
  },
);

it("rejects knowledge resolution and withdrawal declarations on a source-only item", async () => {
  const { r } = await sourceSetup();
  for (const result of [
    {
      item: r.items[0].id,
      outcome: "RESOLVED",
      referents: [],
      declarations: [
        {
          action: "CONFIRM",
          unit: "u0",
          basis: [{ source: "s0", start: "b0", end: "b1" }],
        },
      ],
    },
    { item: r.items[0].id, outcome: "WITHDRAWN", supersededBy: "u0" },
  ])
    expect(() =>
      compileStageDeclarations(r, { scope: r.scope, results: [result] }),
    ).toThrow("source-review-cannot-write-knowledge");
});

it("rejects source classification on ordinary obligation and reconciliation items", async () => {
  const { r } = await setup();
  for (const kind of ["OBLIGATION", "RECONCILIATION"] as const)
    for (const outcome of [
      "CONFIRMED_NO_CHANGE",
      "READY_FOR_LIVE",
      "CARRY",
    ] as const) {
      const ordinary = {
        ...r,
        items: r.items.map((item) => ({ ...item, kind })),
      };
      expect(() =>
        compileStageDeclarations(ordinary, sourceResult(ordinary, outcome)),
      ).toThrow("unexpected-source-review-outcome");
    }
});

it("requires a non-null source CARRY Core to be an explicitly captured Core alias", async () => {
  const { r: source } = await sourceSetup();
  // A compiler contract fixture explicitly supplies readable Core metadata.
  // Host acceptance remains responsible for its actual version/capability.
  const r = { ...source, cores: [{ id: "c0", label: "Ratios" }] };
  const raw = sourceResult(r, "CARRY");
  expect(r.cores).toHaveLength(1);
  for (const core of [r.cores[0].id, null]) {
    const declared = { ...raw, results: [{ ...raw.results[0], core }] };
    expect(compileStageDeclarations(r, declared)).toEqual(declared);
  }
  for (const core of ["", "u0", "nc0", "uncaptured"])
    expect(() =>
      compileStageDeclarations(r, {
        ...raw,
        results: [{ ...raw.results[0], core }],
      }),
    ).toThrow("uncaptured-core");
});

it("keeps source classifications strict and bound to the request scope and items", async () => {
  const { r } = await sourceSetup();
  const raw = sourceResult(r, "READY_FOR_LIVE");
  for (const extra of [{ declarations: [] }, { operations: [] }, { basis: [] }])
    expect(
      stageDeclarationReviewSchema.safeParse({
        ...raw,
        results: [{ ...raw.results[0], ...extra }],
      }).success,
    ).toBe(false);
  expect(() =>
    compileStageDeclarations(r, { ...raw, scope: "another-task" }),
  ).toThrow("scope");
  expect(() =>
    compileStageDeclarations(r, {
      ...raw,
      results: [{ ...raw.results[0], item: "another-item" }],
    }),
  ).toThrow("item");
  const carry = sourceResult(r, "CARRY");
  expect(
    stageDeclarationReviewSchema.safeParse({
      ...carry,
      results: [{ ...carry.results[0], core: undefined }],
    }).success,
  ).toBe(false);
});

it.each(["CONFIRMED_NO_CHANGE", "CARRY", "READY_FOR_LIVE"] as const)(
  "executes serialized SDK %s output through the shared compiler, host and durable reducer",
  async (outcome) => {
    const { s, t, r } = await sourceSetup();
    const raw = sourceResult(r, outcome),
      before = structuredClone(s.replay);
    let calls = 0;
    const transport: typeof fetch = async (_url, init) => {
      calls++;
      const payload = JSON.parse(String(init?.body));
      expect(payload).toEqual(await liveRequest(r));
      expect(payload.text.format.name).toBe("v2_stage_declarations_2");
      const schema = payload.text.format.schema;
      const branches = schema.properties.results.items.anyOf;
      const carry = branches.find(
        (branch: any) =>
          branch.properties.outcome.const === "CARRY" ||
          branch.properties.outcome.enum?.includes("CARRY"),
      );
      expect(carry.additionalProperties).toBe(false);
      expect([...carry.required].sort()).toEqual([
        "core",
        "item",
        "kind",
        "outcome",
      ]);
      const events = [
        { type: "response.output_text.delta", delta: JSON.stringify(raw) },
        {
          type: "response.completed",
          response: {
            status: "completed",
            model: modelProfile.model,
            id: "offline-source-classification",
            usage: null,
          },
        },
      ];
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        {
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    };
    const executed = await executeCapturedRequest(capturedRequest(t), {
      signal: new AbortController().signal,
      transport: (captured, signal) =>
        providerResponse(captured.request, {
          apiKey: "offline-test",
          model: modelProfile.model,
          signal,
          fetch: transport,
        }),
    });
    expect(calls).toBe(1);
    expect(executed.provider.completed).toBe(true);
    expect(executed.proposal).toEqual(raw);
    await s.accept(t, executed.proposal);
    expect(s.state).toEqual(before.state);
    expect(s.replay.accounted).toEqual(before.accounted);
    expect(s.replay.consumed).toEqual(before.consumed);
    const events = await s.store.read(s.id);
    expect(events.reduce(fold, emptyReplay())).toEqual(s.replay);
  },
);
