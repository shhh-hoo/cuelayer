import { afterEach, expect, it } from "vitest";
import { Session } from "../src/session";
import { liveRequest } from "../server/live";
import type { Task } from "../src/contract";
import type { WireOperation } from "../src/live-wire";
import { validateStage } from "../src/stage";
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

async function referenceTask(existing?: "chain" | "reverse" | "unrelated") {
  const s = await openSession();
  sessions.push(s);
  s.pause();
  await admit(s, "The pendulum period is the time needed for one cycle.");
  let t = s.capture("Live");
  await s.accept(
    t,
    establish(t, "The pendulum period is the time needed for one cycle."),
  );
  if (existing) {
    const text =
      existing === "chain"
        ? "One complete swing takes one pendulum period."
        : "A clock tick is another time interval. Both the clock tick and pendulum period are durations.";
    await admit(s, text);
    t = s.capture("Live");
    const r = t.capture!.request,
      basis = fixtureBasis(t, text, r.source.source),
      referent = r.units[0].id;
    const operations: WireOperation[] = [
      {
        type: "put",
        id: r.newUnits[0],
        coreId: r.cores[0].id,
        meaning: {
          kind: "statement",
          text:
            existing === "chain"
              ? "One complete swing takes one pendulum period."
              : "A clock tick is another time interval.",
        },
        dependencies:
          existing === "chain" ? [{ target: referent, kind: "IDENTITY" }] : [],
        basis,
      },
    ];
    if (existing === "reverse")
      operations.push({
        type: "put",
        id: r.newUnits[1],
        coreId: r.cores[0].id,
        meaning: {
          kind: "relation",
          targets: [referent, r.newUnits[0]],
          relation: "comparison",
          text: "The clock tick and pendulum period are both time intervals.",
        },
        dependencies: [],
        basis,
      });
    await s.accept(t, {
      ...fullGroup(t),
      groups: [
        {
          ...fullGroup(t).groups[0],
          outcome: "APPLY",
          operations,
          resolutions: [],
        },
      ],
    });
  }
  await admit(s, "That interval grows.");
  t = s.capture("Live");
  const carry = fullGroup(t, "CARRY");
  carry.groups[0].core = t.capture!.request.cores[0].id;
  await s.accept(t, carry);
  await admit(s, "By that interval I mean the pendulum period.");
  t = s.capture("Live");
  await s.accept(t, fullGroup(t));
  return { s, t: s.capture("Stage") };
}

function resolution(t: Task) {
  const r = t.review!.request;
  const referent = r.units[0].id;
  const target = r.newUnits[0];
  const basis = [
    ...fixtureBasis(t, "That interval grows.", r.items[0].source),
    ...fixtureBasis(t, "By that interval I mean the pendulum period."),
  ];
  return {
    scope: r.scope,
    results: [
      {
        item: r.items[0].id,
        outcome: "RESOLVED",
        operations: [
          {
            type: "put",
            id: target,
            coreId: r.cores[0].id,
            meaning: {
              kind: "statement",
              text: "The pendulum period increases.",
            },
            dependencies: [{ target: referent, kind: "IDENTITY" }],
            basis,
          },
        ] as Extract<WireOperation, { type: "put" }>[],
        resolution: { targets: [target], referents: [referent], basis },
      },
    ],
  };
}

function connectedResolution(t: Task) {
  const reply = resolution(t),
    result = reply.results[0],
    claim = result.operations[0],
    r = t.review!.request;
  claim.dependencies = [];
  result.operations.push(
    {
      ...claim,
      id: r.newUnits[1],
      meaning: {
        kind: "annotation",
        target: claim.id,
        text: "The interval increases.",
      },
    },
    {
      ...claim,
      id: r.newUnits[2],
      meaning: {
        kind: "relation",
        targets: [result.resolution.referents[0], claim.id, r.newUnits[1]],
        relation: "dependency",
        text: "The increasing interval is the pendulum period.",
      },
    },
  );
  result.resolution.targets = result.operations.map((op) => op.id);
  return reply;
}

