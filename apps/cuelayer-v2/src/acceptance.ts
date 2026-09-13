import { getSourceSubject, terminalRisk } from "./terminal-review";
import type { ReviewConcern } from "./stage";
import {
  reduceSemanticOperations,
  isCurrent,
  type Resolution,
  type Grounding as EvidenceBasis,
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
  compileExpression,
  type WireBasis,
  type WireOperation,
} from "./live-wire";
import { aliasLookup, expandRangeBasis } from "./projection";
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
      (getSourceSubject(replay, id)?.version ?? 0) === v,
      `stale-dependency:obligation/${id}`,
    );
  for (const e of task.evidence)
    requireThat(
      replay.evidence.some((current) => same(current, e)),
      "uncommitted-evidence",
    );
}
export function expandGrounding(
  replay: Replay,
  task: Task,
  refs: WireBasis[],
  group?: SourceRange,
): Grounding[] {
  const c = (task.review ?? task.capture)!;
  return refs.flatMap((ref) =>
    expandRangeBasis(
      replay.evidence,
      c,
      ref,
      ref.source === task.capture?.request.source.source ? group : undefined,
    ),
  );
}
function currentGrounding(
  replay: Replay,
  basis: Grounding[],
  group: SourceRange,
) {
  return basis.some(
    (b) =>
      b.range &&
      position(replay.evidence, b.range.start) <
        position(replay.evidence, group.end) &&
      position(replay.evidence, b.range.end) >
        position(replay.evidence, group.start),
  );
}
export function expandOperations(
  replay: Replay,
  task: Task,
  wire: WireOperation[],
  group?: SourceRange,
): Operation[] {
  const c = (task.review ?? task.capture)!;
  const unit = (a: string) => aliasLookup(c.units, a),
    core = (a: string) => aliasLookup(c.cores, a);
  return wire.map((op) => {
    let basis = expandGrounding(replay, task, op.basis, group);
    const meaning =
      op.type === "put" ? compileMeaning(op.meaning, unit) : undefined;
    let fieldBasis: Record<string, Grounding[]> | undefined;
    if (op.type === "put") {
      requireThat(
        meaning!.kind !== "quantity" || op.fieldBasis,
        "missing-quantity-field-basis",
      );
      if (op.fieldBasis) {
        const required = Object.keys(meaning!).filter(
          (field) =>
            field !== "kind" &&
            !(
              field === "conditions" &&
              "conditions" in meaning! &&
              meaning!.conditions.length === 0
            ),
        );
        const provided = op.fieldBasis.map((entry) => entry.field);
        requireThat(
          provided.length === new Set(provided).size,
          "duplicate-field-basis",
        );
        requireThat(
          semanticEqual([...required].sort(), [...provided].sort()),
          "incomplete-or-invalid-field-basis",
        );
        fieldBasis = Object.fromEntries(
          op.fieldBasis.map((entry) => [
            entry.field,
            expandGrounding(replay, task, entry.basis, group),
          ]),
        );
        basis = [
          ...new Map(
            [...basis, ...Object.values(fieldBasis).flat()].map((b) => [
              JSON.stringify(b),
              b,
            ]),
          ).values(),
        ];
      }
    }
    if (group)
      requireThat(
        currentGrounding(replay, basis, group),
        "missing-current-source-grounding",
      );
    if (op.type === "core") {
      requireThat(
        task.capture?.request.newCores.includes(op.id),
        "unissued-core-identity",
      );
      return { ...op, type: op.type, id: core(op.id), basis };
    }
    if (op.type === "setCoreLabel")
      return { ...op, type: op.type, id: core(op.id), basis };
    if (op.type === "put") {
      requireThat(
        (
          task.capture?.request.newUnits ?? task.review?.request.newUnits
        )?.includes(op.id),
        "unissued-unit-identity",
      );
      return {
        ...op,
        id: unit(op.id),
        coreId: core(op.coreId),
        meaning: meaning!,
        requires: op.dependencies.map((d) => unit(d.target)),
        dependencies: op.dependencies.map((d) => ({
          ...d,
          target: unit(d.target),
        })),
        basis,
        ...(fieldBasis ? { fieldBasis } : {}),
      };
    }
    if (op.type === "revise") {
      const change = op.change;
      let value: unknown = change.value;
      if (change.field === "expression")
        value = compileExpression(change.value);
      else if (change.field === "symbols") {
        requireThat(
          new Set(change.value.map((s) => s.symbol)).size ===
            change.value.length,
          "duplicate-symbol",
        );
        value = Object.fromEntries(
          change.value.map(({ symbol, ...v }) => [symbol, v]),
        );
      } else if (change.field === "domain")
        value = change.value ? [change.value.min, change.value.max] : null;
      else if (change.field === "targets") value = change.value.map(unit);
      else if (change.field === "target") value = unit(change.value);
      else if (change.field === "dependencies")
        value = change.value.map((d) => ({ ...d, target: unit(d.target) }));
      return {
        type: "revise",
        id: unit(op.id),
        change: { field: change.field, value },
        basis,
      };
    }
    if (op.type === "invalidate" || op.type === "revalidate")
      return { ...op, type: op.type, id: unit(op.id), basis };
    if (op.type === "mainline")
      return { ...op, coreId: core(op.coreId), basis };
    if (op.type !== "cue") throw new Rejection("unknown-operation");
    return {
      ...op,
      value: op.value
        ? {
            ...op.value,
            targets: op.value.targets.map(unit),
            origin: "TEACHER" as const,
            basis,
          }
        : null,
      basis,
    };
  });
}
export function validateOperations(
  state: TeachingState,
  task: Task,
  ops: Operation[],
) {
  const scope = task.writeScope;
  requireThat(scope, "missing-write-scope");
  const createdCores = new Set<string>(),
    createdUnits = new Set<string>();
  for (const op of ops) {
    if (op.type === "core") {
      requireThat(task.lane === "Live", "stage-cannot-create-core");
      createdCores.add(op.id);
    }
    if (op.type === "setCoreLabel")
      requireThat(
        task.lane === "Live" && scope!.labels.includes(op.id),
        "core-label-write-scope",
      );
    if (op.type === "put") {
      requireThat(
        createdCores.has(op.coreId) || scope!.createIn.includes(op.coreId),
        "write-scope",
      );
      requireThat(!state.units[op.id], "revise-required");
      requireThat(
        !Object.values(state.units).some(
          (u) =>
            u.coreId === op.coreId &&
            isCurrent(state, u.id) &&
            semanticEqual(u.meaning, op.meaning) &&
            semanticEqual([...u.requires].sort(), [...op.requires].sort()),
        ),
        "duplicate-existing-knowledge",
      );
      createdUnits.add(op.id);
      validateMeaning(op.meaning);
    }
    if (["revise", "invalidate", "revalidate"].includes(op.type) && "id" in op)
      requireThat(
        createdUnits.has(op.id) ||
          (scope!.units.includes(op.id) &&
            Object.hasOwn(task.dependencies, `unit/${op.id}`)),
        "uncaptured-write",
      );
    if (op.type === "mainline")
      requireThat(
        task.lane === "Live" && scope!.mainline,
        "uncaptured-mainline",
      );
    if (op.type === "cue")
      requireThat(task.lane === "Live" && scope!.cue, "uncaptured-cue");
  }
  const next = reduceSemanticOperations(state, ops);
  for (const id of createdUnits) {
    const unit = next.units[id];
    requireThat(
      !Object.values(next.units).some(
        (other) =>
          other.id !== id &&
          other.coreId === unit.coreId &&
          isCurrent(next, other.id) &&
          semanticEqual(other.meaning, unit.meaning) &&
          semanticEqual([...other.requires].sort(), [...unit.requires].sort()),
      ),
      "duplicate-existing-knowledge",
    );
  }
  for (const op of ops) {
    const u = "id" in op ? next.units[op.id] : undefined;
    if (
      u &&
      (op.type === "put" || op.type === "revise" || op.type === "revalidate")
    ) {
      validateMeaning(u.meaning);
      for (const id of u.requires)
        requireThat(
          createdUnits.has(id) ||
            (task.state.units[id] &&
              Object.hasOwn(task.dependencies, `unit/${id}`)),
          "uncaptured-semantic-dependency",
        );
    }
    if (op.type === "cue")
      for (const id of op.value?.targets ?? [])
        requireThat(isCurrent(next, id), "invalid-cue-target");
  }
  return next;
}
export function validateResolution(
  replay: Replay,
  task: Task,
  state: TeachingState,
  wire: { obligation: string; targets: string[]; basis: WireBasis[] },
  group?: SourceRange,
): Resolution {
  const c = (task.review ?? task.capture)!;
  const id = aliasLookup(c.obligations, wire.obligation),
    obligation = getSourceSubject(replay, id);
  requireThat(
    obligation?.range && obligation.version === c.obligationVersions[id],
    "unbound-resolution",
  );
  const targets = wire.targets.map((a) => aliasLookup(c.units, a));
  for (const id of targets)
    requireThat(
      isCurrent(state, id) &&
        state.units[id] &&
        (Object.hasOwn(task.dependencies, `unit/${id}`) ||
          !replay.state.units[id]),
      "invalid-resolution-target",
    );
  const basis = expandGrounding(replay, task, wire.basis, group);
  const lo = position(replay.evidence, obligation!.range!.start),
    hi = position(replay.evidence, obligation!.range!.end);
  let through = lo;
  for (const b of basis
    .filter((b) => b.range)
    .sort(
      (a, b) =>
        position(replay.evidence, a.range!.start) -
        position(replay.evidence, b.range!.start),
    )) {
    const start = position(replay.evidence, b.range!.start),
      end = position(replay.evidence, b.range!.end);
    if (start <= through && end > through) through = end;
  }
  requireThat(through >= hi, "ungrounded-resolution");
  if (group)
    requireThat(
      currentGrounding(replay, basis, group),
      "missing-resolution-confirmation",
    );
  return { obligation: id, targets, basis };
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
    !p.contextRequest || p.suffixStatus === "WAIT_MORE_INPUT",
    "context-request-requires-wait",
  );
  if (p.contextRequest?.after)
    requireThat(
      p.contextRequest.after === c.request.search?.nextAfter &&
        p.contextRequest.query === c.request.search?.query,
      "invalid-search-cursor",
    );
  requireThat(
    c.recovery ||
      position(replay.evidence, replay.accounted) ===
        position(replay.evidence, c.range.start),
    "noncontiguous-accounting",
  );
  if (c.recovery) {
    requireThat(!replay.captureClosed, "source-review-capture-closed");
    requireThat(
      !p.attentionCandidate && !p.contextRequest && !p.reviewRequests.length,
      "source-review-cannot-publish-attention-or-search",
    );
    requireThat(
      p.groups.length <= 1 &&
        (!p.groups.length ||
          (p.groups[0].throughBoundary === c.request.source.end &&
            p.suffixStatus === "NONE")),
      "source-review-must-cover-whole-subject",
    );
  }
  let start = c.range.start,
    state = replay.state;
  const operationBatches: number[] = [];
  const operations: Operation[] = [],
    unresolved: Accepted["unresolved"] = [],
    resolved: string[] = [],
    resolutions: Resolution[] = [],
    groups: NonNullable<Accepted["processing"]>["groups"] = [];
  for (const [i, g] of p.groups.entries()) {
    const end = c.boundaries[g.throughBoundary];
    requireThat(end, "unknown-or-cross-task-alias");
    const range = { start, end };
    requireThat(
      rangeSize(replay.evidence, range) > 0,
      "noncontiguous-accounting",
    );
    if (c.recovery && g.outcome === "NO_CHANGE")
      requireThat(
        position(replay.evidence, c.recovery.through) ===
          position(replay.evidence, replay.recorded) &&
          !c.request.omitted.sourceAfter,
        "source-review-unseen-continuation",
      );
    const ops = expandOperations(
      replay,
      task,
      g.outcome === "APPLY" ? g.operations : [],
      c.recovery ? undefined : range,
    );
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
      writeScope: task.writeScope
        ? {
            ...task.writeScope,
            createIn: [...task.writeScope.createIn, ...localCores],
            units: [...task.writeScope.units, ...Object.keys(localUnits)],
          }
        : undefined,
      dependencies: {
        ...task.dependencies,
        ...Object.fromEntries(
          Object.keys(localUnits).map((id) => [`unit/${id}`, 0]),
        ),
      },
    };
    const next = validateOperations(state, groupTask, ops);
    const localResolutions =
      g.outcome === "APPLY"
        ? g.resolutions.map((r) =>
            validateResolution(replay, task, next, r, range),
          )
        : [];
    for (const r of localResolutions) {
      requireThat(!resolved.includes(r.obligation), "unbound-resolution");
      resolved.push(r.obligation);
      resolutions.push(r);
    }
    const changed =
      !semanticEqual(semanticValue(state), semanticValue(next)) ||
      localResolutions.length > 0;
    requireThat(
      (g.outcome === "APPLY") === changed,
      "semantic-no-op-or-change-disposition-mismatch",
    );
    if (g.outcome === "CARRY" && !c.recovery) {
      const coreId = g.core ? aliasLookup(c.cores, g.core) : null;
      requireThat(!coreId || next.cores[coreId], "unknown-obligation-core");
      unresolved.push({
        id: `obligation:${task.id}:${i}`,
        range,
        kind: g.kind,
        version: 1,
        evidenceIds: sourcePieces(replay.evidence, range).map(
          (p) => p.evidenceId,
        ),
        phrase: readable(replay.evidence, range),
        coreId,
        createdAt: Date.now(),
      });
    }
    operations.push(...ops);
    operationBatches.push(ops.length);
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
  const reviewRequests: ReviewConcern[] = p.reviewRequests.map((r, i) => {
    const coreId = aliasLookup(c.cores, r.core);
    requireThat(state.cores[coreId], "invalid-review-core");
    const unitIds = r.targets.map((a) => aliasLookup(c.units, a));
    requireThat(
      unitIds.every((id) => state.units[id]?.coreId === coreId),
      "invalid-review-target",
    );
    return {
      unitIds,
      id: `review:${task.id}:${i}`,
      version: 1,
      range: { start: c.range.start, end: start },
      coreId,
      purpose: r.purpose,
      createdAt: Date.now(),
    };
  });
  if (!c.recovery)
    for (const [i, group] of groups.entries()) {
      if (group.outcome !== "NO_CHANGE") continue;
      const reasons = terminalRisk(readable(replay.evidence, group.range));
      if (reasons.length)
        reviewRequests.push({
          id: `source-review:${task.id}:${i}`,
          kind: "SOURCE_NO_CHANGE",
          version: 1,
          range: group.range,
          coreId: null,
          purpose:
            "Review a structurally incomplete terminal no-change decision",
          risk: { version: "v2-terminal-risk-1", reasons },
          createdAt: Date.now(),
        });
    }
  if (c.recovery && groups.length && groups[0].outcome === "APPLY") {
    requireThat(
      resolutions.length === 1 &&
        resolutions[0].obligation === c.recovery.subjectId,
      "source-review-needs-original-resolution",
    );
    const bound = new Set(resolutions[0].targets);
    const pending = [...bound];
    while (pending.length)
      for (const id of state.units[pending.pop()!]?.requires ?? []) {
        if (!bound.has(id)) {
          bound.add(id);
          pending.push(id);
        }
      }
    requireThat(
      operations.every(
        (op) => !("id" in op) || op.type === "core" || bound.has(op.id),
      ),
      "unrelated-source-review-mutation",
    );
    requireThat(
      operations
        .filter((op) => op.type === "core")
        .every((op) =>
          resolutions[0].targets.some(
            (id) => state.units[id]?.coreId === op.id,
          ),
        ),
      "unrelated-source-review-core",
    );
  }
  const attention = p.attentionCandidate
    ? {
        ...p.attentionCandidate,
        targets: p.attentionCandidate.targets.map((a) =>
          aliasLookup(c.units, a),
        ),
      }
    : null;
  for (const id of attention?.targets ?? [])
    requireThat(isCurrent(state, id), "invalid-attention");
  reviewRequests.push(...affectedReviews(replay, state, task.id));
  const accepted: Accepted = {
    taskId: task.id,
    lane: "Live",
    dependencies: task.dependencies,
    operations,
    operationBatches,
    dispositions: [],
    unresolved,
    resolved,
    resolutions,
    ...(p.contextRequest
      ? {
          context: {
            anchor: { start, end: c.range.end },
            query: {
              ...p.contextRequest,
              after: p.contextRequest.after
                ? c.units[p.contextRequest.after]
                : null,
            },
          },
        }
      : {}),
    reviewed: [],
    reviewRequests,
    processing: {
      version: "v2-source-processing-1",
      groups,
      suffixStatus: p.suffixStatus,
      inspectionKey: task.inspectionKey!,
    },
  };
  if (c.recovery) {
    delete accepted.processing;
    accepted.context = c.inspectionContext;
    if (groups.length) {
      const group = p.groups[0];
      accepted.recovery = {
        version: "v2-live-source-review-1",
        ...c.recovery,
        range: c.range,
        inspectionKey: task.inspectionKey!,
        outcome: group.outcome,
        ...(group.outcome === "CARRY"
          ? {
              carry: {
                kind: group.kind,
                coreId: group.core ? aliasLookup(c.cores, group.core) : null,
              },
            }
          : {}),
      };
    }
  }
  return { proposal: { attention, operations }, accepted, decision: p };
}

export function affectedReviews(
  replay: Replay,
  state: TeachingState,
  taskId: string,
) {
  return Object.values(state.units).flatMap((u) => {
    if (!u.reviewRequired || replay.state.units[u.id]?.reviewRequired)
      return [];
    const range = u.basis.find((b) => b.range)?.range;
    return range
      ? [
          {
            id: `review:${taskId}:affected:${u.id}`,
            version: 1,
            range,
            coreId: u.coreId,
            unitIds: [u.id],
            purpose: "Reconcile content depending on a superseded value",
            createdAt: Date.now(),
          },
        ]
      : [];
  });
}
