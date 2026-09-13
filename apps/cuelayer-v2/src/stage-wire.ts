import { z } from "zod";
import {
  alias,
  basis,
  wireMeaningSchema,
  wireChangeSchema,
  wireFieldBasisSchema,
  type WireBasis,
  type WireMeaning,
  type WireOperation,
} from "./live-wire";
import type { StageRequest, StageReview } from "./stage";

export const STAGE_DECLARATION_VERSION = "v2-stage-declarations-1";
// Integers refer to earlier declarations in this result, never persistent IDs.
export const stageReferenceSchema = z.union([
  alias,
  z.number().int().nonnegative(),
]);
const references = z.array(stageReferenceSchema).max(24);
const nonQuantityMeaning = z.union([
  wireMeaningSchema.options[0],
  wireMeaningSchema.options[2],
  wireMeaningSchema.options[3].extend({
    targets: references.min(2),
  }),
  wireMeaningSchema.options[4].extend({ target: stageReferenceSchema }),
]);
const add = {
  action: z.literal("ADD"),
  about: references,
  usesValue: references,
};
const change = wireChangeSchema.options;
const fieldChange = z.discriminatedUnion("field", [
  change[0].extend({ basis }),
  change[1].extend({ basis }),
  change[2].extend({ basis }),
  change[3].extend({ basis }),
  change[4].extend({ basis }),
  change[5].extend({ basis }),
  change[6].extend({ value: references.min(2), basis }),
  change[7].extend({ value: stageReferenceSchema, basis }),
  change[8].extend({ basis }),
]);
export const stageDeclarationSchema = z.union([
  z.object({ ...add, meaning: nonQuantityMeaning, basis }).strict(),
  z
    .object({
      ...add,
      meaning: wireMeaningSchema.options[1],
      fieldBasis: z.array(wireFieldBasisSchema).min(1).max(6),
    })
    .strict(),
  z
    .object({
      action: z.literal("AMEND"),
      unit: alias,
      changes: z.array(fieldChange).min(1).max(12),
    })
    .strict(),
  z
    .object({
      action: z.literal("CONNECT"),
      unit: alias,
      about: references,
      usesValue: references,
      basis,
    })
    .strict(),
  z
    .object({
      action: z.enum(["REVALIDATE", "INVALIDATE"]),
      unit: alias,
      basis,
    })
    .strict(),
  z.object({ action: z.literal("CONFIRM"), unit: alias, basis }).strict(),
]);
export const stageDeclarationReviewSchema = z
  .object({
    scope: alias,
    results: z
      .array(
        z.discriminatedUnion("outcome", [
          z.object({ item: alias, outcome: z.literal("STILL_OPEN") }).strict(),
          z
            .object({
              item: alias,
              outcome: z.literal("RESOLVED"),
              referents: z.array(alias).max(8),
              declarations: z.array(stageDeclarationSchema).min(1).max(24),
            })
            .strict(),
          z
            .object({
              item: alias,
              outcome: z.literal("WITHDRAWN"),
              supersededBy: alias,
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(4),
  })
  .strict();
export type StageDeclarationReview = z.infer<
  typeof stageDeclarationReviewSchema
>;

const fail = (reason: string): never => {
  throw new Error(`invalid-stage-declaration:${reason}`);
};
const uniqueBasis = (groups: WireBasis[][]) => [
  ...new Map(groups.flat().map((b) => [JSON.stringify(b), b])).values(),
];

/** Compile selected semantic declarations; acceptance still owns state/version/grounding checks. */
export function compileStageDeclarations(
  request: StageRequest,
  raw: unknown,
): StageReview {
  const parsed = stageDeclarationReviewSchema.parse(raw);
  if (parsed.scope !== request.scope) fail("scope");
  if (
    parsed.results.length !== request.items.length ||
    new Set(parsed.results.map((r) => r.item)).size !== parsed.results.length
  )
    fail("items");
  let allocated = 0;
  const captured = (name: string) => {
    if (!request.units.some((u) => u.id === name)) fail("uncaptured-reference");
    return name;
  };
  return {
    scope: parsed.scope,
    results: parsed.results.map((result) => {
      const item = request.items.find((i) => i.id === result.item);
      if (!item) fail("item");
      if (result.outcome === "STILL_OPEN") return result;
      if (result.outcome === "WITHDRAWN")
        return { ...result, supersededBy: captured(result.supersededBy) };
      const referents = result.referents.map(captured);
      if (new Set(referents).size !== referents.length)
        fail("duplicate-referent");
      const local: string[] = [],
        targets: string[] = [];
      const operations: WireOperation[] = [];
      const evidence: WireBasis[][] = [];
      const reference = (value: string | number): string => {
        if (typeof value === "string") return captured(value);
        if (!Number.isInteger(value) || value < 0 || value >= local.length)
          fail("forward-or-missing-reference");
        return local[value];
      };
      const dependencies = (
        about: (string | number)[],
        usesValue: (string | number)[],
      ) => {
        const values = [
          ...about.map((r) => ({
            target: reference(r),
            kind: "IDENTITY" as const,
          })),
          ...usesValue.map((r) => ({
            target: reference(r),
            kind: "VALUE" as const,
          })),
        ];
        if (new Set(values.map((d) => d.target)).size !== values.length)
          fail("duplicate-declared-reference");
        return values;
      };
      for (const declaration of result.declarations) {
        let target: string;
        if (declaration.action === "ADD") {
          if (!item!.core || !request.createWithin.includes(item!.core))
            fail("no-core-creation-authority");
          target = request.newUnits[allocated++] ?? fail("unit-capacity");
          const selected = declaration.meaning;
          const meaning: WireMeaning =
            selected.kind === "relation"
              ? { ...selected, targets: selected.targets.map(reference) }
              : selected.kind === "annotation"
                ? { ...selected, target: reference(selected.target) }
                : selected;
          const fieldBasis =
            "fieldBasis" in declaration ? declaration.fieldBasis : undefined;
          const grounding = fieldBasis
            ? uniqueBasis(fieldBasis.map((f) => f.basis))
            : "basis" in declaration
              ? declaration.basis
              : fail("evidence");
          evidence.push(grounding);
          operations.push({
            type: "put",
            id: target,
            coreId: item!.core!,
            meaning,
            dependencies: dependencies(
              declaration.about,
              declaration.usesValue,
            ),
            basis: grounding,
            ...(fieldBasis ? { fieldBasis } : {}),
          });
        } else {
          target = captured(declaration.unit);
          if (declaration.action === "AMEND") {
            if (
              new Set(declaration.changes.map((c) => c.field)).size !==
              declaration.changes.length
            )
              fail("duplicate-amendment-field");
            for (const change of declaration.changes) {
              const { basis: grounding, ...value } = change;
              evidence.push(grounding);
              operations.push({
                type: "revise",
                id: target,
                change:
                  value.field === "targets"
                    ? { ...value, value: value.value.map(reference) }
                    : value.field === "target"
                      ? { ...value, value: reference(value.value) }
                      : value,
                basis: grounding,
              });
            }
          } else if (declaration.action === "CONNECT") {
            evidence.push(declaration.basis);
            operations.push({
              type: "revise",
              id: target,
              change: {
                field: "dependencies",
                value: dependencies(declaration.about, declaration.usesValue),
              },
              basis: declaration.basis,
            });
          } else if (
            declaration.action === "REVALIDATE" ||
            declaration.action === "INVALIDATE"
          ) {
            evidence.push(declaration.basis);
            operations.push({
              type:
                declaration.action === "REVALIDATE"
                  ? "revalidate"
                  : "invalidate",
              id: target,
              basis: declaration.basis,
            });
          } else if (declaration.action === "CONFIRM")
            evidence.push(declaration.basis);
        }
        local.push(target);
        if (declaration.action !== "INVALIDATE" && !targets.includes(target))
          targets.push(target);
      }
      if (operations.length > 24) fail("operation-capacity");
      if (
        item!.kind === "OBLIGATION" &&
        (!targets.length || targets.length > 8)
      )
        fail("resolution-target-capacity");
      if (item!.kind === "RECONCILIATION" && referents.length)
        fail("unexpected-referents");
      return {
        item: result.item,
        outcome: "RESOLVED" as const,
        ...(item!.kind === "RECONCILIATION"
          ? { reviewBasis: uniqueBasis(evidence) }
          : {}),
        operations: operations as Extract<
          StageReview["results"][number],
          { outcome: "RESOLVED" }
        >["operations"],
        resolution:
          item!.kind === "OBLIGATION"
            ? { targets, referents, basis: uniqueBasis(evidence) }
            : null,
      };
    }),
  };
}