it("binds a multi-unit resolution through its new relation without inventing leaf dependencies", async () => {
  const { s, t } = await referenceTask();
  const before = structuredClone(s.replay.accounted),
    anchor = structuredClone(Object.values(s.state.units)[0]),
    reply = connectedResolution(t);
  await s.accept(t, reply);
  expect(s.replay.unresolved).toEqual({});
  expect(s.replay.accounted).toEqual(before);
  expect(s.state.units[anchor.id]).toEqual(anchor);
  const ids = reply.results[0].resolution.targets.map(
    (alias) => t.review!.units[alias],
  );
  expect(s.state.units[ids[0]].requires).toEqual([]);
  expect(s.state.units[ids[1]].requires).toEqual([ids[0]]);
  expect(s.state.units[ids[2]].requires).toEqual([anchor.id, ids[0], ids[1]]);
});

it("rejects a disconnected new target beside a correctly connected result component", async () => {
  const { s, t } = await referenceTask();
  const before = structuredClone(s.replay),
    reply = connectedResolution(t),
    result = reply.results[0];
  const unbound = {
    ...result.operations[0],
    id: t.review!.request.newUnits[3],
    meaning: { kind: "statement" as const, text: "An unrelated claim." },
  };
  result.operations.push(unbound);
  result.resolution.targets.push(unbound.id);
  await expect(s.accept(t, reply)).rejects.toThrow("unbound-stage-referent");
  expect(s.replay).toEqual(before);
});

it("rejects a disconnected existing target beside a correctly bound target", async () => {
  const { s, t } = await referenceTask("unrelated");
  const reply = resolution(t);
  reply.results[0].resolution.targets.push(t.review!.request.units[1].id);
  await expect(s.accept(t, reply)).rejects.toThrow("unbound-stage-referent");
});

it("preserves a directed dependency path through existing accepted knowledge", async () => {
  const { s, t } = await referenceTask("chain");
  const reply = resolution(t),
    link = t.review!.request.units.find((u) => u.dependencies.length)!;
  reply.results[0].operations[0].dependencies = [
    { target: link.id, kind: "IDENTITY" },
  ];
  await s.accept(t, reply);
  expect(s.replay.unresolved).toEqual({});
});

it("does not reverse an unchanged historical relation to bind an unrelated target", async () => {
  const { s, t } = await referenceTask("reverse");
  const reply = resolution(t),
    clock = t.review!.request.units.find(
      (u) =>
        u.meaning.kind === "statement" && u.meaning.text.startsWith("A clock"),
    )!;
  reply.results[0].operations[0].dependencies = [
    { target: clock.id, kind: "IDENTITY" },
  ];
  await expect(s.accept(t, reply)).rejects.toThrow("unbound-stage-referent");
});

it.each(["changed", "unchanged", "restored"])(
  "only reverses a captured connector with a net semantic change (%s)",
  async (change) => {
    const { s, t } = await referenceTask("reverse");
    const reply = resolution(t),
      r = t.review!.request,
      relation = r.units.find((u) => u.meaning.kind === "relation")!,
      clock = r.units.find(
        (u) =>
          u.meaning.kind === "statement" &&
          u.meaning.text.startsWith("A clock"),
      )!;
    // Exercise the validator port with explicit host authority for this connector.
    t.writeScope!.units.push(t.review!.units[relation.id]);
    r.writableUnits.push(relation.id);
    const operations: WireOperation[] = reply.results[0].operations;
    operations[0] = {
      ...reply.results[0].operations[0],
      dependencies: [{ target: clock.id, kind: "IDENTITY" }],
    };
    operations.push({
      type: "revise",
      id: relation.id,
      change: {
        field: "text",
        value:
          change !== "unchanged"
            ? "The growing interval is the pendulum period, a time interval like the clock tick."
            : "The clock tick and pendulum period are both time intervals.",
      },
      basis: reply.results[0].resolution.basis,
    });
    if (change === "restored")
      operations.push({
        type: "revise",
        id: relation.id,
        change: {
          field: "text",
          value: "The clock tick and pendulum period are both time intervals.",
        },
        basis: reply.results[0].resolution.basis,
      });
    if (change === "changed") {
      const accepted = validateStage(s.replay, t, reply).accepted;
      expect(accepted.resolved).toEqual(Object.keys(s.replay.unresolved));
    } else
      expect(() => validateStage(s.replay, t, reply)).toThrow(
        "unbound-stage-referent",
      );
  },
);

