import { z } from "zod";
import {
  ORIGIN,
  recorded,
  indexAppend,
  position,
  sourcePieces,
  type SourceCursor,
  type SourceRange,
} from "./source";
import type { LiveCapture } from "./projection";
import type { StageCapture, ReviewConcern } from "./stage";
import type { CarryKind } from "./live-wire";
export type { SourceCursor, SourceRange } from "./source";

export type Expression = string | number | [string, ...Expression[]];
const expression: z.ZodType<Expression> = z.lazy(() =>
  z.union([
    z.string().min(1),
    z.number().finite(),
    z
      .tuple([z.enum(["Equal", "Multiply", "Divide", "Add", "Sin"])])
      .rest(expression),
  ]),
);
const cursorSchema = z
  .object({
    evidenceId: z.string().nullable(),
    sequence: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
  })
  .strict();
const ref = z
  .object({
    evidenceId: z.string(),
    quote: z.string().min(1),
    range: z
      .object({ start: cursorSchema, end: cursorSchema })
      .strict()
      .optional(),
  })
  .strict();
const meaning = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("statement"), text: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("quantity"),
      expression,
      symbols: z.record(
        z.string(),
        z.object({ label: z.string(), unit: z.string() }).strict(),
      ),
      conditions: z.array(z.string()),
      independent: z.string().optional(),
      domain: z.tuple([z.number(), z.number()]).optional(),
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
      targets: z.array(z.string()).min(2),
      relation: z.enum(["comparison", "dependency"]),
      text: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("annotation"),
      target: z.string(),
      text: z.string().min(1),
    })
    .strict(),
]);
export type Meaning = z.infer<typeof meaning>;
export const evidenceSchema = z
  .object({
    id: z.string(),
    run: z.string(),
    source: z.string(),
    text: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    receivedAt: z.number(),
    audioObservedAt: z.number().nullable(),
    sequence: z.number().int().positive(),
    stability: z.literal("COMMITTED"),
    alignment: z
      .object({
        version: z.literal("speechmatics-words-1"),
        boundaries: z.array(z.number().int().nonnegative()),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export type Grounding = z.infer<typeof ref> & { range?: SourceRange };
export type Unit = {
  id: string;
  coreId: string;
  version: number;
  valid: boolean;
  meaning: Meaning;
  basis: Grounding[];
  requires: string[];
};
export type Core = {
  id: string;
  title: string;
  version: number;
  membership: number;
  unitIds: string[];
};
export type Cue = {
  text: string;
  targets: string[];
  origin: "TEACHER";
  basis: Grounding[];
};
export type TeachingState = {
  revision: number;
  cores: Record<string, Core>;
  units: Record<string, Unit>;
  currentCoreId: string | null;
  mainlineVersion: number;
  cue: Cue | null;
  cueVersion: number;
};
export type Obligation = {
  id: string;
  evidenceIds: string[];
  phrase: string;
  coreId: string | null;
  createdAt: number;
  version?: number;
  kind?: CarryKind | "LEGACY_UNSPECIFIED";
  range?: SourceRange;
};
export type Disposition = {
  evidenceId: string;
  status: "established" | "no-change" | "unresolved";
};
export type ProjectionIntent = {
  targets: string[];
  mode: "FOCUS" | "COMPARE" | "WIDEN";
  expiresAt: number;
};
export const operationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("core"),
      id: z.string(),
      title: z.string(),
      basis: z.array(ref).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("put"),
      id: z.string(),
      coreId: z.string(),
      meaning,
      requires: z.array(z.string()),
      basis: z.array(ref).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("invalidate"),
      id: z.string(),
      basis: z.array(ref).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("mainline"),
      coreId: z.string(),
      basis: z.array(ref).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("cue"),
      value: z
        .object({
          text: z.string(),
          targets: z.array(z.string()),
          origin: z.literal("TEACHER"),
          basis: z.array(ref).min(1),
        })
        .nullable(),
      basis: z.array(ref).min(1),
    })
    .strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
/** Historical/synthetic fixture shape only. New provider contracts live in live-wire.ts and stage.ts. */
export type LegacyProposal = {
  version: "v2-proposal-1";
  taskId: string;
  complete: true;
  operations: Operation[];
  dispositions: Disposition[];
  unresolved: { evidenceId: string; phrase: string; coreId: string | null }[];
  resolve: string[];
  attention: { targets: string[]; mode: "FOCUS" | "COMPARE" | "WIDEN" } | null;
};
export type Dependencies = Record<string, number>;
export type Task = {
  id: string;
  lane: "Live" | "Stage";
  evidence: Evidence[];
  dependencies: Dependencies;
  state: TeachingState;
  obligations: Obligation[];
  createdAt: number;
  attentionEpoch: number;
  allowedCores: string[];
  sessionId?: string;
  generation?: number;
  inspectionKey?: string;
  capture?: LiveCapture;
  review?: StageCapture;
};
export type Accepted = {
  taskId: string;
  lane: Task["lane"];
  dependencies: Dependencies;
  operations: Operation[];
  dispositions: Disposition[];
  unresolved: Obligation[];
  resolved: string[];
  reviewed: string[];
  reviewRequests?: ReviewConcern[];
  reviewVersion?: "v2-stage-processing-1";
  reviews?: {
    subjectId: string;
    kind: "OBLIGATION" | "RECONCILIATION";
    version: number;
    key: string;
    range: SourceRange;
    purpose: string;
    outcome: "RESOLVED" | "STILL_OPEN" | "WITHDRAWN";
  }[];
  processing?: {
    version: "v2-source-processing-1";
    groups: { range: SourceRange; outcome: "APPLY" | "NO_CHANGE" | "CARRY" }[];
    suffixStatus: "NONE" | "WAIT_MORE_INPUT" | "OUTPUT_CAPACITY";
    inspectionKey: string;
  };
};
export type Event = {
  schema: "cuelayer-v2-event-1" | "cuelayer-v2-event-2";
  sessionId: string;
  id: string;
  sequence: number;
  at: number;
} & (
  | { type: "evidence"; evidence: Evidence }
  | { type: "accepted"; accepted: Accepted }
  | {
      type: "inspected";
      inspectionKey: string;
      outcome: "WAIT_MORE_INPUT" | "OUTPUT_CAPACITY";
    }
  | { type: "capture-closed"; generation: number }
  | { type: "ended" }
);
export type Replay = {
  state: TeachingState;
  evidence: Evidence[];
  consumed: Record<string, Disposition>;
  unresolved: Record<string, Obligation>;
  reviewed: string[];
  acceptedTaskIds: string[];
  sequence: number;
  ended: boolean;
  recorded: SourceCursor;
  accounted: SourceCursor;
  generation: number;
  captureClosed: boolean;
  inspections: Record<string, string>;
  eventVersion: 1 | 2 | null;
  reviewConcerns: Record<string, ReviewConcern>;
  reviewInspections: Record<string, string>;
};
export const emptyState = (): TeachingState => ({
  revision: 0,
  cores: {},
  units: {},
  currentCoreId: null,
  mainlineVersion: 0,
  cue: null,
  cueVersion: 0,
});
export const emptyReplay = (): Replay => ({
  state: emptyState(),
  evidence: [],
  consumed: {},
  unresolved: {},
  reviewed: [],
  acceptedTaskIds: [],
  sequence: 0,
  ended: false,
  recorded: { ...ORIGIN },
  accounted: { ...ORIGIN },
  generation: 0,
  captureClosed: false,
  inspections: {},
  eventVersion: null,
  reviewConcerns: {},
  reviewInspections: {},
});
export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function version(state: TeachingState, key: string): number {
  if (key === "mainline") return state.mainlineVersion;
  if (key === "cue") return state.cueVersion;
  const [kind, id] = key.split("/");
  if (kind === "core") return state.cores[id]?.version ?? 0;
  if (kind === "members") return state.cores[id]?.membership ?? 0;
  return state.units[id]?.version ?? 0;
}
export function reduceOperations(
  state: TeachingState,
  ops: Operation[],
): TeachingState {
  const next = structuredClone(state);
  let changed = false;
  for (const op of ops) {
    if (op.type !== "mainline" || next.currentCoreId !== op.coreId)
      changed = true;
    if (op.type === "core") {
      if (next.cores[op.id]) throw new Error("core-identity-exists");
      next.cores[op.id] = {
        id: op.id,
        title: op.title,
        version: 1,
        membership: 0,
        unitIds: [],
      };
    } else if (op.type === "put") {
      const core = next.cores[op.coreId],
        old = next.units[op.id];
      if (!core || (old && old.coreId !== op.coreId))
        throw new Error("invalid-core-binding");
      if (!old) {
        core.unitIds.push(op.id);
        core.membership++;
      }
      next.units[op.id] = {
        id: op.id,
        coreId: op.coreId,
        version: (old?.version ?? 0) + 1,
        valid: true,
        meaning: op.meaning,
        basis: op.basis,
        requires: op.requires,
      };
    } else if (op.type === "invalidate") {
      const unit = next.units[op.id];
      if (!unit) throw new Error("missing-unit");
      unit.valid = false;
      unit.version++;
    } else if (op.type === "mainline") {
      if (!next.cores[op.coreId]) throw new Error("missing-mainline");
      if (next.currentCoreId !== op.coreId) {
        next.currentCoreId = op.coreId;
        next.mainlineVersion++;
      }
    } else {
      next.cue = op.value;
      next.cueVersion++;
    }
  }
  if (changed) next.revision++;
  return next;
}
export function fold(replay: Replay, event: Event): Replay {
  if (
    !["cuelayer-v2-event-1", "cuelayer-v2-event-2"].includes(event.schema) ||
    event.sequence !== replay.sequence + 1 ||
    replay.ended
  )
    throw new Error("invalid-event-prefix");
  const ev = event.schema === "cuelayer-v2-event-1" ? 1 : 2;
  if (replay.eventVersion !== null && replay.eventVersion !== ev)
    throw new Error("mixed-event-semantics");
  const next: Replay = {
    ...replay,
    sequence: event.sequence,
    eventVersion: ev,
  };
  if (event.type === "evidence") {
    const evidence = evidenceSchema.parse(event.evidence);
    if (
      evidence.sequence !== replay.evidence.length + 1 ||
      replay.evidence.some((e) => e.id === evidence.id)
    )
      throw new Error("invalid-evidence-order");
    if (replay.captureClosed) throw new Error("capture-closed");
    next.evidence = [...replay.evidence, evidence];
    indexAppend(replay.evidence, next.evidence);
    next.recorded = recorded(next.evidence);
  } else if (event.type === "accepted") {
    const a = event.accepted;
    if (replay.acceptedTaskIds.includes(a.taskId))
      throw new Error("duplicate-acceptance");
    next.state =
      ev === 1
        ? reduceOperations(replay.state, a.operations)
        : reduceSemanticOperations(replay.state, a.operations);
    next.consumed = { ...replay.consumed };
    next.unresolved = { ...replay.unresolved };
    for (const d of a.dispositions) {
      if (next.consumed[d.evidenceId]) throw new Error("duplicate-consumption");
      next.consumed[d.evidenceId] = d;
    }
    for (const o of a.unresolved) {
      if (next.unresolved[o.id]) throw new Error("duplicate-obligation");
      next.unresolved[o.id] =
        ev === 1 ? { ...o, kind: "LEGACY_UNSPECIFIED", version: 1 } : o;
    }
    for (const id of a.resolved) delete next.unresolved[id];
    next.reviewConcerns = { ...replay.reviewConcerns };
    next.reviewInspections = { ...replay.reviewInspections };
    for (const request of a.reviewRequests ?? []) {
      if (next.reviewConcerns[request.id])
        throw new Error("duplicate-review-concern");
      next.reviewConcerns[request.id] = request;
    }
    for (const review of a.reviews ?? []) {
      if (
        a.lane !== "Stage" ||
        a.reviewVersion !== "v2-stage-processing-1" ||
        a.processing ||
        a.dispositions.length
      )
        throw new Error("stage-reconsumption");
      next.reviewInspections[review.key] = review.outcome;
      if (review.kind === "RECONCILIATION" && review.outcome !== "STILL_OPEN")
        delete next.reviewConcerns[review.subjectId];
    }
    next.reviewed = [...new Set([...replay.reviewed, ...a.reviewed])];
    next.acceptedTaskIds = [...replay.acceptedTaskIds, a.taskId];
    if (ev === 1) {
      const prefix = next.evidence.slice(
        0,
        next.evidence.findIndex((e) => !next.consumed[e.id]) < 0
          ? next.evidence.length
          : next.evidence.findIndex((e) => !next.consumed[e.id]),
      );
      next.accounted = recorded(prefix);
    } else if (a.processing) {
      if (
        a.lane !== "Live" ||
        a.processing.version !== "v2-source-processing-1" ||
        !a.processing.groups.length ||
        a.dispositions.length
      )
        throw new Error("invalid-processing-event");
      let at = position(next.evidence, next.accounted);
      for (const group of a.processing.groups) {
        const start = position(next.evidence, group.range.start),
          end = position(next.evidence, group.range.end);
        if (
          start !== at ||
          end <= start ||
          end > position(next.evidence, next.recorded)
        )
          throw new Error("noncontiguous-accounting");
        sourcePieces(next.evidence, group.range);
        at = end;
        next.accounted = group.range.end;
      }
      for (const e of next.evidence)
        if (
          position(next.evidence, {
            evidenceId: e.id,
            sequence: e.sequence,
            offset: e.text.length,
          }) <= at &&
          !next.consumed[e.id]
        ) {
          const ranges = a.processing.groups.filter((g) =>
            sourcePieces(next.evidence, g.range).some(
              (p) => p.evidenceId === e.id,
            ),
          );
          next.consumed[e.id] = {
            evidenceId: e.id,
            status: ranges.some((g) => g.outcome === "CARRY")
              ? "unresolved"
              : ranges.some((g) => g.outcome === "APPLY")
                ? "established"
                : "no-change",
          };
        }
    } else if (ev === 2 && a.lane === "Live")
      throw new Error("missing-processing-event");
  } else if (event.type === "inspected") {
    if (ev !== 2) throw new Error("invalid-inspection-version");
    next.inspections = {
      ...replay.inspections,
      [event.inspectionKey]: event.outcome,
    };
  } else if (event.type === "capture-closed") {
    if (
      ev !== 2 ||
      replay.captureClosed ||
      event.generation !== replay.generation + 1
    )
      throw new Error("invalid-capture-close");
    next.captureClosed = true;
    next.generation = event.generation;
  } else {
    if (
      position(replay.evidence, replay.accounted) !==
      position(replay.evidence, replay.recorded)
    )
      throw new Error("undrained-session");
    next.ended = true;
  }
  return next;
}

/** New events do not manufacture semantic change by revising bookkeeping. Legacy reducer stays byte-semantically compatible. */
export function semanticEqual(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : v;
  return same(canonical(a), canonical(b));
}
export function semanticValue(state: TeachingState): unknown {
  return {
    cores: Object.fromEntries(
      Object.entries(state.cores).map(([id, c]) => [
        id,
        { title: c.title, unitIds: c.unitIds },
      ]),
    ),
    units: Object.fromEntries(
      Object.entries(state.units).map(([id, u]) => [
        id,
        {
          coreId: u.coreId,
          valid: u.valid,
          meaning: u.meaning,
          requires: [...u.requires].sort(),
        },
      ]),
    ),
    currentCoreId: state.currentCoreId,
    cue: state.cue
      ? {
          text: state.cue.text,
          targets: state.cue.targets,
          origin: state.cue.origin,
        }
      : null,
  };
}
export function reduceSemanticOperations(
  state: TeachingState,
  ops: Operation[],
): TeachingState {
  let next = state;
  for (const op of ops) {
    const old =
      op.type === "put" || op.type === "invalidate"
        ? next.units[op.id]
        : undefined;
    if (
      op.type === "put" &&
      old?.valid &&
      old.coreId === op.coreId &&
      semanticEqual(old.meaning, op.meaning) &&
      same([...old.requires].sort(), [...op.requires].sort())
    )
      continue;
    if (op.type === "invalidate" && old && !old.valid) continue;
    if (op.type === "mainline" && next.currentCoreId === op.coreId) continue;
    if (
      op.type === "cue" &&
      same(
        next.cue
          ? {
              text: next.cue.text,
              targets: next.cue.targets,
              origin: next.cue.origin,
            }
          : null,
        op.value
          ? {
              text: op.value.text,
              targets: op.value.targets,
              origin: op.value.origin,
            }
          : null,
      )
    )
      continue;
    next = reduceOperations(next, [op]);
  }
  return next === state
    ? structuredClone(state)
    : { ...next, revision: state.revision + 1 };
}
