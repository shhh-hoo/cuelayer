import { afterEach, expect, it } from "vitest";
import { Session } from "../src/session";
import {
  emptyReplay,
  fold,
  reduceSemanticOperations,
  type Grounding,
  type Meaning,
  type Operation,
  type Task,
} from "../src/contract";
import {
  liveProviderDecisionSchema,
  projectMeaning,
  type WireOperation,
} from "../src/live-wire";
import { validate } from "../src/acceptance";
import {
  admit,
  fixtureBasis,
  openSession,
  waitDecision,
  type ApplyDecision,
} from "./frontier-fixtures";

const sessions: Session[] = [];
afterEach(() => sessions.splice(0).forEach((s) => s.close()));
const relation = "Partial pressure equals mole fraction times total pressure.";
const units = "Both pressures are in pascals; mole fraction is dimensionless.";
const condition = "This relation applies to an ideal gas mixture.";
const meaning: Meaning = {
  kind: "quantity",
  expression: ["Equal", "p", ["Multiply", "x", "P"]],
  symbols: {
    p: { label: "partial pressure", unit: "Pa" },
    x: { label: "mole fraction", unit: "1" },
    P: { label: "total pressure", unit: "Pa" },
  },
  conditions: ["ideal gas mixture"],
};
async function captured() {
  const s = await openSession();
  sessions.push(s);
  s.pause();
  for (const text of [relation, units, condition]) await admit(s, text);
  const task = s.capture("Live"),
    request = task.capture!.request,
    relationBasis = fixtureBasis(task, relation);
  const put: Extract<WireOperation, { type: "put" }> = {
    type: "put",
    id: request.newUnits[0],
    coreId: request.newCores[0],
    meaning: projectMeaning(meaning, (id) => id),
    dependencies: [],
    // The host aggregates explicit field evidence; a short overall basis must
    // not lose the separately declared physical units or condition statement.
    basis: relationBasis,
    fieldBasis: [
      { field: "expression", basis: relationBasis },
      {
        field: "symbols",
        basis: [...relationBasis, ...fixtureBasis(task, units)],
      },
      { field: "conditions", basis: fixtureBasis(task, condition) },
    ],
  };
  const decision: ApplyDecision = {
    ...waitDecision(task),
    suffixStatus: "NONE",
    groups: [
      {
        outcome: "APPLY",
        throughBoundary: request.source.end,
        operations: [
          {
            type: "core",
            id: request.newCores[0],
            label: "Gas mixtures",
            basis: relationBasis,
          },
          put,
        ],
        resolutions: [],
      },
    ],
  };
  return { s, task, decision, put };
}
const quotes = (basis: Grounding[] | undefined) => basis?.map((b) => b.quote);
const alias = (task: Task, id: string) =>
  Object.keys(task.capture!.units).find((a) => task.capture!.units[a] === id)!;

it("stores separate quantity relation, symbol/unit and condition evidence and replays it exactly", async () => {
  const { s, task, decision } = await captured();
  await s.accept(task, decision);
  const quantity = Object.values(s.state.units)[0];
  expect(quantity.meaning).toEqual(meaning);
  expect(quotes(quantity.fieldBasis?.expression)).toEqual([relation]);
  expect(quotes(quantity.fieldBasis?.symbols)).toEqual([relation, units]);
  expect(quotes(quantity.fieldBasis?.conditions)).toEqual([condition]);
  expect(quantity.fieldBasis?.dependencies).toBeUndefined();
  expect(quotes(quantity.basis)).toEqual([relation, units, condition]);
  const events = await s.store.read(s.id);
  expect(events.reduce(fold, emptyReplay()).state).toEqual(s.state);
});

it("rejects missing quantity field evidence even when an annotation cites the omitted unit statement", async () => {
  const { s, task, decision, put } = await captured();
  delete put.fieldBasis;
  decision.groups[0].operations.push({
    type: "put",
    id: task.capture!.request.newUnits[1],
    coreId: put.coreId,
    meaning: { kind: "annotation", target: put.id, text: units },
    dependencies: [],
    basis: fixtureBasis(task, units),
  });
  expect(() => validate(s.replay, task, decision)).toThrow(
    "missing-quantity-field-basis",
  );
  const { suffixStatus, contextRequest: _, ...wire } = decision;
  expect(
    liveProviderDecisionSchema.safeParse({
      ...wire,
      continuation: suffixStatus,
    }).success,
  ).toBe(false);
});

it.each([
  ["missing symbols", "incomplete-or-invalid-field-basis"],
  ["duplicate field", "duplicate-field-basis"],
  ["wrong kind field", "incomplete-or-invalid-field-basis"],
  ["uncaptured source", "unknown-or-cross-task-source-alias"],
  ["unissued cut", "unknown-or-cross-task-source-alias"],
  ["empty range", "invalid-grounding-range"],
])("rejects %s in an otherwise grounded quantity", async (change, reason) => {
  const { s, task, decision, put } = await captured();
  const symbol = put.fieldBasis![1];
  if (change === "missing symbols") put.fieldBasis!.splice(1, 1);
  if (change === "duplicate field") put.fieldBasis!.push(symbol);
  if (change === "wrong kind field") symbol.field = "text";
  if (change === "uncaptured source") symbol.basis[0].source = "outside";
  if (change === "unissued cut") symbol.basis[0].end = "missing-cut";
  if (change === "empty range") symbol.basis[0].end = symbol.basis[0].start;
  expect(() => validate(s.replay, task, decision)).toThrow(reason);
});