it("rejects a component whose new connector is invalidated in the same result", async () => {
  const { s, t } = await referenceTask();
  const reply = connectedResolution(t),
    result = reply.results[0],
    operations: WireOperation[] = result.operations;
  result.resolution.targets = [result.operations[0].id];
  operations.push({
    type: "invalidate",
    id: result.operations[2].id,
    basis: result.resolution.basis,
  });
  await expect(s.accept(t, reply)).rejects.toThrow("unbound-stage-referent");
  expect(Object.keys(s.state.units)).toHaveLength(1);
});

it.each([true, false])(
  "requires every declared referent to participate (second connected: %s)",
  async (connected) => {
    const { s, t } = await referenceTask("unrelated");
    const reply = connectedResolution(t),
      result = reply.results[0],
      other = t.review!.request.units[1].id;
    result.resolution.referents.push(other);
    if (connected) {
      const relation = result.operations[2].meaning;
      if (relation.kind !== "relation")
        throw new Error("missing-test-relation");
      relation.targets.push(other);
      await s.accept(t, reply);
      expect(s.replay.unresolved).toEqual({});
    } else
      await expect(s.accept(t, reply)).rejects.toThrow(
        "unbound-stage-referent",
      );
  },
);

it("rejects a connected result after its captured referent changes", async () => {
  const { s, t } = await referenceTask();
  const reply = connectedResolution(t),
    text =
      "Correction: the period means the time for a complete back-and-forth cycle.";
  await admit(s, text);
  const live = s.capture("Live");
  await s.accept(live, establish(live, text));
  await expect(s.accept(t, reply)).rejects.toThrow("stale-dependency:unit/");
  expect(Object.keys(s.replay.unresolved)).toHaveLength(1);
});

it("does not accept the old disconnected resolution that never declares its referents", async () => {
  const { s, t } = await referenceTask();
  const reply = resolution(t);
  reply.results[0].operations[0].dependencies = [];
  delete (reply.results[0].resolution as any).referents;
  await expect(s.accept(t, reply)).rejects.toThrow(
    "incomplete-or-malformed-stage-review",
  );
  expect(Object.keys(s.replay.unresolved)).toHaveLength(1);
});

it("rejects a declared referent that is absent from the resolved semantic graph", async () => {
  const { s, t } = await referenceTask();
  const before = s.replay.accounted;
  const reply = resolution(t);
  reply.results[0].operations[0].dependencies = [];
  await expect(s.accept(t, reply)).rejects.toThrow("unbound-stage-referent");
  expect(Object.keys(s.replay.unresolved)).toHaveLength(1);
  expect(Object.keys(s.state.units)).toHaveLength(1);
  expect(s.replay.accounted).toEqual(before);
});

