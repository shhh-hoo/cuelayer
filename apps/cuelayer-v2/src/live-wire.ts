import { z } from "zod";
import type { Meaning, Expression } from "./contract";
export const LIVE_WIRE_VERSION = "v2-live-decision-3";
export const carryKindSchema = z.enum([
  "INCOMPLETE_PROPOSITION",
  "UNRESOLVED_REFERENCE",
  "ASR_AMBIGUITY",
  "CONTEXT_REQUIRED",
]);
export type CarryKind = z.infer<typeof carryKindSchema>;
export const alias = z.string().min(1);
export const wireBasisSchema = z
  .object({ source: alias, start: alias, end: alias })
  .strict();
export const basis = z.array(wireBasisSchema).min(1).max(24);
export const wireDependencySchema = z
  .object({ target: alias, kind: z.enum(["IDENTITY", "VALUE"]) })
  .strict();
export const expressionNodesSchema = z
  .array(
    z.union([
      alias,
      z.number().finite(),
      z
        .object({
          operator: z.enum(["Equal", "Multiply", "Divide", "Add", "Sin"]),
          operands: z.array(z.number().int().nonnegative()).min(1).max(2),
        })
        .strict(),
    ]),
  )
  .min(1)
  .max(32);
export const symbols = z
  .array(
    z.object({ symbol: alias, label: z.string(), unit: z.string() }).strict(),
  )
  .max(32);
export const domain = z
  .object({ min: z.number(), max: z.number() })
  .strict()
  .nullable();
export const wireMeaningSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("statement"), text: alias }).strict(),
  z
    .object({
      kind: z.literal("quantity"),
      nodes: expressionNodesSchema,
      symbols,
      conditions: z.array(z.string()),
      independent: z.string().nullable(),
      domain,
    })
    .strict(),
  z
    .object({
      kind: z.literal("reaction"),
      notation: alias,
      conditions: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("relation"),
      targets: z.array(alias).min(2),
      relation: z.enum(["comparison", "dependency"]),
      text: alias,
    })
    .strict(),
  z
    .object({ kind: z.literal("annotation"), target: alias, text: alias })
    .strict(),
]);
export const wireChangeSchema = z.discriminatedUnion("field", [
  z.object({ field: z.enum(["text", "notation"]), value: alias }).strict(),
  z
    .object({ field: z.literal("expression"), value: expressionNodesSchema })
    .strict(),
  z.object({ field: z.literal("symbols"), value: symbols }).strict(),
  z
    .object({ field: z.literal("conditions"), value: z.array(z.string()) })
    .strict(),
  z
    .object({ field: z.literal("independent"), value: z.string().nullable() })
    .strict(),
  z.object({ field: z.literal("domain"), value: domain }).strict(),
  z
    .object({ field: z.literal("targets"), value: z.array(alias).min(2) })
    .strict(),
  z.object({ field: z.literal("target"), value: alias }).strict(),
  z
    .object({
      field: z.literal("relation"),
      value: z.enum(["comparison", "dependency"]),
    })
    .strict(),
  z
    .object({
      field: z.literal("dependencies"),
      value: z.array(wireDependencySchema).max(24),
    })
    .strict(),
]);
export const wireOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.enum(["core", "setCoreLabel"]),
      id: alias,
      label: alias,
      basis,
    })
    .strict(),
  z
    .object({
      type: z.literal("put"),
      id: alias,
      coreId: alias,
      meaning: wireMeaningSchema,
      dependencies: z.array(wireDependencySchema).max(24),
      basis,
    })
    .strict(),
  z
    .object({
      type: z.literal("revise"),
      id: alias,
      change: wireChangeSchema,
      basis,
    })
    .strict(),
  z
    .object({ type: z.enum(["revalidate", "invalidate"]), id: alias, basis })
    .strict(),
  z.object({ type: z.literal("mainline"), coreId: alias, basis }).strict(),
  z
    .object({
      type: z.literal("cue"),
      value: z
        .object({ text: alias, targets: z.array(alias) })
        .strict()
        .nullable(),
      basis,
    })
    .strict(),
]);
export const wireResolutionSchema = z
  .object({ obligation: alias, targets: z.array(alias).min(1).max(8), basis })
  .strict();
export const wireAttentionSchema = z
  .object({
    targets: z.array(alias),
    mode: z.enum(["FOCUS", "COMPARE", "WIDEN"]),
  })
  .strict();
export const contextRequestSchema = z
  .object({
    query: z.string().min(1).max(160),
    purpose: z.enum(["READ", "MODIFY"]),
    after: alias.nullable(),
  })
  .strict();