it("does not borrow later PROCESS field evidence across an earlier operation group", async () => {
  const { s, task, decision } = await captured();
  decision.groups[0].throughBoundary = fixtureBasis(task, relation)[0].end;
  decision.groups.push({
    outcome: "APPLY",
    throughBoundary: task.capture!.request.source.end,
    operations: [],
    resolutions: [],
  });
  expect(() => validate(s.replay, task, decision)).toThrow(
    "grounding-outside-processing-group",
  );
});

it("allows absent optional/empty fields without inventing evidence and requires present domain evidence", async () => {
  const { s, task, decision, put } = await captured();
  if (put.meaning.kind !== "quantity") throw new Error("fixture-kind");
  put.meaning.conditions = [];
  put.fieldBasis = put.fieldBasis!.filter((b) => b.field !== "conditions");
  expect(() => validate(s.replay, task, decision)).not.toThrow();
  put.meaning.independent = "x";
  put.meaning.domain = { min: 0, max: 1 };
  expect(() => validate(s.replay, task, decision)).toThrow(
    "incomplete-or-invalid-field-basis",
  );
});

it("replaces corrected symbols and conditions locally while preserving the relation and superseded event evidence", async () => {
  const { s, task, decision } = await captured();
  await s.accept(task, decision);
  const id = Object.keys(s.state.units)[0],
    originalExpression = structuredClone(
      s.state.units[id].fieldBasis!.expression,
    );
  const correction =
    "Correction: p denotes partial pressure in kilopascals, P denotes total pressure in kilopascals, and x denotes dimensionless mole fraction.";
  await admit(s, correction);
  let t = s.capture("Live");
  const apply = (operations: WireOperation[]): ApplyDecision => ({
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
  });
  await s.accept(
    t,
    apply([
      {
        type: "revise",
        id: alias(t, id),
        change: {
          field: "symbols",
          value: [
            { symbol: "p", label: "partial pressure", unit: "kPa" },
            { symbol: "x", label: "mole fraction", unit: "1" },
            { symbol: "P", label: "total pressure", unit: "kPa" },
          ],
        },
        basis: fixtureBasis(t, correction),
      },
    ]),
  );
  expect(quotes(s.state.units[id].fieldBasis!.symbols)).toEqual([correction]);
  expect(s.state.units[id].fieldBasis!.expression).toEqual(originalExpression);
  expect(quotes(s.state.units[id].fieldBasis!.conditions)).toEqual([condition]);
  expect(quotes(s.state.units[id].basis)).not.toContain(units);
  const removed = "The ideal-gas condition no longer applies.";
  await admit(s, removed);
  t = s.capture("Live");
  await s.accept(
    t,
    apply([
      {
        type: "revise",
        id: alias(t, id),
        change: { field: "conditions", value: [] },
        basis: fixtureBasis(t, removed),
      },
    ]),
  );
  expect(quotes(s.state.units[id].fieldBasis!.conditions)).toEqual([removed]);
  expect(s.state.units[id].fieldBasis!.expression).toEqual(originalExpression);
  const events = await s.store.read(s.id);
  expect(JSON.stringify(events)).toContain(units);
  expect(JSON.stringify(events)).toContain(condition);
  expect(events.reduce(fold, emptyReplay()).state).toEqual(s.state);
});

it("keeps historical event-3 puts on their original uniform-basis reducer path", () => {
  const oldBasis = [{ evidenceId: "old", quote: "P is 200 kPa." }];
  const ops: Operation[] = [
    { type: "core", id: "c", label: "Pressure", basis: oldBasis },
    {
      type: "put",
      id: "p",
      coreId: "c",
      meaning: {
        kind: "quantity",
        expression: ["Equal", "P", 200],
        symbols: { P: { label: "pressure", unit: "kPa" } },
        conditions: [],
      },
      requires: [],
      dependencies: [],
      basis: oldBasis,
    },
  ];
  const old = reduceSemanticOperations(emptyReplay().state, ops).units.p;
  expect(old.fieldBasis).toEqual({
    expression: oldBasis,
    symbols: oldBasis,
    conditions: oldBasis,
    dependencies: oldBasis,
  });
});

it("dependency revalidation preserves each meaning field's evidence", () => {
  const b = (quote: string): Grounding[] => [{ evidenceId: quote, quote }];
  const create = (id: string, depends: string[]): Operation => ({
    type: "put",
    id,
    coreId: "c",
    meaning: { kind: "statement", text: id },
    requires: depends,
    dependencies: depends.map((target) => ({ target, kind: "VALUE" })),
    basis: b(id),
    fieldBasis: { text: b(id) },
  });
  let state = reduceSemanticOperations(emptyReplay().state, [
    { type: "core", id: "c", label: "Relations", basis: b("core") },
    create("a", []),
    create("b", ["a"]),
  ]);
  state = reduceSemanticOperations(state, [
    {
      type: "revise",
      id: "a",
      change: { field: "text", value: "corrected a" },
      basis: b("correction"),
    },
  ]);
  expect(state.units.b.reviewRequired).toBe(true);
  const before = structuredClone(state.units.b.fieldBasis!.text);
  state = reduceSemanticOperations(state, [
    { type: "revalidate", id: "b", basis: b("still follows") },
  ]);
  expect(state.units.b.reviewRequired).toBe(false);
  expect(state.units.b.fieldBasis!.text).toEqual(before);
  expect(state.units.b.fieldBasis!.dependencies).toEqual(b("still follows"));
});
