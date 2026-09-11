import {
  reduceSemanticOperations,
  semanticValue,
  semanticEqual,
  same,
  version,
  type Accepted,
  type Expression,
  type Meaning,
  type Operation,
  type Replay,
  type Task,
  type TeachingState,
  type Grounding,
} from "./contract";
import {
  liveDecisionSchema,
  compileMeaning,
  type WireOperation,
} from "./live-wire";
import { aliasLookup, expandBasis } from "./projection";
import {
  position,
  sourcePieces,
  readable,
  rangeSize,
  type SourceRange,
} from "./source";
export class Rejection extends Error {}
export const requireThat = (condition: unknown, reason: string): void => {
  if (!condition) throw new Rejection(reason);
};
export function validateMeaning(m: Meaning) {
  if (m.kind !== "quantity") return;
  const walk = (e: Expression): void => {
    if (typeof e === "number") return;
    if (typeof e === "string") {
      requireThat(Boolean(m.symbols[e]), "missing-symbol-binding");
      return;
    }
    const [op, ...args] = e;
    requireThat(args.length === (op === "Sin" ? 1 : 2), "missing-operand");
    args.forEach(walk);
  };
  walk(m.expression);
  requireThat(
    Array.isArray(m.expression) && m.expression[0] === "Equal",
    "missing-quantitative-relation",
  );
  if (m.domain)
    requireThat(
      m.domain[0] < m.domain[1] && m.independent && m.symbols[m.independent],
      "invalid-domain",
    );
}

