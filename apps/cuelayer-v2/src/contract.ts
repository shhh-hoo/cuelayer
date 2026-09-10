import { z } from "zod";

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
const ref = z
  .object({ evidenceId: z.string(), quote: z.string().min(1) })
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
  })
  .strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export type Grounding = z.infer<typeof ref>;
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
export const proposalSchema = z
  .object({
    version: z.literal("v2-proposal-1"),
    taskId: z.string(),
    complete: z.literal(true),
    operations: z.array(operationSchema).max(24),
    dispositions: z.array(
      z
        .object({
          evidenceId: z.string(),
          status: z.enum(["established", "no-change", "unresolved"]),
        })
        .strict(),
    ),
    unresolved: z.array(
      z
        .object({
          evidenceId: z.string(),
          phrase: z.string().min(1),
          coreId: z.string().nullable(),
        })
        .strict(),
    ),
    resolve: z.array(z.string()),
    attention: z
      .object({
        targets: z.array(z.string()),
        mode: z.enum(["FOCUS", "COMPARE", "WIDEN"]),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;
export type Dependencies = Record<string, number>;
export type Task = {
  id: string;
  lane: "Live" | "Stage";
  evidence: Evidence[];
  // Read-only original sources of bounded unresolved context; never new consumption.
  contextEvidence?: Evidence[];
  omittedObligations?: number;
  dependencies: Dependencies;
  state: TeachingState;
  obligations: Obligation[];
  createdAt: number;
  attentionEpoch: number;
  allowedCores: string[];
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
};
export type Event = {
  schema: "cuelayer-v2-event-1";
  sessionId: string;
  id: string;
  sequence: number;
  at: number;
} & (
  | { type: "evidence"; evidence: Evidence }
  | { type: "accepted"; accepted: Accepted }
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
    event.schema !== "cuelayer-v2-event-1" ||
    event.sequence !== replay.sequence + 1 ||
    replay.ended
  )
    throw new Error("invalid-event-prefix");
  const next = { ...replay, sequence: event.sequence };
  if (event.type === "evidence") {
    const evidence = evidenceSchema.parse(event.evidence);
    if (
      evidence.sequence !== replay.evidence.length + 1 ||
      replay.evidence.some((e) => e.id === evidence.id)
    )
      throw new Error("invalid-evidence-order");
    next.evidence = [...replay.evidence, evidence];
  } else if (event.type === "accepted") {
    const a = event.accepted;
    if (replay.acceptedTaskIds.includes(a.taskId))
      throw new Error("duplicate-acceptance");
    next.state = reduceOperations(replay.state, a.operations);
    next.consumed = { ...replay.consumed };
    next.unresolved = { ...replay.unresolved };
    for (const d of a.dispositions) {
      if (next.consumed[d.evidenceId]) throw new Error("duplicate-consumption");
      next.consumed[d.evidenceId] = d;
    }
    for (const o of a.unresolved) next.unresolved[o.id] = o;
    for (const id of a.resolved) delete next.unresolved[id];
    next.reviewed = [...new Set([...replay.reviewed, ...a.reviewed])];
    next.acceptedTaskIds = [...replay.acceptedTaskIds, a.taskId];
  } else {
    if (replay.evidence.some((e) => !replay.consumed[e.id]))
      throw new Error("undrained-session");
    next.ended = true;
  }
  return next;
}