it("persists the model-selected identity link and resolution without consuming Live source", async () => {
  const { s, t } = await referenceTask();
  expect((await liveRequest(t.review!.request)).reasoning).toEqual({
    effort: "none",
  });
  const before = structuredClone(s.replay.accounted);
  const anchor = structuredClone(Object.values(s.state.units)[0]);
  const reply = resolution(t);
  await s.accept(t, reply);
  const target =
    s.state.units[t.review!.units[reply.results[0].resolution.targets[0]]];
  expect(target.links).toEqual([
    { target: anchor.id, kind: "IDENTITY", version: anchor.version },
  ]);
  expect(s.state.units[anchor.id]).toEqual(anchor);
  expect(s.replay.unresolved).toEqual({});
  expect(s.replay.accounted).toEqual(before);
  const accepted = (await s.store.read(s.id)).at(-1)!;
  expect(accepted.type).toBe("accepted");
  if (accepted.type === "accepted") {
    expect(accepted.accepted.resolutions![0].referents).toEqual([anchor.id]);
    expect(accepted.accepted.dispositions).toEqual([]);
  }
});

it("accepts an explicit annotation relation without redundant declared dependencies", async () => {
  const { s, t } = await referenceTask();
  const reply = resolution(t);
  const op = reply.results[0].operations[0];
  (op as any).meaning = {
    kind: "annotation",
    target: reply.results[0].resolution.referents[0],
    text: "Its period increases.",
  };
  op.dependencies = [];
  await s.accept(t, reply);
  expect(s.replay.unresolved).toEqual({});
});

it("allows resolution directly to existing knowledge without fabricating a semantic mutation", async () => {
  const { s, t } = await referenceTask();
  const before = structuredClone(s.state);
  const reply = resolution(t);
  reply.results[0].operations = [];
  reply.results[0].resolution.targets = [
    ...reply.results[0].resolution.referents,
  ];
  await s.accept(t, reply);
  expect(s.state).toEqual(before);
  expect(s.replay.unresolved).toEqual({});
});

it("permits an explicitly standalone completion without inventing a referent", async () => {
  const { s, t } = await referenceTask();
  const reply = resolution(t);
  reply.results[0].operations[0].dependencies = [];
  reply.results[0].resolution.referents = [];
  // Whether this completion is standalone is a model semantic judgment, not a host heuristic.
  await s.accept(t, reply);
  expect(s.replay.unresolved).toEqual({});
});

it("a newly generated target cannot masquerade as a previously accepted referent", async () => {
  const { s, t } = await referenceTask();
  const reply = resolution(t);
  reply.results[0].resolution.referents = [
    ...reply.results[0].resolution.targets,
  ];
  await expect(s.accept(t, reply)).rejects.toThrow("invalid-stage-referent");
});

it("listing the old referent beside a disconnected new target cannot bypass its required link", async () => {
  const { s, t } = await referenceTask();
  const reply = resolution(t);
  reply.results[0].operations[0].dependencies = [];
  reply.results[0].resolution.targets.push(
    ...reply.results[0].resolution.referents,
  );
  await expect(s.accept(t, reply)).rejects.toThrow("unbound-stage-referent");
});

it("maps authored clarification referents back to captured unit aliases", async () => {
  const { fixtureProposal, story } = await import("../src/story");
  const s = await openSession();
  sessions.push(s);
  s.pause();
  for (const i of [0, 2, 3, 5, 6]) {
    await admit(s, story[i]);
    const live = s.capture("Live");
    await s.accept(live, fixtureProposal(live));
  }
  const stage = s.capture("Stage");
  const reply = fixtureProposal(stage);
  expect("results" in reply).toBe(true);
  if (!("results" in reply)) return;
  const result = reply.results[0];
  expect(result.outcome).toBe("RESOLVED");
  if (result.outcome !== "RESOLVED") return;
  const referent = stage.review!.request.units.find(
    (unit) =>
      unit.meaning.kind === "quantity" &&
      unit.meaning.symbols.some((symbol) => symbol.symbol === "n_i"),
  )!;
  expect(result.resolution!.referents).toEqual([referent.id]);
  await s.accept(stage, reply);
  const accepted = (await s.store.read(s.id)).at(-1)!;
  if (accepted.type === "accepted")
    expect(accepted.accepted.resolutions![0].referents).toEqual([
      stage.review!.units[referent.id],
    ]);
});