export const liveGroupSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("APPLY"),
      throughBoundary: alias,
      operations: z.array(wireOperationSchema).max(24),
      resolutions: z.array(wireResolutionSchema).max(8),
    })
    .strict(),
  z
    .object({ outcome: z.literal("NO_CHANGE"), throughBoundary: alias })
    .strict(),
  z
    .object({
      outcome: z.literal("CARRY"),
      throughBoundary: alias,
      kind: carryKindSchema,
      core: alias.nullable(),
    })
    .strict(),
]);
// The provider schema root is always an object; alternatives are nested strict branches.
const liveDecisionShape = z
  .object({
    scope: alias,
    groups: z.array(liveGroupSchema).max(24),
    suffixStatus: z.enum(["NONE", "WAIT_MORE_INPUT", "OUTPUT_CAPACITY"]),
    contextRequest: contextRequestSchema.nullable(),
    reviewRequests: z
      .array(
        z
          .object({
            core: alias,
            targets: z.array(alias).max(8),
            purpose: alias,
          })
          .strict(),
      )
      .max(4),
    attentionCandidate: wireAttentionSchema.nullable(),
  })
  .strict();
export const liveDecisionSchema = liveDecisionShape.refine(
  (p) => !p.contextRequest || p.suffixStatus === "WAIT_MORE_INPUT",
  "context-request-requires-wait",
);
// A lookup is itself the WAIT continuation, so the provider cannot pair it
// with NONE/OUTPUT_CAPACITY. Dynamic range and cursor checks remain in host.
export const liveProviderDecisionSchema = liveDecisionShape
  .omit({ suffixStatus: true, contextRequest: true })
  .extend({
    continuation: z.union([
      z.enum(["NONE", "WAIT_MORE_INPUT", "OUTPUT_CAPACITY"]),
      contextRequestSchema,
    ]),
  })
  .strict();
export function expandProviderDecision(raw: unknown): LiveDecision {
  const { continuation, ...decision } = liveProviderDecisionSchema.parse(raw);
  return {
    ...decision,
    suffixStatus:
      typeof continuation === "string" ? continuation : "WAIT_MORE_INPUT",
    contextRequest: typeof continuation === "string" ? null : continuation,
  };
}
export type LiveDecision = z.infer<typeof liveDecisionSchema>;
export type WireOperation = z.infer<typeof wireOperationSchema>;
export type WireMeaning = z.infer<typeof wireMeaningSchema>;
export type WireBasis = z.infer<typeof wireBasisSchema>;
export function compileExpression(
  nodes: z.infer<typeof expressionNodesSchema>,
): Expression {
  const values: Expression[] = [],
    sizes: { size: number; depth: number }[] = [];
  for (const n of nodes) {
    let value: Expression;
    const operands = typeof n === "object" ? n.operands : [];
    if (typeof n === "string" || typeof n === "number") value = n;
    else {
      if (operands.length !== (n.operator === "Sin" ? 1 : 2))
        throw new Error("missing-operand");
      value = [
        n.operator,
        ...operands.map((i) => {
          if (!Number.isInteger(i) || i < 0 || i >= values.length)
            throw new Error("invalid-expression-reference");
          return values[i];
        }),
      ];
    }
    const size = 1 + operands.reduce((s, i) => s + sizes[i].size, 0),
      depth = 1 + Math.max(0, ...operands.map((i) => sizes[i].depth));
    if (size > 128 || depth > 12) throw new Error("expression-budget");
    values.push(value);
    sizes.push({ size, depth });
  }
  if (!values.length) throw new Error("invalid-expression-root-or-symbols");
  return values.at(-1)!;
}
export function projectExpression(expression: Expression) {
  const nodes: z.infer<typeof expressionNodesSchema> = [];
  const visit = (e: Expression): number => {
    const operands = Array.isArray(e) ? e.slice(1).map(visit) : [];
    const at = nodes.length;
    if (typeof e === "string") nodes.push(e);
    else if (typeof e === "number") nodes.push(e);
    else nodes.push({ operator: e[0] as "Equal", operands });
    return at;
  };
  visit(expression);
  return nodes;
}
export function compileMeaning(
  m: WireMeaning,
  unit: (alias: string) => string,
): Meaning {
  if (m.kind === "annotation") return { ...m, target: unit(m.target) };
  if (m.kind === "relation") return { ...m, targets: m.targets.map(unit) };
  if (m.kind !== "quantity") return m;
  if (new Set(m.symbols.map((s) => s.symbol)).size !== m.symbols.length)
    throw new Error("duplicate-symbol");
  return {
    kind: "quantity",
    expression: compileExpression(m.nodes),
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
export function projectMeaning(
  m: Meaning,
  unit: (id: string) => string,
): WireMeaning {
  if (m.kind === "annotation") return { ...m, target: unit(m.target) };
  if (m.kind === "relation") return { ...m, targets: m.targets.map(unit) };
  if (m.kind !== "quantity") return m;
  return {
    kind: "quantity",
    nodes: projectExpression(m.expression),
    symbols: Object.entries(m.symbols).map(([symbol, v]) => ({ symbol, ...v })),
    conditions: m.conditions,
    independent: m.independent ?? null,
    domain: m.domain ? { min: m.domain[0], max: m.domain[1] } : null,
  };
}

export const wireDefinitions = {
  a: alias,
  b: basis,
  n: expressionNodesSchema,
  s: symbols,
  d: domain,
  e: wireDependencySchema,
};
