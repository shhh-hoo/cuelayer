import { expect, it } from "vitest";
import {
  liveDecisionSchema,
  liveProviderDecisionSchema,
  expandProviderDecision,
  projectMeaning,
  compileMeaning,
  compileExpression,
} from "../src/live-wire";
import { liveRequest, livePolicy, modelProfile } from "../server/live";
import {
  openSession,
  admit,
  establish,
  waitDecision,
} from "./frontier-fixtures";
import { validate } from "../src/acceptance";
import type { Meaning } from "../src/contract";

it("rejects a lookup paired with an accounted NONE suffix at the model contract", () => {
  const proposal = {
    scope: "capture",
    groups: [
      {
        outcome: "CARRY",
        throughBoundary: "b9",
        kind: "CONTEXT_REQUIRED",
        core: null,
      },
    ],
    suffixStatus: "NONE",
    contextRequest: {
      query: "existing quantity",
      purpose: "MODIFY",
      after: null,
    },
    reviewRequests: [],
    attentionCandidate: null,
  };
  expect(liveDecisionSchema.safeParse(proposal).success).toBe(false);
});

it("provider continuation admits legal waits and cannot combine lookup with NONE or capacity", () => {
  const { suffixStatus: _, contextRequest: __, ...base } = waitDecision();
  for (const continuation of [
    "NONE",
    "WAIT_MORE_INPUT",
    "OUTPUT_CAPACITY",
    { query: "established quantity", purpose: "READ", after: null },
    { query: "established quantity", purpose: "MODIFY", after: "u4" },
  ]) {
    const value = { ...base, continuation };
    expect(liveProviderDecisionSchema.safeParse(value).success).toBe(true);
    expect(
      liveDecisionSchema.safeParse(expandProviderDecision(value)).success,
    ).toBe(true);
  }
  for (const suffixStatus of ["NONE", "OUTPUT_CAPACITY"])
    expect(
      liveProviderDecisionSchema.safeParse({
        ...base,
        suffixStatus,
        continuation: { query: "quantity", purpose: "MODIFY", after: null },
      }).success,
    ).toBe(false);
  expect(
    liveProviderDecisionSchema.safeParse({
      ...base,
      continuation: { query: "", purpose: "WRITE", after: null },
    }).success,
  ).toBe(false);
});

it("issued new slots work with empty existing write/create permissions; lookup cursor is not a source cut", async () => {
  const s = await openSession();
  s.pause();
  try {
    await admit(s, "The sample is sealed.");
    const t = s.capture("Live")!,
      r = t.capture!.request;
    expect(r.writableUnits).toEqual([]);
    expect(r.createWithin).toEqual([]);
    const proposal = establish(t, "The sample is sealed.");
    expect(
      validate(s.replay, t, proposal).accepted.operations.some(
        (o) => o.type === "put",
      ),
    ).toBe(true);
    const lookup = {
      ...waitDecision(t),
      contextRequest: {
        query: "existing sample",
        purpose: "MODIFY",
        after: null as string | null,
      },
    };
    expect(validate(s.replay, t, lookup).decision.contextRequest?.purpose).toBe(
      "MODIFY",
    );
    lookup.contextRequest.after = r.source.end;
    expect(() => validate(s.replay, t, lookup)).toThrow(
      "invalid-search-cursor",
    );
    await s.accept(t, proposal);
    s.pause();
    await admit(s, "The sample is heated.");
    const next = s.capture("Live")!;
    const illegal = establish(next, "The sample is heated.");
    next.writeScope!.units = [];
    expect(() => validate(s.replay, next, illegal)).toThrow();
    expect(livePolicy).toContain(
      "EXISTING Cores, not a Core created in this proposal",
    );
  } finally {
    s.close();
  }
});

it("compact quantity leaves preserve operators, numeric values, symbols, units, conditions and graph domain", () => {
  const values: Meaning[] = [
    {
      kind: "quantity",
      expression: ["Equal", "area", ["Multiply", "length", "width"]],
      symbols: {
        area: { label: "area", unit: "m²" },
        length: { label: "length", unit: "m" },
        width: { label: "width", unit: "m" },
      },
      conditions: ["rectangular shape"],
    },
    {
      kind: "quantity",
      expression: ["Equal", "y", ["Add", ["Sin", "x"], ["Divide", -2, 3]]],
      symbols: {
        x: { label: "angle", unit: "rad" },
        y: { label: "value", unit: "dimensionless" },
      },
      conditions: ["x is real"],
      independent: "x",
      domain: [-3, 3],
    },
  ];
  for (const meaning of values)
    expect(
      compileMeaning(
        projectMeaning(meaning, (x) => x),
        (x) => x,
      ),
    ).toEqual(meaning);
  const wire = projectMeaning(values[0], (x) => x);
  expect(wire.kind === "quantity" && wire.nodes.slice(0, 3)).toEqual([
    "area",
    "length",
    "width",
  ]);
  expect(() =>
    compileExpression(["x", { operator: "Equal", operands: [0, 2] }]),
  ).toThrow("invalid-expression-reference");
  expect(() =>
    compileExpression(["x", { operator: "Equal", operands: [0] }]),
  ).toThrow("missing-operand");
});

it("production strict schema exposes only the new continuation and compact leaves without changing deadlines", async () => {
  const s = await openSession();
  s.pause();
  try {
    await admit(s, "The sample is sealed.");
    const payload = await liveRequest(s.capture("Live")!.capture!.request);
    const schema = payload.text.format.schema as any;
    expect(schema.type).toBe("object");
    expect(schema.properties.continuation).toBeDefined();
    expect(schema.properties.contextRequest).toBeUndefined();
    expect(schema.properties.suffixStatus).toBeUndefined();
    expect(JSON.stringify(schema)).not.toContain('"const":"Symbol"');
    expect(modelProfile).toMatchObject({
      providerTimeoutMs: 6000,
      clientTimeoutMs: 8000,
      sdkRetries: 0,
      transportRetries: 2,
      reasoning: "low",
    });
  } finally {
    s.close();
  }
});
