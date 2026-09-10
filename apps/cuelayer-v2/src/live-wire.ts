import { z } from "zod";
import type { Meaning, Expression, Operation } from "./contract";

export const LIVE_WIRE_VERSION = "v2-live-decision-1";
export const carryKindSchema = z.enum([
  "INCOMPLETE_PROPOSITION",
  "UNRESOLVED_REFERENCE",
  "ASR_AMBIGUITY",
  "CONTEXT_REQUIRED",
]);
export type CarryKind = z.infer<typeof carryKindSchema>;
const alias = z.string().min(1);
export const wireBasisSchema = z
  .object({ source: alias, quote: z.string().min(1) })
  .strict();
const basis = z.array(wireBasisSchema).min(1).max(24);
// Flat expression DAG: host compiles earlier node references into the internal AST.
const node = z
  .object({
    key: alias,
    operator: z.enum([
      "Symbol",
      "Number",
      "Equal",
      "Multiply",
      "Divide",
      "Add",
      "Sin",
    ]),
    symbol: z.string().nullable(),
    number: z.number().nullable(),
    operands: z.array(alias).max(2),
  })
  .strict();
export const wireMeaningSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("statement"), text: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("quantity"),
      nodes: z.array(node).min(1).max(32),
      root: alias,
      symbols: z
        .array(
          z
            .object({ symbol: z.string(), label: z.string(), unit: z.string() })
            .strict(),
        )
        .max(32),
      conditions: z.array(z.string()),
      independent: z.string().nullable(),
      domain: z
        .object({ min: z.number(), max: z.number() })
        .strict()
        .nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reaction"),
      notation: z.string().min(1),
      conditions: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("relation"),
      targets: z.array(alias).min(2),
      relation: z.enum(["comparison", "dependency"]),
      text: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("annotation"),
      target: alias,
      text: z.string().min(1),
    })
    .strict(),
]);
export const wireOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("core"),
      id: alias,
      title: z.string().min(1),
      basis,
    })
    .strict(),
  z
    .object({
      type: z.literal("put"),
      id: alias,
      coreId: alias,
      meaning: wireMeaningSchema,
      requires: z.array(alias),
      basis,
    })
    .strict(),
  z.object({ type: z.literal("invalidate"), id: alias, basis }).strict(),
  z.object({ type: z.literal("mainline"), coreId: alias, basis }).strict(),
  z
    .object({
      type: z.literal("cue"),
      value: z
        .object({
          text: z.string(),
          targets: z.array(alias),
          origin: z.literal("TEACHER"),
          basis,
        })
        .strict()
        .nullable(),
      basis,
    })
    .strict(),
]);
export const wireAttentionSchema = z
  .object({
    targets: z.array(alias),
    mode: z.enum(["FOCUS", "COMPARE", "WIDEN"]),
  })
  .strict();
export const liveDecisionSchema = z
  .object({
    version: z.literal(LIVE_WIRE_VERSION),
    scope: z.string().min(1),
    groups: z
      .array(
        z
          .object({
            throughBoundary: alias,
            outcome: z.enum(["APPLY", "NO_CHANGE", "CARRY"]),
            operations: z.array(wireOperationSchema).max(24),
            carry: z
              .object({
                kind: carryKindSchema,
                phrase: z.string().min(1),
                core: alias.nullable(),
              })
              .strict()
              .nullable(),
            resolutions: z.array(alias),
          })
          .strict(),
      )
      .max(24),
    suffixStatus: z.enum(["NONE", "WAIT_MORE_INPUT", "OUTPUT_CAPACITY"]),
    reviewRequests: z
      .array(z.object({ core: alias, purpose: z.string().min(1) }).strict())
      .max(4),
    attentionCandidate: wireAttentionSchema.nullable(),
  })
  .strict();
export type LiveDecision = z.infer<typeof liveDecisionSchema>;
export type WireOperation = z.infer<typeof wireOperationSchema>;
export type WireMeaning = z.infer<typeof wireMeaningSchema>;
export function compileMeaning(
  m: WireMeaning,
  unit: (alias: string) => string,
): Meaning {
  if (m.kind === "annotation") return { ...m, target: unit(m.target) };
  if (m.kind === "relation") return { ...m, targets: m.targets.map(unit) };
  if (m.kind !== "quantity") return m;
  const nodes = new Map<string, Expression>();
  const sizes = new Map<string, { size: number; depth: number }>();
  for (const n of m.nodes) {
    if (nodes.has(n.key)) throw new Error("duplicate-expression-node");
    let e: Expression;
    if (n.operator === "Symbol") {
      if (!n.symbol || n.number !== null || n.operands.length)
        throw new Error("invalid-symbol-node");
      e = n.symbol;
    } else if (n.operator === "Number") {
      if (n.number === null || n.symbol !== null || n.operands.length)
        throw new Error("invalid-number-node");
      e = n.number;
    } else {
      if (
        n.symbol !== null ||
        n.number !== null ||
        n.operands.length !== (n.operator === "Sin" ? 1 : 2)
      )
        throw new Error("missing-operand");
      e = [
        n.operator,
        ...n.operands.map((k) => {
          const e = nodes.get(k);
          if (e === undefined) throw new Error("invalid-expression-reference");
          return e;
        }),
      ];
    }
    const size =
      1 +
      n.operands.reduce((total, key) => total + (sizes.get(key)?.size ?? 0), 0);
    const depth =
      1 + Math.max(0, ...n.operands.map((key) => sizes.get(key)?.depth ?? 0));
    if (size > 128 || depth > 12) throw new Error("expression-budget");
    sizes.set(n.key, { size, depth });
    nodes.set(n.key, e);
  }
  const expression = nodes.get(m.root);
  if (
    expression === undefined ||
    new Set(m.symbols.map((s) => s.symbol)).size !== m.symbols.length
  )
    throw new Error("invalid-expression-root-or-symbols");
  return {
    kind: "quantity",
    expression,
    symbols: Object.fromEntries(
      m.symbols.map(({ symbol, ...v }) => [symbol, v]),
    ),
    conditions: m.conditions,
    ...(m.independent === null ? {} : { independent: m.independent }),
    ...(m.domain === null
      ? {}
      : { domain: [m.domain.min, m.domain.max] as [number, number] }),
  };
}
/** Host/test projection only, never inference. */
export function projectMeaning(
  m: Meaning,
  unit: (id: string) => string,
): WireMeaning {
  if (m.kind === "annotation") return { ...m, target: unit(m.target) };
  if (m.kind === "relation") return { ...m, targets: m.targets.map(unit) };
  if (m.kind !== "quantity") return m;
  const nodes: Extract<WireMeaning, { kind: "quantity" }>["nodes"] = [];
  const visit = (e: Expression): string => {
    const operands = Array.isArray(e) ? e.slice(1).map((x) => visit(x)) : [];
    const key = `x${nodes.length}`;
    nodes.push({
      key,
      operator: Array.isArray(e)
        ? (e[0] as "Equal")
        : typeof e === "string"
          ? "Symbol"
          : "Number",
      symbol: typeof e === "string" ? e : null,
      number: typeof e === "number" ? e : null,
      operands,
    });
    return key;
  };
  const root = visit(m.expression);
  return {
    kind: "quantity",
    nodes,
    root,
    symbols: Object.entries(m.symbols).map(([symbol, v]) => ({ symbol, ...v })),
    conditions: m.conditions,
    independent: m.independent ?? null,
    domain: m.domain ? { min: m.domain[0], max: m.domain[1] } : null,
  };
}
export type ExpandedOperations = Operation[];