export function validateDependencies(replay: Replay, task: Task) {
  requireThat(!replay.ended, "session-ended");
  requireThat(task.capture && task.inspectionKey, "missing-task-capture");
  requireThat(task.generation === replay.generation, "stale-generation");
  for (const [key, v] of Object.entries(task.dependencies))
    requireThat(version(replay.state, key) === v, `stale-dependency:${key}`);
  for (const [id, v] of Object.entries(task.capture!.obligationVersions))
    requireThat(
      replay.unresolved[id]?.version === v,
      `stale-dependency:obligation/${id}`,
    );
  for (const e of task.evidence)
    requireThat(
      replay.evidence.some((current) => same(current, e)),
      "uncommitted-evidence",
    );
}
export function expandOperations(
  replay: Replay,
  task: Task,
  wire: WireOperation[],
  group?: SourceRange,
): Operation[] {
  const c = (task.review ?? task.capture)!;
  const core = (a: string) => aliasLookup(c.cores, a),
    unit = (a: string) => aliasLookup(c.units, a);
  const basis = (refs: WireOperation["basis"]): Grounding[] =>
    refs.flatMap((ref) => {
      const range = c.sources[ref.source];
      requireThat(range, "unknown-or-cross-task-source-alias");
      const expanded = expandBasis(
        replay.evidence,
        range,
        ref.quote,
        ref.source === task.capture?.request.source.source ? group : undefined,
      );
      if (group && ref.source === task.capture?.request.source.source)
        for (const r of expanded)
          requireThat(
            position(replay.evidence, r.range.start) >=
              position(replay.evidence, group.start) &&
              position(replay.evidence, r.range.end) <=
                position(replay.evidence, group.end),
            "grounding-outside-processing-group",
          );
      return expanded;
    });
  return wire.map((op) => {
    const grounded = basis(op.basis);
    if (group)
      requireThat(
        grounded.some(
          (g) =>
            g.range &&
            position(replay.evidence, g.range.start) <
              position(replay.evidence, group.end) &&
            position(replay.evidence, g.range.end) >
              position(replay.evidence, group.start),
        ),
        "missing-current-source-grounding",
      );
    if (op.type === "core") {
      requireThat(
        task.capture?.request.newCores.includes(op.id),
        "unissued-core-identity",
      );
      return { ...op, id: core(op.id), basis: grounded };
    }
    if (op.type === "put")
      return {
        ...op,
        id: unit(op.id),
        coreId: core(op.coreId),
        meaning: compileMeaning(op.meaning, unit),
        requires: op.requires.map(unit),
        basis: grounded,
      };
    if (op.type === "invalidate")
      return { ...op, id: unit(op.id), basis: grounded };
    if (op.type === "mainline")
      return { ...op, coreId: core(op.coreId), basis: grounded };
    return {
      ...op,
      value: op.value
        ? {
            ...op.value,
            targets: op.value.targets.map(unit),
            basis: basis(op.value.basis),
          }
        : null,
      basis: grounded,
    };
  });
}
export function validateOperations(
  state: TeachingState,
  task: Task,
  ops: Operation[],
) {
  const created = new Set<string>(),
    proposed = new Set(
      ops.filter((op) => op.type === "put").map((op) => op.id),
    );
  for (const op of ops) {
    if (op.type === "core") {
      requireThat(task.lane === "Live", "stage-cannot-create-core");
      created.add(op.id);
    }
    if (op.type === "put") {
      requireThat(
        created.has(op.coreId) || task.allowedCores.includes(op.coreId),
        "write-scope",
      );
      if (state.units[op.id])
        requireThat(
          Object.hasOwn(task.dependencies, `unit/${op.id}`),
          "uncaptured-write",
        );
      validateMeaning(op.meaning);
      const refs = [
        ...op.requires,
        ...(op.meaning.kind === "relation"
          ? op.meaning.targets
          : op.meaning.kind === "annotation"
            ? [op.meaning.target]
            : []),
      ];
      for (const id of refs)
        requireThat(
          proposed.has(id) ||
            (task.state.units[id] &&
              Object.hasOwn(task.dependencies, `unit/${id}`)),
          "uncaptured-semantic-dependency",
        );
    }
    if (op.type === "invalidate")
      requireThat(
        Object.hasOwn(task.dependencies, `unit/${op.id}`),
        "uncaptured-write",
      );
    if (op.type === "mainline")
      requireThat(
        task.lane === "Live" && Object.hasOwn(task.dependencies, "mainline"),
        "uncaptured-mainline",
      );
    if (op.type === "cue")
      requireThat(
        task.lane === "Live" && Object.hasOwn(task.dependencies, "cue"),
        "uncaptured-cue",
      );
  }
  const next = reduceSemanticOperations(state, ops);
  for (const u of Object.values(next.units).filter((u) => u.valid))
    for (const id of [
      ...u.requires,
      ...(u.meaning.kind === "relation"
        ? u.meaning.targets
        : u.meaning.kind === "annotation"
          ? [u.meaning.target]
          : []),
    ])
      requireThat(next.units[id]?.valid, "invalid-semantic-dependency");
  for (const id of next.cue?.targets ?? [])
    requireThat(next.units[id]?.valid, "invalid-cue-target");
  return next;
}
export function validate(replay: Replay, task: Task, raw: unknown) {
  const parsed = liveDecisionSchema.safeParse(raw);
  requireThat(parsed.success, "incomplete-or-malformed-live-decision");
  requireThat(task.lane === "Live", "wrong-lane-contract");
  validateDependencies(replay, task);
  const p = parsed.data!,
    c = task.capture!;
  requireThat(p.scope === c.namespace, "task-binding");
  requireThat(
    position(replay.evidence, replay.accounted) ===
      position(replay.evidence, c.range.start),
    "noncontiguous-accounting",
  );
  let start = c.range.start,
    state = replay.state;
  const operations: Operation[] = [],
    unresolved: Accepted["unresolved"] = [],
    resolved: string[] = [],
    groups: NonNullable<Accepted["processing"]>["groups"] = [];
  for (const [i, g] of p.groups.entries()) {
    const end = c.boundaries[g.throughBoundary];
    requireThat(end, "unknown-or-cross-task-alias");
    const range = { start, end };
    requireThat(
      rangeSize(replay.evidence, range) > 0,
      "noncontiguous-accounting",
    );
    const ops = expandOperations(replay, task, g.operations, range);
    const localUnits = Object.fromEntries(
      Object.entries(state.units).filter(([id]) => !replay.state.units[id]),
    );
    const localCores = Object.keys(state.cores).filter(
      (id) => !replay.state.cores[id],
    );
    const groupTask = {
      ...task,
      state: { ...task.state, units: { ...task.state.units, ...localUnits } },
      allowedCores: [...task.allowedCores, ...localCores],
      dependencies: {
        ...task.dependencies,
        ...Object.fromEntries(
          Object.keys(localUnits).map((id) => [`unit/${id}`, 0]),
        ),
      },
    };
    const next = validateOperations(state, groupTask, ops),
      changed = !semanticEqual(semanticValue(state), semanticValue(next));
    requireThat(
      (g.outcome === "APPLY") === changed,
      "semantic-no-op-or-change-disposition-mismatch",
    );
    if (g.outcome !== "APPLY") requireThat(!ops.length, "non-apply-operations");
    requireThat(
      (g.outcome === "CARRY") === Boolean(g.carry),
      "carry-disposition-mismatch",
    );
    if (g.carry) {
      requireThat(
        readable(replay.evidence, range).includes(g.carry.phrase),
        "ungrounded-carry",
      );
      const coreId = g.carry.core ? aliasLookup(c.cores, g.carry.core) : null;
      requireThat(!coreId || next.cores[coreId], "unknown-obligation-core");
      unresolved.push({
        id: `obligation:${task.id}:${i}`,
        range,
        kind: g.carry.kind,
        version: 1,
        evidenceIds: sourcePieces(replay.evidence, range).map(
          (p) => p.evidenceId,
        ),
        phrase: g.carry.phrase,
        coreId,
        createdAt: Date.now(),
      });
    }
    for (const alias of g.resolutions) {
      const id = aliasLookup(c.obligations, alias);
      requireThat(
        !resolved.includes(id) && replay.unresolved[id],
        "unbound-resolution",
      );
      requireThat(
        g.outcome === "APPLY" &&
          ops.some((op) =>
            op.basis.some(
              (b) =>
                b.range &&
                replay.unresolved[id].range &&
                position(replay.evidence, b.range.start) <
                  position(replay.evidence, replay.unresolved[id].range!.end) &&
                position(replay.evidence, b.range.end) >
                  position(replay.evidence, replay.unresolved[id].range!.start),
            ),
          ),
        "ungrounded-resolution",
      );
      resolved.push(id);
    }
    operations.push(...ops);
    groups.push({ range, outcome: g.outcome });
    state = next;
    start = end;
  }
  const atEnd =
    position(replay.evidence, start) === position(replay.evidence, c.range.end);
  requireThat(
    p.suffixStatus === "NONE" ? atEnd : !atEnd,
    "invalid-suffix-status",
  );
  if (!groups.length)
    requireThat(
      !p.attentionCandidate && !p.reviewRequests.length,
      "wait-cannot-publish",
    );
  const reviewRequests = p.reviewRequests.map((r, i) => {
    const coreId = aliasLookup(c.cores, r.core);
    requireThat(state.cores[coreId], "invalid-review-core");
    return {
      id: `review:${task.id}:${i}`,
      version: 1,
      range: { start: c.range.start, end: start },
      coreId,
      purpose: r.purpose,
      createdAt: Date.now(),
    };
  });
  const attention = p.attentionCandidate
    ? {
        ...p.attentionCandidate,
        targets: p.attentionCandidate.targets.map((a) =>
          aliasLookup(c.units, a),
        ),
      }
    : null;
  for (const id of attention?.targets ?? [])
    requireThat(state.units[id]?.valid, "invalid-attention");
  const accepted: Accepted = {
    taskId: task.id,
    lane: "Live",
    dependencies: task.dependencies,
    operations,
    dispositions: [],
    unresolved,
    resolved,
    reviewed: [],
    reviewRequests,
    processing: {
      version: "v2-source-processing-1",
      groups,
      suffixStatus: p.suffixStatus,
      inspectionKey: task.inspectionKey!,
    },
  };
  return { proposal: { attention, operations }, accepted, decision: p };
}
