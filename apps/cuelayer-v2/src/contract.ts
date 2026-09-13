import { semanticIndex, indexSemanticTransition } from "./semantic-index";
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
export const meaningSchema = z.discriminatedUnion("kind", [
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
const meaning = meaningSchema;
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
  links?: BoundDependency[];
  declaredDependencies?: Dependency[];
  changedAt?: number;
  fieldBasis?: Record<string, Grounding[]>;
  reviewRequired?: boolean;
};
export type Dependency = { target: string; kind: "IDENTITY" | "VALUE" };
export type BoundDependency = Dependency & { version: number };
export type Core = {
  id: string;
  title?: string; // Historical event-1/2 only. New Core semantics use a topic label.
  label?: string;
  labelBasis?: Grounding[];
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
export type LegacyOperation = z.infer<typeof operationSchema>;
export type Operation =
  | LegacyOperation
  | { type: "core"; id: string; label: string; basis: Grounding[] }
  | { type: "setCoreLabel"; id: string; label: string; basis: Grounding[] }
  | {
      type: "put";
      id: string;
      coreId: string;
      meaning: Meaning;
      requires: string[];
      dependencies: Dependency[];
      basis: Grounding[];
    }
  | {
      type: "revise";
      id: string;
      change: { field: string; value: unknown };
      basis: Grounding[];
    }
  | { type: "revalidate"; id: string; basis: Grounding[] };
/** Historical/synthetic fixture shape only. New provider contracts live in live-wire.ts and stage.ts. */
export type LegacyProposal = {
  version: "v2-proposal-1";
  taskId: string;
  complete: true;
  operations: LegacyOperation[];
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
  writeScope?: WriteScope;
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
  operationBatches?: number[];
  dispositions: Disposition[];
  unresolved: Obligation[];
  resolved: string[];
  resolutions?: Resolution[];
  context?: InspectionContext;
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
  schema: "cuelayer-v2-event-1" | "cuelayer-v2-event-2" | "cuelayer-v2-event-3";
  sessionId: string;
  id: string;
  sequence: number;
  at: number;
} & (
  | { type: "evidence"; evidence: Evidence }
  | { type: "accepted"; accepted: Accepted }
  | {
      type: "inspected";
      taskId?: string;
      context?: InspectionContext;
      inspectionKey: string;
      outcome: "WAIT_MORE_INPUT" | "OUTPUT_CAPACITY";
    }
  | { type: "live-attempt"; inspectionKey: string; attempt: LiveAttempt }
  | { type: "capture-closed"; generation: number }
  | { type: "ended" }
);
export type LiveAttempt = {
  id: string;
  outcome: "STARTED" | "FAILED" | "SUCCEEDED";
  reason: string | null;
  manual: boolean;
  category?: "transport" | "semantic" | "stale" | "interrupted" | null;
};
export type ContextRequest = {
  query: string;
  purpose: "READ" | "MODIFY";
  after: string | null;
};
export type InspectionContext = {
  anchor: SourceRange;
  following?: SourceRange;
  query?: ContextRequest;
  results?: string[];
  pageAfter?: string | null;
};
export type WriteScope = {
  units: string[];
  createIn: string[];
  labels: string[];
  mainline: boolean;
  cue: boolean;
};
export type Resolution = {
  obligation: string;
  targets: string[];
  // Stage v4 explicitly records the model-selected accepted antecedents.
  // Older accepted events and Live resolutions remain replay-compatible.
  referents?: string[];
  basis: Grounding[];
};
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
  attempts: Record<string, LiveAttempt>;
  inspectionContexts: Record<string, InspectionContext>;
  eventVersion: 1 | 2 | 3 | null;
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
  attempts: {},
  inspectionContexts: {},
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
  ops: LegacyOperation[],
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
// Preserve the validated group/item boundaries in one atomic accepted event.
// Invalidation and revalidation may each change a dependency version.
function reduceAcceptedOperations(state: TeachingState, accepted: Accepted) {
  const batches = accepted.operationBatches ?? [accepted.operations.length];
  if (
    batches.some((n) => !Number.isInteger(n) || n < 0) ||
    batches.reduce((a, b) => a + b, 0) !== accepted.operations.length
  )
    throw new Error("invalid-operation-batches");
  let offset = 0;
  for (const count of batches) {
    state = reduceSemanticOperations(
      state,
      accepted.operations.slice(offset, offset + count),
    );
    offset += count;
  }
  return state;
}
export function fold(replay: Replay, event: Event): Replay {
  if (
    ![
      "cuelayer-v2-event-1",
      "cuelayer-v2-event-2",
      "cuelayer-v2-event-3",
    ].includes(event.schema) ||
    event.sequence !== replay.sequence + 1 ||
    replay.ended
  )
    throw new Error("invalid-event-prefix");
  const ev =
    event.schema === "cuelayer-v2-event-1"
      ? 1
      : event.schema === "cuelayer-v2-event-2"
        ? 2
        : 3;
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
        ? reduceOperations(replay.state, a.operations as LegacyOperation[])
        : ev === 2
          ? reduceLegacySemanticOperations(
              replay.state,
              a.operations as LegacyOperation[],
            )
          : reduceAcceptedOperations(replay.state, a);
    if (ev === 3 && a.lane === "Live" && a.processing) {
      const key = a.processing.inspectionKey,
        prior = replay.attempts[key];
      if (prior?.id === a.taskId)
        next.attempts = {
          ...replay.attempts,
          [key]: {
            ...prior,
            outcome: "SUCCEEDED",
            reason: null,
            category: null,
          },
        };
    }
    if (ev === 3 && a.context && a.processing)
      next.inspectionContexts = {
        ...replay.inspectionContexts,
        [a.processing.inspectionKey]: a.context,
      };
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
    } else if (ev >= 2 && a.lane === "Live")
      throw new Error("missing-processing-event");
  } else if (event.type === "inspected") {
    if (ev < 2) throw new Error("invalid-inspection-version");
    next.inspections = {
      ...replay.inspections,
      [event.inspectionKey]: event.outcome,
    };
    if (event.context)
      next.inspectionContexts = {
        ...replay.inspectionContexts,
        [event.inspectionKey]: event.context,
      };
    const prior = replay.attempts[event.inspectionKey];
    if (prior?.id === event.taskId)
      next.attempts = {
        ...replay.attempts,
        [event.inspectionKey]: {
          ...prior,
          outcome: "SUCCEEDED",
          reason: null,
          category: null,
        },
      };
  } else if (event.type === "live-attempt") {
    if (ev !== 3) throw new Error("invalid-attempt-version");
    const old = replay.attempts[event.inspectionKey];
    if (event.attempt.outcome !== "STARTED" && old?.id !== event.attempt.id)
      throw new Error("unbound-attempt-outcome");
    if (
      event.attempt.outcome === "STARTED" &&
      old?.outcome === "STARTED" &&
      old.manual
    )
      throw new Error("retry-already-consumed");
    next.attempts = {
      ...replay.attempts,
      [event.inspectionKey]: event.attempt,
    };
  } else if (event.type === "capture-closed") {
    if (
      ev < 2 ||
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
  indexSemanticTransition(replay.state, next.state);
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
        {
          ...(c.label === undefined ? { title: c.title } : { label: c.label }),
          unitIds: c.unitIds,
        },
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
          ...(u.links
            ? { links: u.links, reviewRequired: u.reviewRequired ?? false }
            : {}),
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
function reduceLegacySemanticOperations(
  state: TeachingState,
  ops: LegacyOperation[],
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

export function isCurrent(
  state: TeachingState,
  id: string,
  seen = new Set<string>(),
): boolean {
  const u = state.units[id];
  if (!u?.valid || u.reviewRequired) return false;
  if (seen.has(id)) return true;
  seen.add(id);
  return (u.links ?? []).every(
    (d) =>
      state.units[d.target]?.valid &&
      (d.kind === "IDENTITY" ||
        (state.units[d.target].version === d.version &&
          isCurrent(state, d.target, seen))),
  );
}
const fields: Record<Meaning["kind"], string[]> = {
  statement: ["text"],
  quantity: ["expression", "symbols", "conditions", "independent", "domain"],
  reaction: ["notation", "conditions"],
  relation: ["targets", "relation", "text"],
  annotation: ["target", "text"],
};
function linked(
  state: TeachingState,
  meaning: Meaning,
  dependencies: Dependency[],
): BoundDependency[] {
  const refs =
    meaning.kind === "relation"
      ? meaning.targets
      : meaning.kind === "annotation"
        ? [meaning.target]
        : [];
  const all = new Map<string, Dependency>(
    refs.map((target) => [target, { target, kind: "IDENTITY" }]),
  );
  for (const d of dependencies) all.set(d.target, d);
  return [...all.values()].map((d) => {
    if (!state.units[d.target]?.valid)
      throw new Error("invalid-semantic-dependency");
    return { ...d, version: state.units[d.target].version };
  });
}
function activeBasis(u: Unit) {
  return [
    ...new Map(
      Object.values(u.fieldBasis ?? {})
        .flat()
        .map((b) => [JSON.stringify(b), b]),
    ).values(),
  ];
}
/** Event-3 semantics. Legacy reducers above retain their original event interpretation. */
export function reduceSemanticOperations(
  state: TeachingState,
  ops: Operation[],
): TeachingState {
  const next = structuredClone(state);
  let changed = false;
  for (const op of ops) {
    if (op.type === "core") {
      if (!("label" in op)) throw new Error("new-core-requires-topic-label");
      if (next.cores[op.id]) throw new Error("core-identity-exists");
      next.cores[op.id] = {
        id: op.id,
        label: op.label,
        labelBasis: op.basis,
        version: 1,
        membership: 0,
        unitIds: [],
      };
    } else if (op.type === "setCoreLabel") {
      const core = next.cores[op.id];
      if (!core) throw new Error("missing-core");
      if (core.label === op.label) continue;
      core.label = op.label;
      core.labelBasis = op.basis;
      core.version++;
    } else if (op.type === "put") {
      if (next.units[op.id]) throw new Error("revise-required");
      const core = next.cores[op.coreId];
      if (!core) throw new Error("invalid-core-binding");
      const dependencies =
        "dependencies" in op
          ? op.dependencies
          : op.requires.map((target) => ({
              target,
              kind: "IDENTITY" as const,
            }));
      const links = linked(next, op.meaning, dependencies);
      const fieldBasis = Object.fromEntries(
        [
          ...Object.keys(op.meaning).filter((k) => k !== "kind"),
          "dependencies",
        ].map((k) => [k, op.basis]),
      );
      next.units[op.id] = {
        id: op.id,
        coreId: op.coreId,
        version: 1,
        valid: true,
        changedAt: state.revision + 1,
        meaning: op.meaning,
        basis: op.basis,
        requires: links.map((d) => d.target),
        links,
        declaredDependencies: dependencies,
        fieldBasis,
        reviewRequired: false,
      };
      core.unitIds.push(op.id);
      core.membership++;
    } else if (op.type === "revise" || op.type === "revalidate") {
      const u = next.units[op.id];
      if (!u?.valid) throw new Error("missing-current-unit");
      const field = op.type === "revalidate" ? "dependencies" : op.change.field;
      if (field !== "dependencies" && !fields[u.meaning.kind].includes(field))
        throw new Error("invalid-revision-field");
      if (field === "dependencies") {
        const deps =
          op.type === "revalidate"
            ? (u.declaredDependencies ??
              (u.links ?? []).map(({ target, kind }) => ({ target, kind })))
            : (op.change.value as Dependency[]);
        const links = linked(next, u.meaning, deps);
        if (semanticEqual(links, u.links) && !u.reviewRequired) continue;
        u.links = links;
        u.declaredDependencies = deps;
        u.requires = links.map((d) => d.target);
      } else if (op.type === "revise") {
        const m = { ...u.meaning } as Record<string, unknown>;
        if (
          op.change.value === null &&
          ["independent", "domain"].includes(field)
        )
          delete m[field];
        else m[field] = op.change.value;
        const result = meaningSchema.parse(m);
        if (semanticEqual(result, u.meaning)) continue;
        u.meaning = result;
        if (["target", "targets"].includes(field)) {
          u.links = linked(next, result, u.declaredDependencies ?? []);
          u.requires = u.links.map((d) => d.target);
        }
      }
      u.fieldBasis = { ...(u.fieldBasis ?? {}), [field]: op.basis };
      u.basis = activeBasis(u);
      u.changedAt = state.revision + 1;
      u.version++;
      u.reviewRequired = false;
    } else if (op.type === "invalidate") {
      const u = next.units[op.id];
      if (!u) throw new Error("missing-unit");
      if (!u.valid) continue;
      u.valid = false;
      u.version++;
    } else if (op.type === "mainline") {
      if (!next.cores[op.coreId]) throw new Error("missing-mainline");
      if (next.currentCoreId === op.coreId) continue;
      next.currentCoreId = op.coreId;
      next.mainlineVersion++;
    } else {
      if (
        semanticEqual(
          next.cue && { text: next.cue.text, targets: next.cue.targets },
          op.value && { text: op.value.text, targets: op.value.targets },
        )
      )
        continue;
      next.cue = op.value;
      next.cueVersion++;
    }
    changed = true;
  }
  // Impact is host-owned. Use the reverse index even for targets outside this capture.
  const index = semanticIndex(next);
  const queue = Object.values(next.units)
    .filter((u) => u.version !== state.units[u.id]?.version)
    .map((u) => u.id);
  for (let at = 0; at < queue.length; at++) {
    const target = queue[at];
    for (const id of index.reverse.get(target) ?? []) {
      const u = next.units[id];
      if (
        u.valid &&
        !u.reviewRequired &&
        (u.links ?? []).some(
          (d) =>
            !next.units[d.target]?.valid ||
            (d.kind === "VALUE" &&
              (next.units[d.target].version !== d.version ||
                next.units[d.target].reviewRequired)),
        )
      ) {
        u.reviewRequired = true;
        u.version++;
        changed = true;
        queue.push(id);
      }
    }
  }
  if (changed) next.revision = state.revision + 1;
  return next;
}
