import { afterEach, expect, it } from "vitest";
import { Session } from "../src/session";
import type { Task } from "../src/contract";
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

async function referenceTask() {
  const s = await openSession();
  sessions.push(s);
  s.pause();
  await admit(s, "The pendulum period is the time needed for one cycle.");
  let t = s.capture("Live");
  await s.accept(
    t,
    establish(t, "The pendulum period is the time needed for one cycle."),
  );
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
        ],
        resolution: { targets: [target], referents: [referent], basis },
      },
    ],
  };
}

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
